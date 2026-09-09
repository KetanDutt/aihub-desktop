/**
 * Domain allow-list engine.
 *
 * Every `WebContentsView` (tab) gets its own allow-list, computed once when the
 * tab is created: the domains of its service, plus the shared authentication
 * domains (Google/Microsoft/… sign-in flows) and a couple of captcha/payment
 * providers that almost every AI service needs.
 *
 * Matching is suffix based, so `openai.com` also allows `cdn.openai.com`, while
 * `notopenai.com` is correctly rejected.
 */

const { session } = require('electron');
const log = require('electron-log');
const { normalizeHostname } = require('./utils');

const state = {
  enabled: true,
  // When true, requests that cannot be attributed to a registered tab are
  // blocked instead of allowed. Off by default so the app can never brick
  // itself when Electron reports an unexpected webContentsId.
  strict: false,
  commonAuthDomains: new Set(),
  alwaysAllowedDomains: new Set()
};

/** webContentsId -> Set<string> of allowed domains */
const tabDomainMap = new Map();

/** webContents ids that bypass filtering entirely (the app shell UI). */
const trustedWebContents = new Set();

/** Counters surfaced in the status bar / logs. */
const stats = { blocked: 0, allowed: 0 };

/**
 * Suffix-aware allow-list check.
 *
 * Walks the hostname from the most specific label upwards, so the cost is
 * proportional to the number of labels (2-4) instead of the size of the
 * allow-list.
 *
 * @param {string} hostname
 * @param {Set<string>|string[]} serviceDomains
 * @param {boolean} blockingEnabled
 * @param {Set<string>|string[]} [commonAuthDomains]
 * @returns {boolean}
 */
function isDomainAllowed(hostname, serviceDomains, blockingEnabled, commonAuthDomains) {
  if (!blockingEnabled) return true;

  const host = normalizeHostname(hostname);
  if (!host) return false;

  const auth = commonAuthDomains || state.commonAuthDomains;
  const extra = state.alwaysAllowedDomains;
  let current = host;

  while (current) {
    if (auth && typeof auth.has === 'function' && auth.has(current)) return true;
    if (auth && Array.isArray(auth) && auth.includes(current)) return true;
    if (extra.has(current)) return true;
    if (serviceDomains) {
      if (typeof serviceDomains.has === 'function' && serviceDomains.has(current)) return true;
      if (Array.isArray(serviceDomains) && serviceDomains.includes(current)) return true;
    }

    const dotIndex = current.indexOf('.');
    if (dotIndex === -1) break;
    current = current.substring(dotIndex + 1);
  }

  return false;
}

/** Build the allow-list for one tab (service domains ∪ shared domains). */
function buildAllowList(serviceId, rules) {
  const allowed = new Set();
  const serviceDomains = (rules && rules.service_domains && rules.service_domains[serviceId]) || [];
  for (const domain of serviceDomains) {
    const normalized = normalizeHostname(domain);
    if (normalized) allowed.add(normalized);
  }
  return allowed;
}

/**
 * Register (or refresh) the allow-list for a tab.
 * @param {number} webContentsId
 * @param {string} serviceId
 * @param {object|null} rules
 * @returns {Set<string>} the allow-list in effect
 */
function updateTabDomains(webContentsId, serviceId, rules) {
  const allowed = buildAllowList(serviceId, rules);
  tabDomainMap.set(webContentsId, allowed);
  log.debug(`Allow-list for webContents ${webContentsId} (${serviceId}): ${allowed.size} domains`);
  return allowed;
}

/** Forget a tab's allow-list (called when a view is destroyed). */
function removeTabDomains(webContentsId) {
  tabDomainMap.delete(webContentsId);
  trustedWebContents.delete(webContentsId);
}

/** Mark a webContents as trusted (the app shell UI must never be filtered). */
function registerTrustedWebContents(webContentsId) {
  trustedWebContents.add(webContentsId);
}

/** Replace the global blocking configuration. */
function updateBlockingState(config, rules) {
  state.enabled = Boolean(config && config.blockingEnabled);
  state.strict = Boolean(config && config.strictBlocking);

  const common = (rules && rules.common_auth_domains) || [];
  state.commonAuthDomains = new Set(
    common.map(normalizeHostname).filter(Boolean)
  );

  const always = (rules && rules.always_allowed_domains) || [];
  state.alwaysAllowedDomains = new Set(always.map(normalizeHostname).filter(Boolean));

  return getBlockingSnapshot();
}

