/**
 * Anti-bot hardening.
 *
 * Four layers, cheapest and least invasive first:
 *
 *  1. **Process flags** — `--disable-blink-features=AutomationControlled`
 *     applied before `app.whenReady()`, which removes `navigator.webdriver`
 *     at the Blink level (no injection, no timing hole).
 *  2. **Session identity** — a Chromium UA with the `Electron/x.y.z` token
 *     stripped, matching `Accept-Language`, and the `Sec-CH-UA*` client hints
 *     rewritten on every request so the headers agree with the JS surface.
 *  3. **Renderer patches** — a main-world patch injected through CDP
 *     `Page.addScriptToEvaluateOnNewDocument`, i.e. *before* any page script
 *     runs (see `src/fingerprint.js#buildPatchScript` for what it touches).
 *  4. **Behaviour** — a bot challenge (`/cdn-cgi/challenge-platform`,
 *     Turnstile, hCaptcha) is waited out with an exponential, jittered backoff
 *     instead of being reloaded like a madman, and any text we type for the
 *     user is emitted with human cadence.
 *
 * Deliberately *not* done: no proxy rotation, no captcha solving, no
 * credential autofill, no `--no-sandbox`-style security downgrades, and canvas
 * noise stays off by default because a noisy fingerprint also breaks the cached
 * logins this app depends on.
 */

const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const log = require('electron-log');

const configStore = require('./config');
const paths = require('./paths');
const fingerprint = require('./fingerprint');
const { STORAGE, STEALTH } = require('./constants');
const { normalizeHostname, safeHostname } = require('./utils');

const CDP_PROTOCOL = '1.3';

let profile = null;
let initialised = false;
/** sessions we already installed header overrides on */
const patchedSessions = new Set();
/** webContentsId -> { attached: boolean, retried: number, lastAttemptAt: number } */
const perTab = new Map();

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function fingerprintFile() {
  return path.join(paths.userDataDir(), STORAGE.FINGERPRINT_FILENAME);
}

/**
 * The seed is persisted so the identity stays *stable across launches*: a
 * fingerprint that changes every session is a stronger bot signal than an
 * honest one.
 */
