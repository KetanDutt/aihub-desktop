/**
 * Chat engine: turns an OpenAI request into work done *inside a logged-in
 * session of the app*.
 *
 * Two strategies per service, chosen by the adapter in `data/adapters.json`:
 *
 *  - `api` — call the web app's own JSON/SSE endpoint, replaying the browser's
 *    cookies (from the service's persistent jar) plus the CSRF/account headers
 *    the page itself uses. Fast, no rendering, real token streaming.
 *  - `dom` — drive a hidden, sandboxed window: open the chat page, type the
 *    prompt with human cadence (`src/stealth.js`), read the answer node until it
 *    stops growing and stream the difference out. This is the universal
 *    fallback, and the only one that survives a frontend redesign.
 *
 * `auto` tries `api` and transparently falls back to `dom` when the endpoint
 * rejects us (rotated payload, 401/403, a login redirect).
 *
 * Guard rails: the target host must be inside the service's allow-list, only
 * services exposed by the config can be reached, one hidden window per service
 * with an idle teardown, and the whole call is bounded by a timeout the caller
 * can cancel by hanging up.
 */

const { BrowserWindow } = require('electron');
const log = require('electron-log');

const configStore = require('./../config');
const dataStore = require('./../data');
const sessionStore = require('./../sessionstore');
const loginMonitor = require('./../logins');
const stealth = require('./../stealth');
const blocking = require('./../blocking');
const fingerprint = require('./../fingerprint');
const template = require('./template');
const openai = require('./openai');
const http = require('./http');
const { API } = require('./../constants');
const { normalizeHostname } = require('./../utils');

const HIDDEN_IDLE_MS = 5 * 60 * 1000;
const POLL_MS = 700;

/** serviceId -> { win, usedAt, loading } */
const hiddenWindows = new Map();
let adapters = new Map();
let defaultAdapter = null;
let idleTimer = null;
const allowListCache = new Map();

class EngineError extends Error {
  constructor(message, { status = 502, openaiError = null, code = null } = {}) {
    super(message);
    this.name = 'EngineError';
    this.status = status;
    this.code = code;
    this.openaiError = openaiError;
  }
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

function setAdapters(map, fallback) {
  adapters = map instanceof Map ? map : new Map();
  defaultAdapter = fallback || null;
}

function adapterFor(serviceId) {
  const adapter = adapters.get(serviceId);
  if (adapter) return adapter;
  if (defaultAdapter) return { ...defaultAdapter, serviceId };
  return null;
}

function serviceById(serviceId) {
  const cache = dataStore.getServicesCache();
  const list = (cache && cache.ai_services) || [];
  return list.find((service) => service.id === serviceId) || null;
}

/** Which services this endpoint exposes right now. */
function exposedServices() {
  const config = configStore.getConfig();
  const catalogue = ((dataStore.getServicesCache() || {}).ai_services) || [];
  const allowed = new Set((config.apiServices || []).map((id) => String(id).toLowerCase()));

  return catalogue.filter((service) => {
    if (config.apiExposeAllServices === false) {
      const enabled = new Set((config.enabledServices || []).map((id) => String(id).toLowerCase()));
      if (!enabled.has(service.id)) return false;
    }
    if (allowed.size > 0 && !allowed.has(service.id)) return false;
    return true;
  });
}

function isExposed(serviceId) {
  return exposedServices().some((service) => service.id === serviceId);
}

// ---------------------------------------------------------------------------
// Host allow-list (never leak a session cookie to an unrelated domain)
// ---------------------------------------------------------------------------

function allowedHostsFor(serviceId) {
  if (allowListCache.has(serviceId)) return allowListCache.get(serviceId);

  // Rebuilt from the same rule set the tabs use, without touching the blocking
  // engine's global state: this is a read of policy, not a change to it.
  const rules = dataStore.getRulesCache();
  const allowed = blocking.buildAllowList(serviceId, rules);
  const shared = [
    ...((rules && rules.common_auth_domains) || []),
    ...((rules && rules.always_allowed_domains) || [])
  ];
  for (const domain of shared) {
    const host = normalizeHostname(domain);
    if (host) allowed.add(host);
  }

  allowListCache.set(serviceId, allowed);
  return allowed;
}

function assertAllowedHost(serviceId, url) {
  const host = normalizeHostname(url);
  if (!host) return false;
  const allowed = allowedHostsFor(serviceId);
  return blocking.isDomainAllowed(host, allowed, true, allowed);
}

// ---------------------------------------------------------------------------
// Hidden windows (DOM strategy)
// ---------------------------------------------------------------------------

function sessionContextForPartition(serviceId) {
  const partition = sessionStore.partitionFor(serviceId);
  return partition ? { partition } : {};
}

function createHiddenWindow(serviceId) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    // Offscreen paint keeps the window out of the compositor while still
    // behaving like a visible page to the service.
    paintWhenInitiallyHidden: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      ...sessionContextForPartition(serviceId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);
  win.on('close', () => hiddenWindows.delete(serviceId));

