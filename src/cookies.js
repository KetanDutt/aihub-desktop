/**
 * Cookie cache primitives.
 *
 * Pure logic (no Electron) so it can be unit tested and reused by both the
 * session store and the login watcher.
 *
 * Why this exists: Chromium drops *session* cookies (those without an
 * `expirationDate`) when the process exits. Several AI services keep their
 * auth token in exactly such a cookie, which is why a "stay signed in"
 * experience is flaky in embedded browsers. `pinCookie()` re-stamps a session
 * cookie with a bounded expiry so Chromium writes it to disk, and
 * `mergeCookies()` replays the saved snapshot on the next launch.
 *
 * Values are secrets: they only ever go to a 0600 file inside the user data
 * directory and are never handed to the renderer.
 */

const { SESSION } = require('./constants');

/**
 * Normalise a cookie *domain* — deliberately not `normalizeHostname()`:
 * Chromium reports domain-scoped cookies with a leading dot, and that dot is
 * part of the identity. Stripping it would make a snapshot look like a different
 * cookie than the one already in the jar and replay duplicates.
 */
function normalizeCookieDomain(value) {
  if (typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  if (!host) return '';
  const colon = host.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) host = host.slice(0, colon);
  const dotted = host.startsWith('.');
  host = host.replace(/^\.+/, '');
  if (!host || /[/\s]/.test(host)) return '';
  return dotted ? `.${host}` : host;
}

/** Names that are almost always the auth token of their service. */
const SESSION_COOKIE_HINTS = [
  'session',
  'sessiontoken',
  'auth',
  'token',
  'sid',
  'jsessionid',
  'connect.sid',
  'cf_clearance',
  '__Secure-',
  '__Host-'
];

/**
 * Sanitise anything that looks like a cookie into the shape
 * `session.cookies.set()` accepts. Unknown/unsafe keys are dropped.
 *
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeCookie(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const value = typeof raw.value === 'string' ? raw.value : '';
  if (!name || name.length > 512) return null;
  if (value.length > 16 * 1024) return null;

  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const domain = normalizeCookieDomain(raw.domain);
  if (!url && !domain) return null;

  const path = typeof raw.path === 'string' && raw.path.startsWith('/') ? raw.path : '/';

  let expirationDate = null;
  if (typeof raw.expirationDate === 'number' && Number.isFinite(raw.expirationDate)) {
    // Chromium uses *seconds* since the epoch; keep that unit.
    expirationDate = Math.floor(raw.expirationDate);
  }

  const sameSite = ['strict', 'lax', 'no_restriction'].includes(raw.sameSite) ? raw.sameSite : undefined;

  return {
    name,
    value,
    ...(url ? { url } : {}),
    ...(domain ? { domain } : {}),
    path,
    ...(expirationDate !== null ? { expirationDate } : {}),
    secure: Boolean(raw.secure),
    httpOnly: Boolean(raw.httpOnly),
    ...(sameSite ? { sameSite } : {}),
    sessionOnly: expirationDate === null
  };
}

/** True when a cookie is worth caching for login stability. */
function isAuthCookie(cookie) {
  if (!cookie || typeof cookie.name !== 'string') return false;
  const name = cookie.name.toLowerCase();
  if (cookie.sessionOnly) return true;
  return SESSION_COOKIE_HINTS.some((hint) => name.includes(hint.toLowerCase()));
}

/**
 * Return a cookie that will survive a restart.
 *
 * Session cookies are given a bounded lifetime (`COOKIE_PIN_LIFETIME_MS`) so
 * Chromium persists them; cookies that already expire further out are left
 * untouched, so we never *extend* a token the service deliberately short-lived.
 *
 * @param {object} cookie normalised cookie
 * @param {number} [now] epoch ms
 * @param {number} [lifetimeMs]
 * @returns {object} a copy, pinned when needed
 */
function pinCookie(cookie, now = Date.now(), lifetimeMs = SESSION.COOKIE_PIN_LIFETIME_MS) {
  const pinned = { ...cookie };
  const nowSeconds = Math.floor(now / 1000);

  if (pinned.sessionOnly || typeof pinned.expirationDate !== 'number') {
    pinned.expirationDate = nowSeconds + Math.floor(lifetimeMs / 1000);
    pinned.sessionOnly = false;
    pinned._pinned = true;
    return pinned;
  }

  // Keep a healthy margin: never shorten a still-valid cookie.
  if (pinned.expirationDate < nowSeconds + Math.floor(SESSION.COOKIE_PIN_MIN_REMAINING_MS / 1000)) {
    pinned.expirationDate = nowSeconds + Math.floor(lifetimeMs / 1000);
    pinned.sessionOnly = false;
    pinned._pinned = true;
  }
  return pinned;
}

/** Drop cookies the browser has already expired (or that look absurdly old). */
function isCookieFresh(cookie, now = Date.now()) {
  if (!cookie) return false;
  if (typeof cookie.expirationDate !== 'number') return true;
  const expiresMs = cookie.expirationDate * 1000;
  if (expiresMs <= now) return false;
  // A snapshot that predates `COOKIE_MAX_AGE_MS` is not worth replaying.
  return true;
}

/** Stable key for de-duplication: the exact tuple the browser stores on. */
function cookieKey(cookie) {
  return `${cookie.domain || ''}|${cookie.name}|${cookie.path || '/'}`;
}

/**
 * Merge a saved snapshot into the live jar.
 *
 * @param {object[]} live cookies currently in the session
 * @param {object[]} saved cookies from the snapshot
 * @param {number} [now]
 * @returns {{toRestore: object[], liveKeys: Set<string>}} only missing/older entries
 */
function mergeCookies(live, saved, now = Date.now()) {
  const liveKeys = new Set((live || []).map(cookieKey));
  const seen = new Set();
  const toRestore = [];

  for (const raw of saved || []) {
    const cookie = normalizeCookie(raw);
    if (!cookie) continue;
    if (!isCookieFresh(cookie, now)) continue;

    const key = cookieKey(cookie);
    if (liveKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    toRestore.push(cookie);
  }

  return { toRestore, liveKeys };
}

/**
 * Cap + shape a cookie list for disk. Returns a compact array plus the count of
 * entries that were dropped so the UI can report truncation honestly.
 */
function prepareSnapshot(cookies, max = SESSION.MAX_COOKIES_PER_SERVICE) {
  const list = Array.isArray(cookies) ? cookies : [];
  const entries = [];
  let dropped = 0;

  for (const raw of list) {
    const cookie = normalizeCookie(raw);
    if (!cookie) {
      dropped += 1;
      continue;
    }
    if (entries.length >= max) {
      dropped += 1;
      continue;
    }
    entries.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || undefined,
      path: cookie.path,
      ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
    });
  }

  return { entries, dropped };
}

/** `openai.com -> 3 cookies, 2 pinned` style summary for the UI. */
function summarise(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  let pinned = 0;
  let auth = 0;
  let expiresAt = null;

  for (const cookie of list) {
    if (cookie && cookie._pinned) pinned += 1;
    if (isAuthCookie(cookie)) auth += 1;
    if (cookie && typeof cookie.expirationDate === 'number') {
      const ms = cookie.expirationDate * 1000;
      if (expiresAt === null || ms < expiresAt) expiresAt = ms;
    }
  }

  return {
    count: list.length,
    pinned,
    auth,
    expiresAt
  };
}

module.exports = {
  SESSION_COOKIE_HINTS,
  normalizeCookieDomain,
  normalizeCookie,
  isAuthCookie,
  isCookieFresh,
  pinCookie,
  cookieKey,
  mergeCookies,
  prepareSnapshot,
  summarise
};