function loadSeed() {
  try {
    const file = fingerprintFile();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed.seed === 'string' && parsed.seed.length <= 128) return parsed.seed;
    }
  } catch (error) {
    log.debug(`Fingerprint seed unreadable: ${error.message}`);
  }
  return `aihub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveSeed(seed) {
  try {
    paths.ensureDir(path.dirname(fingerprintFile()));
    fs.writeFileSync(fingerprintFile(), JSON.stringify({ seed, savedAt: new Date().toISOString() }, null, 2), {
      mode: 0o600
    });
  } catch (error) {
    log.debug(`Fingerprint seed not persisted: ${error.message}`);
  }
}

function enabled() {
  return configStore.getConfigItem('antiBotHardening', true) !== false;
}

/** Build (once) the profile used by every session in this run. */
function getProfile({ force = false } = {}) {
  if (profile && !force) return profile;
  if (!enabled()) return null;

  const seed = loadSeed();
  if (!fs.existsSync(fingerprintFile())) saveSeed(seed);

  const config = configStore.getConfig();
  const languages = (app.getLocale() ? [app.getLocale(), String(app.getLocale()).split('-')[0]] : ['en-US', 'en'])
    .filter(Boolean);

  const rawUserAgent = session.defaultSession
    ? session.defaultSession.getUserAgent()
    : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  profile = fingerprint.createProfile({
    seed,
    platform: process.platform,
    userAgent: fingerprint.normalizeUserAgent(rawUserAgent, { platform: process.platform }),
    languages,
    timezone: config.stealthTimezone || '',
    canvasNoise: Boolean(config.antiBotCanvasNoise)
  });

  return profile;
}

// ---------------------------------------------------------------------------
// 1. Process flags
// ---------------------------------------------------------------------------

/** Must run before the app is ready — call from `main.js` at require time. */
function applyCommandLineFlags() {
  if (!enabled()) return false;
  try {
    const { switches } = fingerprint.buildCommandLineSwitches();
    for (const [name, value] of switches) app.commandLine.appendSwitch(name, value);
    return true;
  } catch (error) {
    log.warn(`Unable to apply hardening switches: ${error.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Session identity + headers
// ---------------------------------------------------------------------------

/**
 * Apply the UA / language / client-hint mask to one session and install the
 * request-header rewrite. Idempotent per session.
 */
function applyToSession(targetSession) {
  const ses = targetSession || session.defaultSession;
  const active = getProfile();
  if (!ses || !active) return false;

  try {
    ses.setUserAgent(active.userAgent, active.languages);
  } catch (error) {
    log.warn(`Unable to set the session UA: ${error.message}`);
  }

  if (patchedSessions.has(ses.id ?? 'default')) return true;
  patchedSessions.add(ses.id ?? 'default');

  if (ses.webRequest && typeof ses.webRequest.onBeforeSendHeaders === 'function') {
    const hintHeaders = fingerprint.buildRequestHeaders(active);
    // Headers we own. Any case variant of these is dropped before the canonical
    // spelling is written: two spellings of one hint is itself a fingerprint.
    const ownedHeaders = new Set(['user-agent', ...Object.keys(hintHeaders)]);
    const allowed = (url) => {
      // `safeHostname` parses a URL; `normalizeHostname` expects a bare host.
      const host = safeHostname(url || '');
      // Never touch the shell UI or anything local (our own API included).
      return Boolean(host) && !/^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(host);
    };

    ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*', 'http://*/*'] }, (details, callback) => {
      try {
        if (!enabled() || !allowed(details.url)) {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }

        const headers = { ...details.requestHeaders };
        for (const existing of Object.keys(headers)) {
          if (ownedHeaders.has(existing.toLowerCase())) delete headers[existing];
        }

        headers['User-Agent'] = active.userAgent;
        for (const [name, value] of Object.entries(hintHeaders)) headers[name] = value;

        // Artefacts no shipping browser sends.
        for (const key of Object.keys(headers)) {
          if (/^electron-|^aihub-/i.test(key)) delete headers[key];
        }

        callback({ requestHeaders: headers });
      } catch (error) {
        callback({ requestHeaders: details.requestHeaders });
      }
    });
  }

  return true;
}

// ---------------------------------------------------------------------------
// 3. Renderer patches
// ---------------------------------------------------------------------------

/**
 * Inject the main-world patch into a tab. Uses the debugger domain, which is
 * the only documented way to run code in a page's main world *before* its own
 * scripts while keeping `contextIsolation` + `sandbox` switched on.
 *
 * @returns {Promise<{ok: boolean, skipped?: string}>}
 */
async function applyToWebContents(contents) {
  const active = getProfile();
  if (!contents || contents.isDestroyed() || !active) return { ok: false, skipped: 'disabled' };

  const state = perTab.get(contents.id) || { attached: false, retried: 0, lastAttemptAt: 0 };
  perTab.set(contents.id, state);
  if (state.attached) return { ok: true };

  if (!contents.debugger || typeof contents.debugger.attach !== 'function') {
    return { ok: false, skipped: 'no-debugger' };
  }

  try {
    contents.debugger.attach(CDP_PROTOCOL);
  } catch (error) {
    // DevTools already owns the debugger; the mask is not worth stealing it.
    log.debug(`Hardening skipped (debugger busy): ${error.message}`);
    return { ok: false, skipped: 'debugger-busy' };
  }

  const detach = () => {
    state.attached = false;
    try {
      if (contents.debugger && contents.debugger.isAttached()) contents.debugger.detach();
    } catch (e) {
      /* already gone */
    }
  };
  contents.on('destroyed', detach);
  contents.on('devtools-opened', detach);

  try {
    await contents.debugger.sendCommand('Page.enable', {});
    await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: fingerprint.buildPatchScript(active)
    });
    await contents.debugger.sendCommand('Network.enable', {});
    await contents.debugger.sendCommand('Network.setUserAgentOverride', {
      userAgent: active.userAgent,
      acceptLanguage: active.acceptLanguage,
      platform: active.navigatorPlatform,
      userAgentMetadata: {
        brands: active.userAgentData.brands,
        fullVersionList: active.userAgentData.brands.map((brand) => ({
          brand: brand.brand,
          version: brand.brand === 'Not_A Brand' ? '24.0.0.0' : `${brand.version}.0.0.0`
        })),
        platform: active.userAgentData.platform,
        mobile: false,
        platformVersion: '14.0.0'
      }
    });
    if (active.timezone) {
      await contents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: active.timezone });
    }
    state.attached = true;
    log.debug(`Anti-bot hardening attached to webContents ${contents.id}`);
    return { ok: true };
  } catch (error) {
    log.debug(`Hardening injection failed: ${error.message}`);
    detach();
    return { ok: false, skipped: 'cdp-error', error: error.message };
  }
}

