/**
 * Login monitor.
 *
 * Watches every service session and keeps a small, honest model of it:
 *
 *   logged-in   — the service's own session cookie is in the jar
 *   logged-out  — no session cookie, or the page is a login wall
 *   challenge   — a bot-challenge interstitial is up (never treated as logout)
 *   unknown     — not enough evidence yet
 *
 * On top of that model it does the two things the user asked for:
 *   - **relogin on open**: services that were signed in last session but are no
 *     longer get their sign-in page reopened automatically (or their existing
 *     tab re-authenticated), instead of silently failing all day;
 *   - **keep the login warm**: a background ping rolls the service's own token
 *     forward before it lapses, then re-caches the new cookies.
 *
 * It only ever *reads* page state (one read-only selector probe); it never
 * touches credentials, and there is no autofill or credential capture here.
 */

const { ipcMain } = require('electron');
const log = require('electron-log');

const configStore = require('./config');
const dataStore = require('./data');
const sessionStore = require('./sessionstore');
const loginstate = require('./loginstate');
const { IPC, SESSION } = require('./constants');
const { delay } = require('./utils');

const STATE = loginstate.STATE;

/** serviceId -> record */
const records = new Map();
/** webContentsId -> { serviceId, contents } */
const watched = new Map();
/** serviceId -> debounced check handle */
const pending = new Map();
/** sessions we already attached a cookie listener to */
const cookieListeners = new Set();

let sweepTimer = null;
let broadcast = () => {};
let onReloginRequested = null;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

function loadRecords() {
  const stored = configStore.getConfigItem('sessionStates', {}) || {};
  for (const [serviceId, record] of Object.entries(stored)) {
    if (!record || typeof record !== 'object') continue;
    records.set(serviceId, {
      serviceId,
      state: record.state || STATE.UNKNOWN,
      reason: record.reason || 'restored',
      confidence: typeof record.confidence === 'number' ? record.confidence : 0,
      expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : null,
      url: typeof record.url === 'string' ? record.url : '',
      signedInAt: typeof record.signedInAt === 'number' ? record.signedInAt : null,
      lastCheckedAt: typeof record.lastCheckedAt === 'number' ? record.lastCheckedAt : null,
      lastReloginAt: typeof record.lastReloginAt === 'number' ? record.lastReloginAt : null,
      keepAliveAt: typeof record.keepAliveAt === 'number' ? record.keepAliveAt : null
    });
  }
}

function persistRecords() {
  const snapshot = {};
  for (const [serviceId, record] of records) {
    snapshot[serviceId] = {
      state: record.state,
      reason: record.reason,
      confidence: record.confidence,
      expiresAt: record.expiresAt,
      url: record.url,
      signedInAt: record.signedInAt,
      lastCheckedAt: record.lastCheckedAt,
      lastReloginAt: record.lastReloginAt,
      keepAliveAt: record.keepAliveAt
    };
  }
  try {
    configStore.updateConfigItem('sessionStates', snapshot);
  } catch (error) {
    log.debug(`Unable to persist login states: ${error.message}`);
  }
}

function publicRecord(record) {
  if (!record) return null;
  return {
    serviceId: record.serviceId,
    state: record.state,
    reason: record.reason,
    confidence: record.confidence,
    expiresAt: record.expiresAt,
    signedInAt: record.signedInAt,
    lastCheckedAt: record.lastCheckedAt,
    lastReloginAt: record.lastReloginAt,
    keepAliveAt: record.keepAliveAt,
    url: record.url,
    hasSnapshot: sessionStore.hasSnapshot(record.serviceId)
  };
}

function getAll() {
  const out = {};
  for (const [serviceId, record] of records) out[serviceId] = publicRecord(record);
  return out;
}

function get(serviceId) {
  return publicRecord(records.get(serviceId));
}