/** @returns {{enabled: boolean, commonAuthDomains: number, tabs: number}} */
function getBlockingSnapshot() {
  return {
    enabled: state.enabled,
    strict: state.strict,
    commonAuthDomains: state.commonAuthDomains.size,
    alwaysAllowed: state.alwaysAllowedDomains.size,
    tabs: tabDomainMap.size
  };
}

/** @returns {{blocked: number, allowed: number}} */
function getStats() {
  return { ...stats };
}

function resetStats() {
  stats.blocked = 0;
  stats.allowed = 0;
}

/** Protocols/hosts that must never be filtered (local UI, devtools, …). */
function isInternalUrl(url) {
  return (
    url.startsWith('file://') ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('about:') ||
    url.startsWith('http://localhost') ||
    url.startsWith('https://localhost') ||
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('https://127.0.0.1')
  );
}

/**
 * Decide whether a single request should proceed.
 * Exported separately so it can be unit tested without Electron.
 *
 * @param {{url: string, webContentsId?: number}} details
 * @returns {{allow: boolean, hostname?: string, reason?: string}}
 */
function evaluateRequest(details) {
  if (!details || typeof details.url !== 'string') {
    return { allow: true, reason: 'no-url' };
  }

  if (isInternalUrl(details.url)) return { allow: true, reason: 'internal' };

  if (!state.enabled) return { allow: true, reason: 'disabled' };

  let url;
  try {
    url = new URL(details.url);
  } catch (e) {
    // Unparsable URLs cannot be matched against the allow-list; let Chromium
    // deal with them (it will reject genuinely malformed ones).
    return { allow: true, reason: 'unparsable' };
  }

  const webContentsId = details.webContentsId;
  if (webContentsId !== undefined && trustedWebContents.has(webContentsId)) {
    return { allow: true, hostname: url.hostname, reason: 'trusted' };
  }

  const allowedDomains =
    webContentsId !== undefined && tabDomainMap.has(webContentsId)
      ? tabDomainMap.get(webContentsId)
      : null;

  if (allowedDomains === null) {
    // Unknown webContents (a popup, a service worker, a request fired before
    // the tab registered itself). Fail *open* by default so the app can never
    // brick itself; the navigation guard in `security.js` keeps popups inside
    // their service. `strictBlocking` flips this to fail-closed.
    if (state.strict) {
      stats.blocked += 1;
      return { allow: false, hostname: url.hostname, reason: 'unknown-webcontents' };
    }
    return { allow: true, hostname: url.hostname, reason: 'unknown-webcontents' };
  }

  const allowed = isDomainAllowed(url.hostname, allowedDomains, true, state.commonAuthDomains);
  if (allowed) {
    stats.allowed += 1;
    return { allow: true, hostname: url.hostname, reason: 'allowed' };
  }

  stats.blocked += 1;
  return { allow: false, hostname: url.hostname, reason: 'blocked' };
}

/**
 * Install the global `onBeforeRequest` filter on the default session.
 * Idempotent: calling it again just replaces the listener.
 */
function setupWebRequestBlocking(targetSession) {
  const ses = targetSession || session.defaultSession;
  if (!ses || !ses.webRequest) {
    log.warn('No session available, domain blocking disabled');
    return false;
  }

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    try {
      const decision = evaluateRequest(details);
      if (!decision.allow) {
        log.info(`Blocked ${decision.hostname} (webContents ${details.webContentsId})`);
        callback({ cancel: true });
        return;
      }
      callback({});
    } catch (e) {
      log.error('Error in request filter:', e);
      callback({});
    }
  });

  log.info('Domain blocking filter installed');
  return true;
}

/** Remove the filter (used on quit and in tests). */
function teardownWebRequestBlocking(targetSession) {
  const ses = targetSession || session.defaultSession;
  if (ses && ses.webRequest) ses.webRequest.onBeforeRequest(null);
  tabDomainMap.clear();
  trustedWebContents.clear();
}

/** Test helper. */
function _resetForTests() {
  tabDomainMap.clear();
  trustedWebContents.clear();
  state.commonAuthDomains = new Set();
  state.alwaysAllowedDomains = new Set();
  state.enabled = true;
  state.strict = false;
  resetStats();
}

module.exports = {
  isDomainAllowed,
  buildAllowList,
  updateTabDomains,
  removeTabDomains,
  registerTrustedWebContents,
  updateBlockingState,
  getBlockingSnapshot,
  getStats,
  resetStats,
  evaluateRequest,
  isInternalUrl,
  setupWebRequestBlocking,
  teardownWebRequestBlocking,
  _resetForTests
};
