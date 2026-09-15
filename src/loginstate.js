/**
 * Login-state classification.
 *
 * Pure logic: given what a service's persistent jar contains and where the tab
 * currently is, decide whether the user is signed in, signed out, or being
 * shown a bot challenge. The Electron side (`src/logins.js`) only gathers the
 * inputs and reacts to the verdict.
 *
 * Signals, in order of trust:
 *   1. session cookies declared in the service profile (`session_cookies`);
 *   2. the live URL — a sign-in / OAuth path is a hard "logged out" signal,
 *      a bot-challenge path is *neither* (do not mark the session dead then);
 *   3. an optional DOM probe run inside the tab (`loggedInSelector` /
 *      `signedOutSelector`), used when a service has no usable cookie.
 */

const { STEALTH } = require('./constants');
const { normalizeHostname } = require('./utils');

const STATE = {
  LOGGED_IN: 'logged-in',
  LOGGED_OUT: 'logged-out',
  CHALLENGE: 'challenge',
  UNKNOWN: 'unknown'
};

const SIGNIN_HOSTS = [
  'accounts.google.com',
  'accounts.google',
  'login.microsoftonline.com',
  'login.live.com',
  'login.wikimedia.org',
  'auth.openai.com',
  'auth0.com',
  'secure.huggingface.co',
  'appleid.apple.com'
];

const SIGNIN_PATHS = [
  '/sign-in',
  '/signin',
  '/log-in',
  '/login',
  '/auth',
  '/oauth',
  '/authorize',
  '/accounts/',
  '/id/',
  '/users/sign_in',
  /\/(sign|log)[-_]?in(\/|$|\?)/
];

const CHALLENGE_PATHS = ['/cdn-cgi/challenge-platform', '/challenge', '/__cf_chl', 'turnstile'];

/**
 * Validate one profile entry. Returns `null` for anything unusable so a hostile
 * or stale data file can never inject selectors/regexes into the app.
 *
 * @param {string} serviceId
 * @param {object} raw
 */
function normalizeProfile(raw, serviceId = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const strings = (value, max = 40) =>
    Array.isArray(value)
      ? value
          .filter((item) => typeof item === 'string' && item.trim())
          .map((item) => item.trim().slice(0, 200))
          .slice(0, max)
      : [];

  const cookieNames = strings(raw.session_cookies, 60).map((name) => name.replace(/[^A-Za-z0-9_\-.~=]/g, ''));
  const domains = strings(raw.cookie_domains, 40).map(normalizeHostname).filter(Boolean);

  const selector = (value) =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200 &&
    !/[<>{}]|javascript|expression/i.test(value)
      ? value.trim()
      : null;

  return {
    serviceId: typeof serviceId === 'string' ? serviceId : '',
    label: typeof raw.label === 'string' ? raw.label.slice(0, 60) : '',
    loginUrl: typeof raw.loginUrl === 'string' ? raw.loginUrl.trim().slice(0, 512) : '',
    homeUrl: typeof raw.homeUrl === 'string' ? raw.homeUrl.trim().slice(0, 512) : '',
    cookieNames: cookieNames.filter(Boolean),
    cookieDomains: domains,
    // Any of these substrings in a path means "the page is asking for creds".
    signedOutPaths: strings(raw.signed_out_paths, 30),
    loggedInSelector: selector(raw.loggedInSelector),
    signedOutSelector: selector(raw.signedOutSelector),
    // Some services only consider the session valid with a non-cookie signal.
    requiresLocalstorageKey: typeof raw.requiresLocalstorageKey === 'string' ? raw.requiresLocalstorageKey : null
  };
}

function hostOf(url) {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch (e) {
    return '';
  }
}

function pathOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch (e) {
    return '';
  }
}

/** True when the URL is a Cloudflare/Arkose style interstitial. */
function isChallengeUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  const host = hostOf(url);
  const path = pathOf(url);
  if (STEALTH.CHALLENGE_HOSTS.some((challenge) => host === challenge || host.endsWith(`.${challenge}`))) {
    return true;
  }
  return CHALLENGE_PATHS.some((needle) => path.includes(needle));
}