/**
 * Fallback for tabs where CDP is unavailable: patch at `dom-ready`. Late, but
 * still ahead of most detectors' second pass.
 */
async function injectOnDomReady(contents) {
  const active = getProfile();
  if (!contents || contents.isDestroyed() || !active) return false;
  const state = perTab.get(contents.id) || { attached: false };
  if (state.attached) return false;

  contents.once('dom-ready', () => {
    if (contents.isDestroyed()) return;
    contents
      .executeJavaScript(fingerprint.buildPatchScript(active), false)
      .then(() => log.debug(`Late hardening patch applied to webContents ${contents.id}`))
      .catch((error) => log.debug(`Late hardening patch failed: ${error.message}`));
  });
  return true;
}

// ---------------------------------------------------------------------------
// 4. Behaviour
// ---------------------------------------------------------------------------

/**
 * Wait out a bot challenge instead of hammering it.
 *
 * @param {Electron.WebContents} contents
 * @param {{url: string, onRetry?: (info: object) => void}} info
 * @returns {Promise<boolean>} whether a retry was scheduled
 */
async function handleChallenge(contents, info = {}) {
  const state = perTab.get(contents.id) || { attached: false, retried: 0, lastAttemptAt: 0 };
  perTab.set(contents.id, state);

  const now = Date.now();
  if (state.retried >= STEALTH.CHALLENGE_MAX_RETRIES) return false;
  if (now - (state.lastAttemptAt || 0) < STEALTH.MIN_RETRY_SPACING_MS) return false;

  const delay = fingerprint.challengeDelay(state.retried);
  state.retried += 1;
  state.lastAttemptAt = now;
  perTab.set(contents.id, state);

  log.info(`Bot challenge on ${normalizeHostname(info.url || '')} — waiting ${Math.round(delay)}ms (attempt ${state.retried}/${STEALTH.CHALLENGE_MAX_RETRIES})`);

  const timer = setTimeout(() => {
    if (contents.isDestroyed()) return;
    try {
      contents.reload();
    } catch (error) {
      log.debug(`Challenge retry failed: ${error.message}`);
    }
    if (typeof info.onRetry === 'function') info.onRetry({ attempt: state.retried, delay });
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}

/** A solved challenge resets the retry budget. */
function noteChallengeCleared(contents) {
  const state = perTab.get(contents.id);
  if (state && state.retried) {
    state.retried = 0;
    perTab.set(contents.id, state);
  }
}

/**
 * Type like a person: the API's DOM driver uses this instead of pasting a
 * 4 kB block into a textarea in one event.
 *
 * @param {Electron.WebContents} contents
 * @param {string} selector CSS selector of the editable element
 * @param {string} text
 * @param {{humanize?: boolean}} [options]
 */
async function typeInto(contents, selector, text, { humanize = true } = {}) {
  if (!contents || contents.isDestroyed()) return { ok: false, error: 'no-contents' };

  const config = configStore.getConfig();
  const shouldHumanize = humanize && config.antiBotHumanize !== false;
  const value = typeof text === 'string' ? text : '';

  await contents
    .executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'missing';
        el.focus();
        el.textContent = '';
        return 'ok';
      })()`,
      true
    )
    .catch(() => 'error');

  if (!shouldHumanize) {
    await contents
      .executeJavaScript(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          if (el.isContentEditable) {
            document.execCommand('insertText', false, ${JSON.stringify(value)});
          } else {
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) setter.set.call(el, ${JSON.stringify(value)});
            else el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        })()`,
        true
      )
      .catch(() => false);
    return { ok: true, mode: 'instant' };
  }

  // Chunked with human cadence: per-character CDP events for a 600-char prompt
  // would take a minute, so we type in small runs with jittered pauses.
  const delays = fingerprint.keystrokeDelays(Math.ceil(value.length / 6));
  let cursor = 0;
  let chunkIndex = 0;

  while (cursor < value.length) {
    const size = 3 + Math.floor(Math.random() * 6);
    const chunk = value.slice(cursor, cursor + size);
    cursor += chunk.length;

    // eslint-disable-next-line no-await-in-loop
    await contents
      .executeJavaScript(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          const text = ${JSON.stringify(chunk)};
          if (el.isContentEditable) {
            document.execCommand('insertText', false, text);
          } else {
            el.value += text;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          }
          return true;
        })()`,
        true
      )
      .catch(() => false);

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delays[chunkIndex] || 30));
    chunkIndex += 1;
  }

  return { ok: true, mode: 'humanized', chunks: chunkIndex };
}

/** Click with a small offset so coordinates are not pixel-perfect. */
async function clickLikeHuman(contents, selector) {
  if (!contents || contents.isDestroyed()) return false;
  return contents
    .executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width * (0.35 + Math.random() * 0.3);
        const y = rect.top + rect.height * (0.35 + Math.random() * 0.3);
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
        el.dispatchEvent(new PointerEvent('pointerover', opts));
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return true;
      })()`,
      true
    )
    .catch(() => false);
}