  // Same guards as a visible tab: the hidden window may only move inside its
  // service, and any pop-up is refused outright.
  const allowed = allowedHostsFor(serviceId);
  win.webContents.on('will-navigate', (event, url) => {
    const host = normalizeHostname(url);
    if (!blocking.isDomainAllowed(host, allowed, true, allowed)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  stealth.applyToSession(win.webContents.session);
  stealth.applyToWebContents(win.webContents);

  return win;
}

function getHiddenWindow(serviceId) {
  const existing = hiddenWindows.get(serviceId);
  if (existing && existing.win && !existing.win.isDestroyed()) {
    existing.usedAt = Date.now();
    return existing;
  }
  const entry = { win: createHiddenWindow(serviceId), usedAt: Date.now(), loadedUrl: '' };
  hiddenWindows.set(serviceId, entry);
  return entry;
}

function disposeHiddenWindow(serviceId) {
  const entry = hiddenWindows.get(serviceId);
  if (!entry) return;
  hiddenWindows.delete(serviceId);
  try {
    if (!entry.win.isDestroyed()) entry.win.destroy();
  } catch (e) {
    /* already gone */
  }
}

function sweepIdleWindows(now = Date.now()) {
  for (const [serviceId, entry] of [...hiddenWindows]) {
    if (now - entry.usedAt > HIDDEN_IDLE_MS) disposeHiddenWindow(serviceId);
  }
}

function startIdleSweep() {
  if (idleTimer) return;
  idleTimer = setInterval(sweepIdleWindows, 60000);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

function stopIdleSweep() {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

/**
 * Make sure the hidden window sits on the chat page, and wait for the composer.
 */
async function ensurePage(entry, serviceId, url, { signal, timeoutMs = 45000 } = {}) {
  const contents = entry.win.webContents;
  const current = contents.getURL();

  if (!url || current === url || (url && current.startsWith(url))) {
    entry.usedAt = Date.now();
    return true;
  }

  entry.loadedUrl = url;
  await new Promise((resolve, reject) => {
    const done = (fn, arg) => {
      contents.removeListener('did-finish-load', onLoad);
      contents.removeListener('did-fail-load', onFail);
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener?.('abort', onAbort);
      fn(arg);
    };
    const onLoad = () => done(resolve, true);
    const onFail = (event, errorCode, description) => {
      // A navigation aborted by us (-3) is expected on teardown.
      if (errorCode === -3) done(resolve, false);
      else done(reject, new EngineError(`Navigation to ${url} failed (${errorCode}: ${description})`));
    };
    const timer = setTimeout(() => done(reject, new EngineError('Timed out loading the service page', { code: 'load-timeout' })), timeoutMs);
    const onAbort = () => done(reject, new EngineError('Request cancelled', { status: 499, code: 'cancelled' }));
    if (signal) signal.addEventListener?.('abort', onAbort, { once: true });

    contents.loadURL(url).catch((error) => done(reject, new EngineError(`Unable to load ${url}: ${error.message}`)));
  });

  entry.usedAt = Date.now();
  return true;
}

/** Wait until a selector exists (bounded). */
async function waitForSelector(contents, selector, { timeoutMs = 20000, intervalMs = 300, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new EngineError('Request cancelled', { status: 499, code: 'cancelled' });
    if (contents.isDestroyed()) throw new EngineError('The service view was torn down');
    // eslint-disable-next-line no-await-in-loop
    const found = await contents
      .executeJavaScript(
        `(() => { try { return Boolean(document.querySelector(${JSON.stringify(selector)})); } catch (e) { return false; } })()`,
        true
      )
      .catch(() => false);
    if (found) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Read the newest matching node's text. */
async function readAnswer(contents, adapter) {
  const dom = adapter.dom;
  const script = `(() => {
    try {
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(dom.answer)}));
      if (!nodes.length) return JSON.stringify({ text: '', count: 0 });
      const chosen = ${dom.answerAll ? 'nodes' : 'nodes.slice(-1)'};
      const text = chosen.map((n) => (n.innerText || n.textContent || '')).join('\\n').trim();
      const pending = ${dom.pending ? `Boolean(document.querySelector(${JSON.stringify(dom.pending)}))` : 'false'};
      return JSON.stringify({ text, count: nodes.length, pending });
    } catch (e) {
      return JSON.stringify({ text: '', count: 0, error: String(e && e.message) });
    }
  })()`;

  try {
    return JSON.parse(String(await contents.executeJavaScript(script, true)));
  } catch (e) {
    return { text: '', count: 0 };
  }
}

// ---------------------------------------------------------------------------
// Session material for the API strategy
// ---------------------------------------------------------------------------

/**
 * Resolve one declarative source entry (`{from, key, pattern, jsonPath}`) from
 * the page the app already has open. Only three sources exist — localStorage,
 * a cookie, and a regex over the current URL — because a data file must never
 * be able to ship code that runs inside a logged-in session.
 */
async function resolveSource(source, context) {
  if (!source) return null;
  const { from, key, pattern, jsonPath } = source;

  if (from === 'cookie') {
    const wanted = String(key || '').toLowerCase();
    const cookie = (context.cookies || []).find((entry) => String(entry.name).toLowerCase() === wanted);
    if (!cookie) return null;
    return pickPath(cookie.value, jsonPath);
  }

  if (from === 'urlPattern') {
    if (!context.pageUrl || !pattern) return null;
    try {
      const matched = context.pageUrl.match(new RegExp(pattern));
      const value = matched && (matched[1] !== undefined ? matched[1] : matched[0]);
      return typeof value === 'string' && value.length <= 200 ? value : null;
    } catch (e) {
      return null; // a pattern we cannot compile is not worth a crash
    }
  }

  // localStorage
  if (!context.contents || context.contents.isDestroyed() || !key) return null;
  try {
    const value = await context.contents.executeJavaScript(
      `(() => { try { return localStorage.getItem(${JSON.stringify(String(key))}) || ''; } catch (e) { return ''; } })()`,
      true
    );
    return typeof value === 'string' && value ? pickPath(value, jsonPath) : null;
  } catch (e) {
    return null;
  }
}

/** `JSON.parse` + a dotted path, so `oai-client-info` can hand back `accountId`. */
function pickPath(value, jsonPath) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (!jsonPath) return text.slice(0, 512);
  try {
    const resolved = template.getPath(JSON.parse(text), jsonPath);
    return typeof resolved === 'string' || typeof resolved === 'number' ? String(resolved).slice(0, 512) : null;
  } catch (e) {
    return null;
  }
}

/** Placeholders a template URL may reference, resolved from the open page. */
async function resolveUrlParams(api, entry, cookies) {
  const entries = (api && api.urlParams) || [];
  if (entries.length === 0) return {};

  const contents = entry && entry.win && !entry.win.isDestroyed() ? entry.win.webContents : null;
  const context = { cookies, contents, pageUrl: contents ? contents.getURL() : '' };
  const out = {};

  for (const source of entries) {
    // eslint-disable-next-line no-await-in-loop
    const value = await resolveSource(source, context);
    if (value) out[source.name] = encodeURIComponent(value).slice(0, 200);
  }
  return out;
}

/**
 * Values a service's own JS reads out of its origin, which we must reproduce:
 * cookies (from the persistent jar) plus whatever the adapter declares in
 * `accountHeaderFrom`.
 */
async function gatherSessionMaterial(serviceId, adapter, entry) {
  const service = serviceById(serviceId);
  const cookies = await sessionStore.readCookies(serviceId, service);
  const profile =
    stealth.getProfile() || fingerprint.createProfile({ seed: 'api', platform: process.platform });
  const material = { cookies, profile, headers: {} };

  const contents = entry && entry.win && !entry.win.isDestroyed() ? entry.win.webContents : null;
  const pageUrl = contents ? contents.getURL() : '';
  const context = { cookies, contents, pageUrl };

  for (const source of (adapter.api && adapter.api.authHeaders) || []) {
    // eslint-disable-next-line no-await-in-loop
    const value = await resolveSource(source, context);
    if (!value) continue;
    // eslint-disable-next-line no-control-regex
    if (/^[A-Za-z0-9._-]{1,64}$/.test(source.name) && !/[\r\n]/.test(value)) {
      material.headers[source.name.toLowerCase()] = value;
    }
  }

  return material;
}

function originOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

async function runApiStrategy({ serviceId, adapter, request, onDelta, signal, entry }) {
  const api = adapter.api;
  if (!api) throw new EngineError(`No API adapter for ${serviceId}`);
  if (!assertAllowedHost(serviceId, api.url)) {
    throw new EngineError(`Refusing to send the ${serviceId} session outside its allow-list`, {
      status: 403,
      code: 'host_not_allowed'
    });
  }

  const material = await gatherSessionMaterial(serviceId, adapter, entry);
  if (!material.cookies.length) {
    throw new EngineError(`${serviceId} has no cookies to reuse`, {
      status: 401,
      openaiError: openai.ERRORS.serviceUnavailable(`${serviceId} is not signed in — open the tab and sign in once.`),
      code: 'no-session'
    });
  }

  const flat = template.flattenMessages(request.messages, { includeHistory: request.includeHistory !== false });
  const conversationIdPath = api.conversationIdPath || '';
  const resolvedParams = await resolveUrlParams(api, entry, material.cookies);
  const context = {
    prompt: flat.prompt,
    system: flat.system,
    model: request.upstreamModel || adapter.defaultModel || 'default',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    language: material.profile.language,
    locale: material.profile.language,
    conversationId: request.conversationId || null,
    ...resolvedParams,
    maxTokens: request.maxTokens,
    temperature: request.temperature
  };

  const url = template.renderTemplate(api.url, context);
  const body = api.bodyText || template.renderTemplate(api.body, context);
  if (body && typeof body === 'object' && flat.system && api.systemField) {
    template.setPath(body, api.systemField, flat.system);
  }

  // An unresolved `{hole}` means we could not read something the service
  // expects (a rotated storage key, an org id that is not on this origin).
  // Say so, and let `auto` fall back to the DOM driver.
  if (typeof url === 'string' && /\{[a-zA-Z][a-zA-Z0-9_.]*\}/.test(url)) {
    throw new EngineError(`Unresolved placeholder in the ${serviceId} endpoint`, {
      status: 502,
      code: 'unresolved-placeholder'
    });
  }

  const headers = {
    ...http.sessionHeaders({
      cookies: material.cookies,
      origin: originOf(url),
      userAgent: material.profile.userAgent,
      acceptLanguage: material.profile.acceptLanguage,
      extra: {
        ...template.renderTemplate(api.headers || {}, context),
        ...material.headers
      }
    }),
    referer: `${originOf(url)}/`
  };

  // A template object means JSON; a template string is sent verbatim so a
  // service that wants `application/x-www-form-urlencoded` can have it.
  const serializedBody =
    body && typeof body === 'object' ? JSON.stringify(body) : typeof body === 'string' ? body : undefined;

  const timeoutMs = (request.timeoutSeconds || API.DEFAULT_TIMEOUT_SECONDS) * 1000;
  const fullText = [];
  const emit = (chunk) => {
    if (!chunk) return;
    fullText.push(chunk);
    if (typeof onDelta === 'function') onDelta(chunk);
  };

  if (api.sse) {
    const parser = openai.createSseParser();
    let upstreamError = null;

    await http.streamRequest({
      url,
      method: api.method,
      headers,
      body: serializedBody,
      timeoutMs,
      abortSignal: signal,
      onData: (raw) => {
        for (const payload of parser.push(raw)) {
          const delta = openai.extractDelta(payload, api.deltaPath);
          if (delta.error) upstreamError = delta.error;
          if (delta.text) emit(delta.text);
        }
      }
    });

    for (const payload of parser.end()) {
      const delta = openai.extractDelta(payload, api.deltaPath);
      if (delta.text) emit(delta.text);
    }

    if (!fullText.length && upstreamError) throw new EngineError(String(upstreamError).slice(0, 300));
    return { text: fullText.join(''), conversationId: null };
  }

  const response = await http.sendRequest({
    url,
    method: api.method,
    headers,
    body: serializedBody,
    timeoutMs
  });

  const extracted = openai.extractResult(response.text, api.resultPath || conversationIdPath);
  if (!extracted.text) {
    throw new EngineError(`${serviceId} returned no text (HTTP ${response.status})`, { status: 502 });
  }
  if (typeof onDelta === 'function') onDelta(extracted.text);
  return { text: extracted.text, conversationId: null };
}

async function runDomStrategy({ serviceId, adapter, request, onDelta, signal }) {
  const dom = adapter.dom;
  if (!dom) throw new EngineError(`No DOM adapter for ${serviceId}`);

  const service = serviceById(serviceId);
  const entry = getHiddenWindow(serviceId);
  startIdleSweep();

  const target = dom.url || (service && service.url);
  if (!target) throw new EngineError(`No page to drive for ${serviceId}`);

  await ensurePage(entry, serviceId, target, { signal, timeoutMs: dom.navigateTimeoutMs });

  const contents = entry.win.webContents;
  const state = loginMonitor.get(serviceId);
  if (state && state.state === loginMonitor.STATE.LOGGED_OUT) {
    throw new EngineError(`${serviceId} is not signed in — open the tab and sign in once.`, {
      status: 401,
      code: 'not-signed-in',
      openaiError: openai.ERRORS.serviceUnavailable(`${serviceId} is not signed in — open the tab and sign in once.`)
    });
  }

  const composerReady = await waitForSelector(contents, dom.composer, {
    timeoutMs: 20000,
    signal
  });
  if (!composerReady) {
    throw new EngineError(`The ${serviceId} composer never appeared (its UI may have changed)`, {
      status: 502,
      code: 'composer-missing'
    });
  }

  const flat = template.flattenMessages(request.messages, { includeHistory: request.includeHistory !== false });
  if (!flat.prompt) throw new EngineError('Nothing to send: the last message is empty');

  await stealth.typeInto(contents, dom.composer, flat.prompt, { humanize: true });

  // A leading newline can be lost if the editor mounts mid-focus, so submit
  // with the button when the adapter names one, otherwise with Enter.
  if (dom.submit === 'button' && dom.submitSelector) {
    await stealth.clickLikeHuman(contents, dom.submitSelector);
  } else {
    await contents
      .executeJavaScript(
        `(() => {
          const el = document.querySelector(${JSON.stringify(dom.composer)});
          if (!el) return false;
          const opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
          el.dispatchEvent(new KeyboardEvent('keydown', opts));
          el.dispatchEvent(new KeyboardEvent('keypress', opts));
          el.dispatchEvent(new KeyboardEvent('keyup', opts));
          const form = el.closest && el.closest('form');
          if (form) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          return true;
        })()`,
        true
      )
      .catch(() => false);
  }

  entry.usedAt = Date.now();

  const deadline = Date.now() + (request.timeoutSeconds || API.DEFAULT_TIMEOUT_SECONDS) * 1000;
  let previous = '';
  let stablePolls = 0;
  let sawPending = false;

  while (Date.now() < deadline) {
    if (signal && signal.aborted) {
      await contents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(
        dom.stop || dom.pending || 'body'
      )}); if (el) el.click && el.click(); return true; })()`).catch(() => false);
      throw new EngineError('Request cancelled', { status: 499, code: 'cancelled' });
    }

    // eslint-disable-next-line no-await-in-loop
    const answer = await readAnswer(contents, adapter);
    const text = typeof answer.text === 'string' ? answer.text : '';

    if (answer.pending) sawPending = true;

    if (text.length > previous.length) {
      if (typeof onDelta === 'function') onDelta(text.slice(previous.length));
      previous = text;
      stablePolls = 0;
    } else if (text.length > 0 && !answer.pending) {
      stablePolls += 1;
      // Only finish once the "still generating" affordance has been seen and
      // gone, or the answer simply never had one.
      if (stablePolls >= (dom.idlePolls || 3) && (!sawPending || !answer.pending)) break;
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, dom.pollMs || POLL_MS));
  }

  entry.usedAt = Date.now();

  if (!previous) {
    throw new EngineError(`No answer could be read from ${serviceId}`, { status: 502, code: 'no-answer' });
  }

  return { text: previous, conversationId: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function modelEntry(service, adapter, loginState) {
  return {
    id: openai.modelIdFor(service.id),
    object: 'model',
    created: 0,
    owned_by: `aihub-desktop/${adapter ? adapter.strategy : 'dom'}`,
    // Extensions that OpenAI SDKs ignore but `curl` users find useful.
    aihub: {
      service: service.id,
      name: service.name,
      url: service.url,
      type: service.type || 'AI Service',
      strategy: adapter ? adapter.strategy : 'dom',
      hasApiAdapter: Boolean(adapter && adapter.api),
      models: adapter ? adapter.models : ['default'],
      login: loginState ? loginState.state : 'unknown',
      expiresAt: loginState ? loginState.expiresAt : null
    }
  };
}

function models() {
  return exposedServices().map((service) =>
    modelEntry(service, adapterFor(service.id), loginMonitor.get(service.id))
  );
}

function sessions() {
  const out = {};
  for (const service of exposedServices()) {
    const state = loginMonitor.get(service.id) || { state: 'unknown' };
    out[service.id] = {
      name: service.name,
      state: state.state,
      reason: state.reason || null,
      expiresAt: state.expiresAt || null,
      lastCheckedAt: state.lastCheckedAt || null,
      hasSnapshot: state.hasSnapshot === true,
      adapter: (() => {
        const adapter = adapterFor(service.id);
        return adapter ? { strategy: adapter.strategy, api: Boolean(adapter.api) } : null;
      })()
    };
  }
  return out;
}

/** Map an OpenAI `model` onto an upstream model name the service understands. */
function resolveModel(adapter, requestedModel) {
  if (!adapter) return null;
  const raw = String(requestedModel || '');
  const aliasIndex = (adapter.aliases || []).indexOf(raw.toLowerCase());
  if (aliasIndex > -1 && adapter.models[aliasIndex]) return adapter.models[aliasIndex];
  if (adapter.models.includes(raw)) return raw;
  const colon = raw.indexOf(':');
  const candidate = colon > -1 ? raw.slice(colon + 1) : raw;
  if (adapter.models.includes(candidate)) return candidate;
  return adapter.defaultModel || adapter.models[0] || null;
}

/**
 * @param {object} request normalised chat request
 * @param {{stream?: boolean, signal?: AbortSignal, onDelta?: (text: string) => void}} [streamCtx]
 * @returns {Promise<{text: string, model: string, usage: object, strategy: string, service: string}>}
 */
async function complete(request, streamCtx = {}) {
  const config = configStore.getConfig();
  if (config.apiEnabled === false) throw new EngineError('The local API is disabled', { status: 403 });

  const serviceId = request.serviceId;
  if (!isExposed(serviceId)) {
    return Promise.reject(
      new EngineError(`Service "${serviceId}" is not exposed by this app`, {
        status: 404,
        openaiError: openai.errorOf(
          `Model "${request.model}" is not available. GET /v1/models lists the services this app exposes.`,
          'invalid_request_error',
          { param: 'model', code: 'model_not_found' }
        )
      })
    );
  }

  const adapter = adapterFor(serviceId) || { strategy: 'dom', dom: null, api: null, models: ['default'] };
  const upstreamModel = resolveModel(adapter, request.model);
  const enriched = { ...request, upstreamModel, serviceId, timeoutSeconds: clampTimeout(request.timeoutSeconds) };

  const wanted = request.strategy || adapter.strategy || 'auto';
  const attempts = [];
  if (wanted === 'api') attempts.push('api');
  else if (wanted === 'dom') attempts.push('dom');
  else attempts.push(adapter.api ? 'api' : 'dom', 'dom');

  let lastError = null;
  for (const strategy of dedupe(attempts)) {
    if (strategy === 'api' && !adapter.api) {
      lastError = new EngineError(`${serviceId} has no API adapter; use strategy "dom"`, { status: 400 });
      continue;
    }

    try {
      const entry = hiddenWindows.get(serviceId);
      const run =
        strategy === 'api'
          ? runApiStrategy({ serviceId, adapter, request: enriched, onDelta: streamCtx.onDelta, signal: streamCtx.signal, entry })
          : runDomStrategy({ serviceId, adapter, request: enriched, onDelta: streamCtx.onDelta, signal: streamCtx.signal });

      // eslint-disable-next-line no-await-in-loop
      const result = await run;
      const promptText = request.messages.map((message) => message.content).join('\n');
      return {
        text: result.text,
        model: request.model,
        upstreamModel,
        service: serviceId,
        strategy,
        conversationId: result.conversationId || null,
        usage: openai.usageFrom(promptText, result.text),
        finishReason: 'stop'
      };
    } catch (error) {
      lastError = error;
      const retriable =
        error instanceof EngineError &&
        [
          'no-session',
          'not-signed-in',
          'host_not_allowed',
          'cancelled',
          'composer-missing',
          'no-answer',
          'unresolved-placeholder',
          'load-timeout'
        ].includes(error.code);
      // A hard session failure is worth reporting, not silently retrying.
      // A dead session is fatal for the whole call; "this endpoint shape did not
      // work" is exactly what the next strategy is for.
      const fatal =
        error.code === 'no-session' ||
        error.code === 'not-signed-in' ||
        error.code === 'host_not_allowed' ||
        error.code === 'cancelled';
      if (fatal || !retriable) throw error;
      log.debug(`${serviceId} ${strategy} strategy failed: ${error.message}`);
    }
  }

  throw lastError || new EngineError(`${serviceId} could not be reached`);
}

function clampTimeout(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return API.DEFAULT_TIMEOUT_SECONDS;
  return Math.min(API.MAX_TIMEOUT_SECONDS, Math.max(1, Math.round(seconds)));
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function status() {
  return {
    hiddenWindows: hiddenWindows.size,
    adapters: adapters.size,
    exposed: exposedServices().length,
    limit: configStore.getConfigItem('apiMaxConcurrent', API.DEFAULT_CONCURRENCY)
  };
}

function dispose() {
  stopIdleSweep();
  for (const serviceId of [...hiddenWindows.keys()]) disposeHiddenWindow(serviceId);
  allowListCache.clear();
}

module.exports = {
  setAdapters,
  adapterFor,
  exposedServices,
  isExposed,
  models,
  sessions,
  complete,
  status,
  dispose,
  disposeHiddenWindow,
  sweepIdleWindows,
  assertAllowedHost,
  resolveModel,
  originOf,
  // exposed for tests
  _hiddenWindows: hiddenWindows,
  HIDDEN_IDLE_MS
};