/** True when the URL looks like a sign-in / OAuth step. */
function isSigninUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  const host = hostOf(url);
  if (!host) return false;
  if (SIGNIN_HOSTS.some((signin) => host === signin || host.endsWith(`.${signin}`))) return true;
  const path = pathOf(url);
  return SIGNIN_PATHS.some((entry) =>
    typeof entry === 'string' ? path.includes(entry) : entry.test(path)
  );
}

/**
 * Does the jar contain a live session cookie for this service?
 *
 * @param {object[]} cookies
 * @param {object|null} profile
 * @param {number} [now]
 * @returns {{found: boolean, names: string[], expiresAt: number|null, expiringSoon: boolean}}
 */
function findSessionCookies(cookies, profile, now = Date.now()) {
  const list = Array.isArray(cookies) ? cookies : [];
  const wanted = profile && Array.isArray(profile.cookieNames) ? profile.cookieNames : [];
  const domains = profile && Array.isArray(profile.cookieDomains) ? profile.cookieDomains : [];

  const nameSet = new Set(wanted.map((name) => name.toLowerCase()));
  const found = [];
  let expiresAt = null;

  for (const cookie of list) {
    if (!cookie || typeof cookie.name !== 'string') continue;
    if (typeof cookie.expirationDate === 'number' && cookie.expirationDate * 1000 <= now) continue;

    const nameMatches = nameSet.size === 0 || nameSet.has(cookie.name.toLowerCase());
    const domainMatches =
      domains.length === 0 ||
      domains.some((domain) => {
        // Cookie domains are dot-prefixed for domain-scoped cookies; strip it
        // before comparing so `.chatgpt.com` matches the `chatgpt.com` rule.
        const host = normalizeHostname(String(cookie.domain || '').replace(/^\.+/, ''));
        return host === domain || host.endsWith(`.${domain}`);
      });

    if (!nameMatches || !domainMatches) continue;

    found.push(cookie.name);
    if (typeof cookie.expirationDate === 'number') {
      const ms = cookie.expirationDate * 1000;
      if (expiresAt === null || ms < expiresAt) expiresAt = ms;
    }
  }

  const expiringSoon = expiresAt !== null && expiresAt - now < 24 * 60 * 60 * 1000;
  return { found: found.length > 0, names: found.slice(0, 6), expiresAt, expiringSoon };
}

/**
 * Classify the login state of one service.
 *
 * @param {{
 *   url?: string,
 *   cookies?: object[],
 *   probe?: {selectorFound?: boolean, signedOutFound?: boolean}|null,
 *   profile?: object|null,
 *   now?: number
 * }} input
 * @returns {{state: string, reason: string, confidence: number, expiresAt: number|null, expiringSoon: boolean}}
 */