/** Small idle movements between actions (a static cursor is suspicious). */
function idleJitterMs() {
  return 120 + Math.floor(Math.random() * 260);
}

function getStatus() {
  const active = profile;
  return {
    enabled: enabled(),
    attachedTabs: [...perTab.values()].filter((state) => state.attached).length,
    userAgent: active ? active.userAgent : null,
    chromeMajor: active ? active.chromeMajor : null,
    languages: active ? active.languages : [],
    timezone: active ? active.timezone || null : null,
    canvasNoise: active ? active.canvasNoise : false,
    humanize: configStore.getConfigItem('antiBotHumanize', true) !== false,
    acceptLanguage: active ? active.acceptLanguage : null,
    seedHash: active ? fingerprint.hash32(active.seed).toString(16) : null
  };
}

/** Forget everything (tests + "clear session data"). */
function reset() {
  perTab.clear();
  patchedSessions.clear();
  profile = null;
  initialised = false;
}

function teardown(targetSession) {
  const ses = targetSession || session.defaultSession;
  if (ses && ses.webRequest && typeof ses.webRequest.onBeforeSendHeaders === 'function') {
    try {
      ses.webRequest.onBeforeSendHeaders(null);
    } catch (e) {
      /* session already gone */
    }
  }
  patchedSessions.clear();
}

module.exports = {
  initialise: (targetSession) => {
    if (initialised) return true;
    initialised = true;
    return applyToSession(targetSession);
  },
  applyCommandLineFlags,
  applyToSession,
  applyToWebContents,
  injectOnDomReady,
  getProfile,
  handleChallenge,
  noteChallengeCleared,
  typeInto,
  clickLikeHuman,
  idleJitterMs,
  challengeDelay: fingerprint.challengeDelay,
  buildPatchScript: fingerprint.buildPatchScript,
  getStatus,
  teardown,
  reset,
  CDP_PROTOCOL,
  STEALTH
};