function serviceById(serviceId) {
  const cache = dataStore.getServicesCache();
  const list = (cache && cache.ai_services) || [];
  return list.find((service) => service.id === serviceId) || null;
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/**
 * Read-only DOM probe: "does the signed-in chrome exist / is a login prompt up?".
 * Runs in the page's main world but only ever queries selectors from our own
 * fingerprint file, and never returns page content.
 */
async function probeDom(contents, profile) {
  if (!contents || contents.isDestroyed()) return null;
  if (!profile || (!profile.loggedInSelector && !profile.signedOutSelector)) return null;

  const script = `(() => {
    const check = (selector) => {
      if (!selector) return false;
      try { return Boolean(document.querySelector(selector)); } catch (e) { return false; }
    };
    return JSON.stringify({
      loggedIn: check(${JSON.stringify(profile.loggedInSelector || '')}),
      signedOut: check(${JSON.stringify(profile.signedOutSelector || '')})
    });
  })()`;

  try {
    const raw = await contents.executeJavaScript(script, true);
    const parsed = JSON.parse(String(raw || '{}'));
    return { selectorFound: parsed.loggedIn === true, signedOutFound: parsed.signedOut === true };
  } catch (error) {
    return null;
  }
}

/**
 * Recompute the state of one service.
 * @param {{probe?: boolean}} [options] skip the DOM probe for background sweeps
 */
async function check(serviceId, { probe = true, url = null } = {}) {
  const profile = sessionStore.profileFor(serviceId);
  const service = serviceById(serviceId);

  let currentUrl = url;
  let contents = null;
  for (const entry of watched.values()) {
    if (entry.serviceId === serviceId && entry.contents && !entry.contents.isDestroyed()) {
      contents = entry.contents;
      break;
    }
  }
  if (!currentUrl && contents) {
    try {
      currentUrl = contents.getURL();
    } catch (e) {
      currentUrl = '';
    }
  }

  const cookies = await sessionStore.readCookies(serviceId, service);
  const probeResult =
    probe && contents ? await probeDom(contents, profile) : null;

  const verdict = loginstate.classify({
    url: currentUrl || (service && service.url) || '',
    cookies,
    probe: probeResult,
    profile
  });

  const previous = records.get(serviceId) || { state: STATE.UNKNOWN };
  const now = Date.now();
  const record = {
    serviceId,
    state: verdict.state,
    reason: verdict.reason,
    confidence: verdict.confidence,
    expiresAt: verdict.expiresAt,
    url: currentUrl || previous.url || '',
    signedInAt:
      verdict.state === STATE.LOGGED_IN
        ? previous.state === STATE.LOGGED_IN
          ? previous.signedInAt || now
          : now
        : previous.signedInAt || null,
    lastCheckedAt: now,
    lastReloginAt: previous.lastReloginAt || null,
    keepAliveAt: previous.keepAliveAt || null
  };

  const changed = previous.state !== record.state;
  records.set(serviceId, record);

  if (changed) {
    log.info(`Login state for ${serviceId}: ${previous.state} -> ${record.state} (${record.reason})`);
    // "Was signed in before" has to outlive this run: it is the only evidence
    // relogin-on-open works from, and the snapshot is what makes the next
    // launch resume instead of starting over.
    persistRecords();
    sessionStore.snapshotService(serviceId, service).catch(() => {});
  }

  broadcast({
    serviceId: record.serviceId,
    previous: previous.state,
    state: record.state,
    reason: record.reason,
    confidence: record.confidence,
    expiresAt: record.expiresAt,
    changed
  });

  return record;
}

/** Collapse rapid events (cookie churn, redirect chains) into one check. */
function scheduleCheck(serviceId, options = {}, ms = 1200) {
  if (!serviceId) return;
  if (pending.has(serviceId)) clearTimeout(pending.get(serviceId));
  const timer = setTimeout(() => {
    pending.delete(serviceId);
    check(serviceId, options).catch((error) => log.debug(`Login check failed: ${error.message}`));
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  pending.set(serviceId, timer);
}

// ---------------------------------------------------------------------------
// Tab observation
// ---------------------------------------------------------------------------

/** Attach the monitor to a tab's webContents (called by `src/window.js`). */
function observe(contents, serviceId) {
  if (!contents || !serviceId) return false;

  watched.set(contents.id, { serviceId, contents });
  contents.on('did-navigate', () => scheduleCheck(serviceId, {}, 600));
  contents.on('did-navigate-in-page', () => scheduleCheck(serviceId, { probe: false }, 2500));
  contents.on('did-finish-load', () => scheduleCheck(serviceId, {}, 800));
  contents.on('destroyed', () => {
    watched.delete(contents.id);
  });

  // Cookie changes are the earliest possible signal of a login/logout.
  const ses = sessionStore.sessionFor(serviceId);
  if (ses && ses.cookies && !cookieListeners.has(ses.id ?? serviceId)) {
    cookieListeners.add(ses.id ?? serviceId);
    ses.cookies.on('changed', (event, cookie) => {
      const affected = [...watched.values()].map((entry) => entry.serviceId);
      const domain = String((cookie && cookie.domain) || '').replace(/^\./, '');
      for (const serviceIdOf of new Set(affected)) {
        const domains = sessionStore.cookieDomainsFor(serviceIdOf);
        if (domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
          scheduleCheck(serviceIdOf, {}, 800);
        }
      }
    });
  }

  scheduleCheck(serviceId, {}, 1500);
  return true;
}

function unobserve(webContentsId) {
  watched.delete(webContentsId);
}

// ---------------------------------------------------------------------------
// Relogin on open
// ---------------------------------------------------------------------------

/**
 * Start a sign-in for one service: reuse its open tab when there is one,
 * otherwise ask the window manager for a new tab (which may hit the tab limit —
 * the caller decides how loud to be about that).
 *
 * @param {string} serviceId
 * @param {{reason?: string}} [options]
 */
async function relogin(serviceId, { reason = 'manual' } = {}) {
  const service = serviceById(serviceId);
  const profile = sessionStore.profileFor(serviceId);
  const target = loginstate.loginUrlFor(profile, service);
  if (!target) return { ok: false, error: 'no-login-url' };

  const record = records.get(serviceId) || { serviceId, state: STATE.UNKNOWN };
  record.lastReloginAt = Date.now();
  records.set(serviceId, record);

  if (typeof onReloginRequested === 'function') {
    const result = onReloginRequested({ serviceId, url: target, reason });
    if (result && typeof result.then === 'function') await result;
  }

  persistRecords();
  log.info(`Relogin started for ${serviceId} (${reason})`);
  return { ok: true, serviceId, url: target, reason };
}

/**
 * The launch pass: anything that was signed in in a previous session and no
 * longer is gets its sign-in page opened, so the user can click through once
 * instead of discovering the dead session mid-task.
 *
 * @param {string[]} serviceIds services that currently have a tab
 */
async function reloginOnOpen(serviceIds = []) {
  if (!configStore.getConfigItem('autoRelogin', true)) {
    return { attempted: [], skipped: 'disabled' };
  }
  if (configStore.getConfigItem('sessionPersistence', true) === false) {
    return { attempted: [], skipped: 'no-persistence' };
  }

  const now = Date.now();
  const candidates = [];
  const watchedIds = new Set([...watched.values()].map((entry) => entry.serviceId));
  const consider = new Set([...serviceIds, ...watchedIds, ...records.keys()]);

  for (const serviceId of consider) {
    const previous = records.get(serviceId);
    if (!previous) continue;

    // eslint-disable-next-line no-await-in-loop
    const record = await check(serviceId, { probe: false });
    if (
      loginstate.shouldRelogin(
        {
          previous: previous.state,
          current: record.state,
          currentReason: record.reason,
          now,
          lastAttemptAt: record.lastReloginAt
        },
        SESSION.RELOGIN_GRACE_MS
      )
    ) {
      candidates.push(serviceId);
    }
  }

  const attempted = [];
  for (const serviceId of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await relogin(serviceId, { reason: 'expired-on-launch' });
    if (result.ok) attempted.push(serviceId);
  }

  if (attempted.length > 0) {
    log.info(`Relogin-on-open triggered for: ${attempted.join(', ')}`);
  }
  return { attempted };
}

let lastFullSnapshotAt = 0;

/**
 * Periodic full snapshot: the safety net under "your login survives anything"
 * (crash, killed renderer, cache eviction). Cheap because it is a cookie read
 * per service, and it is also what a crash leaves behind.
 */
async function maybeSnapshotAll() {
  const now = Date.now();
  if (now - lastFullSnapshotAt < SESSION.SNAPSHOT_INTERVAL_MS) return { skipped: true };
  lastFullSnapshotAt = now;

  const services = ((dataStore.getServicesCache() || {}).ai_services) || [];
  const warm = services.filter((service) => {
    const record = records.get(service.id);
    return record && record.state === STATE.LOGGED_IN;
  });
  if (warm.length === 0) return { skipped: true, warm: 0 };

  const result = await sessionStore.snapshotAll(warm);
  return { skipped: false, ...result };
}

/** Force a credential-less refresh of the cookie cache for warm sessions. */
async function keepAlivePass() {
  if (!configStore.getConfigItem('keepAliveSessions', true)) return { touched: [] };

  const intervalMs = Math.max(
    SESSION.MIN_KEEPALIVE_MINUTES,
    Math.min(
      SESSION.MAX_KEEPALIVE_MINUTES,
      configStore.getConfigItem('keepAliveMinutes', SESSION.DEFAULT_KEEPALIVE_MINUTES) ||
        SESSION.DEFAULT_KEEPALIVE_MINUTES
    )
  ) * 60000;

  const now = Date.now();
  const touched = [];

  for (const [serviceId, record] of records) {
    if (record.state !== STATE.LOGGED_IN) continue;

    const dueByInterval = !record.keepAliveAt || now - record.keepAliveAt >= intervalMs;
    const nearExpiry = loginstate.needsKeepAlive(record, now);
    if (!dueByInterval && !nearExpiry) continue;

    const service = serviceById(serviceId);
    // eslint-disable-next-line no-await-in-loop
    const result = await sessionStore.touchService(serviceId, service);
    record.keepAliveAt = now;
    records.set(serviceId, record);

    if (result.ok) touched.push(serviceId);
    else log.debug(`Keep-alive ping failed for ${serviceId}: ${result.error || result.status}`);

    // Be gentle: never hammer several services at the same instant.
    // eslint-disable-next-line no-await-in-loop
    await delay(250);
  }

  if (touched.length > 0) {
    persistRecords();
    log.info(`Session keep-alive refreshed: ${touched.join(', ')}`);
  }

  const snapshot = await maybeSnapshotAll();
  return { touched, snapshot };
}

function startSweeps() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    keepAlivePass().catch((error) => log.debug(`Keep-alive sweep failed: ${error.message}`));
  }, SESSION.SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

function stopSweeps() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Install the monitor: IPC, renderer broadcast and the background sweeps.
 *
 * @param {{send?: (channel: string, payload: object) => void,
 *           onRelogin?: (request: {serviceId: string, url: string, reason: string}) => void}} [hooks]
 */
function setup({ send, onRelogin } = {}) {
  broadcast = (payload) => {
    if (typeof send === 'function') send(IPC.LOGIN_STATE, payload);
  };
  onReloginRequested = onRelogin || null;

  loadRecords();
  startSweeps();

  ipcMain.handle(IPC.GET_LOGIN_STATES, () => getAll());
  ipcMain.handle(IPC.RELOGIN_SERVICE, async (event, payload) => {
    const serviceId = typeof payload === 'string' ? payload : payload && payload.serviceId;
    if (!serviceId || !/^[a-z0-9]{1,64}$/.test(String(serviceId))) {
      return { ok: false, error: 'invalid_service' };
    }
    return relogin(String(serviceId).toLowerCase(), { reason: 'manual' });
  });
  ipcMain.handle(IPC.TOUCH_SESSION, async (event, serviceId) => {
    if (!serviceId || !/^[a-z0-9]{1,64}$/.test(String(serviceId))) return { ok: false };
    const result = await sessionStore.touchService(String(serviceId).toLowerCase(), serviceById(String(serviceId).toLowerCase()));
    if (result.ok) await check(String(serviceId).toLowerCase(), { probe: false });
    return result;
  });

  return { ok: true };
}

/** Called on quit: cache everything while the sessions are still alive. */
async function flush() {
  persistRecords();
  try {
    const services = ((dataStore.getServicesCache() || {}).ai_services) || [];
    await sessionStore.snapshotAll(services.filter((s) => records.get(s.id)));
  } catch (error) {
    log.debug(`Flush on quit skipped: ${error.message}`);
  }
  stopSweeps();
}

/** After the cached cookies have been replayed, work out where we stand. */
async function primeFromCache(services = []) {
  for (const service of services) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await check(service.id, { probe: false });
    } catch (error) {
      log.debug(`Prime check failed for ${service.id}: ${error.message}`);
    }
  }
  persistRecords();
  return getAll();
}

/** Test helper: forget tabs, records and queued checks. */
function _resetForTests() {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  watched.clear();
  records.clear();
}

module.exports = {
  STATE,
  _resetForTests,
  setup,
  observe,
  unobserve,
  check,
  scheduleCheck,
  relogin,
  reloginOnOpen,
  keepAlivePass,
  maybeSnapshotAll,
  primeFromCache,
  getAll,
  get,
  startSweeps,
  stopSweeps,
  flush,
  persistRecords,
  _records: records,
  _watched: watched
};