function classify(input = {}) {
  const { url, cookies = [], probe = null, profile = null } = input;
  const now = typeof input.now === 'number' ? input.now : Date.now();

  if (typeof url === 'string' && url && isChallengeUrl(url)) {
    return { state: STATE.CHALLENGE, reason: 'challenge-page', confidence: 0.6, expiresAt: null, expiringSoon: false };
  }

  const session = findSessionCookies(cookies, profile, now);

  // A sign-in page wins over the cookie jar: the service is explicitly asking
  // for credentials, which is a stronger signal than a leftover cookie.
  if (typeof url === 'string' && url && isSigninUrl(url)) {
    // Some providers bounce through /signin even while the session is fine, so
    // report low confidence and let the caller debounce.
    return {
      state: session.found ? STATE.UNKNOWN : STATE.LOGGED_OUT,
      reason: 'on-signin-page',
      confidence: session.found ? 0.4 : 0.9,
      expiresAt: session.expiresAt,
      expiringSoon: session.expiringSoon
    };
  }

  if (profile && Array.isArray(profile.signedOutPaths) && typeof url === 'string') {
    const path = pathOf(url);
    if (path && profile.signedOutPaths.some((needle) => path.includes(needle.toLowerCase()))) {
      return {
        state: STATE.LOGGED_OUT,
        reason: 'signed-out-path',
        confidence: 0.8,
        expiresAt: session.expiresAt,
        expiringSoon: session.expiringSoon
      };
    }
  }

  if (session.found) {
    const boosted = probe && probe.selectorFound === true;
    return {
      state: STATE.LOGGED_IN,
      reason: boosted ? 'session-cookie+dom' : 'session-cookie',
      confidence: boosted ? 0.98 : 0.9,
      expiresAt: session.expiresAt,
      expiringSoon: session.expiringSoon
    };
  }

  if (probe && probe.selectorFound === true) {
    return {
      state: STATE.LOGGED_IN,
      reason: 'dom',
      confidence: 0.7,
      expiresAt: null,
      expiringSoon: false
    };
  }

  if (probe && probe.signedOutFound === true) {
    return {
      state: STATE.LOGGED_OUT,
      reason: 'dom-signin-prompt',
      confidence: 0.85,
      expiresAt: null,
      expiringSoon: false
    };
  }

  // The service *has* a fingerprint and its session cookie is simply not in the
  // jar: that is an explicit negative, and the difference from "we have no idea"
  // is what makes re-login on open safe to automate.
  const hasFingerprint = Boolean(profile && Array.isArray(profile.cookieNames) && profile.cookieNames.length > 0);
  if (hasFingerprint) {
    return {
      state: STATE.LOGGED_OUT,
      reason: 'session-cookie-missing',
      confidence: 0.8,
      expiresAt: session.expiresAt,
      expiringSoon: session.expiringSoon
    };
  }

  return {
    state: STATE.UNKNOWN,
    reason: 'no-signal',
    confidence: 0.2,
    expiresAt: session.expiresAt,
    expiringSoon: session.expiringSoon
  };
}

/**
 * Should we proactively ask the user to sign in again?
 *
 * Only when we *know* they were signed in before (a persisted "logged-in"
 * record) and the service now says otherwise. Never on the first launch, and
 * never while a bot challenge is on screen.
 *
 * @param {{previous?: string|null, current?: string, currentReason?: string, now?: number, lastAttemptAt?: number|null}} args
 * @param {number} [graceMs]
 * @returns {boolean}
 */
function shouldRelogin({ previous, current, currentReason, now = Date.now(), lastAttemptAt = null }, graceMs) {
  if (previous !== STATE.LOGGED_IN) return false;
  if (current === STATE.CHALLENGE) return false;
  if (current === STATE.UNKNOWN && currentReason === 'no-signal') return false;
  if (current === STATE.LOGGED_IN || current === STATE.UNKNOWN) return false;
  if (typeof lastAttemptAt === 'number' && now - lastAttemptAt < (graceMs || 0)) return false;
  return true;
}

/** Where to send the user to sign in again. */
function loginUrlFor(profile, service) {
  const fromProfile = profile && profile.loginUrl;
  if (typeof fromProfile === 'string' && /^https:\/\//i.test(fromProfile)) return fromProfile;
  const url = service && service.url;
  return typeof url === 'string' && url ? url : null;
}

/** True when the session is close to expiry and should be refreshed. */
function needsKeepAlive(record, now = Date.now(), thresholdMs = 7 * 24 * 60 * 60 * 1000) {
  if (!record || record.state !== STATE.LOGGED_IN) return false;
  if (typeof record.expiresAt !== 'number') return false;
  return record.expiresAt - now < thresholdMs;
}

module.exports = {
  STATE,
  SIGNIN_PATHS,
  normalizeProfile,
  classify,
  shouldRelogin,
  loginUrlFor,
  isChallengeUrl,
  isSigninUrl,
  findSessionCookies,
  needsKeepAlive,
  hostOf,
  pathOf
};
