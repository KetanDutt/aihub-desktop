/**
 * Small helpers shared by main-process modules.
 *
 * Kept dependency-free so it can be unit tested without mocking Electron.
 */

const { LIMITS } = require('./constants');

/**
 * Slugify a service name into the stable id used across config, deep links and
 * the renderer (`ChatGPT` -> `chatgpt`, `Meta AI` -> `metaai`).
 *
 * The renderer keeps an identical implementation in `ui/utils.js`; a test
 * asserts the two stay in sync.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  if (typeof name !== 'string') return '';
  return name.toLowerCase().trim().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

/** Clamp a number into [min, max], returning `fallback` when not finite. */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Coerce anything to a boolean. */
function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/** True when `value` is a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Extract a hostname from a URL string without throwing.
 * @returns {string} hostname or '' when the URL is unusable
 */
function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * Validate a user supplied URL. Only absolute http(s) URLs are accepted.
 * @param {string} url
 * @param {{ allowHttp?: boolean }} [options]
 * @returns {boolean}
 */
function isSafeHttpUrl(url, { allowHttp = true } = {}) {
  if (!isNonEmptyString(url)) return false;
  if (url.length > LIMITS.MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    return allowHttp && parsed.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

/**
 * Truncate a string for display/persistence.
 */
function truncate(text, max = LIMITS.MAX_TITLE_LENGTH) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Deduplicate an array of strings while preserving order.
 */
function uniqueStrings(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Normalise a hostname for allow-list matching: lower-case, strip trailing dot
 * and any port/userinfo that sneaked in.
 */
function normalizeHostname(hostname) {
  if (typeof hostname !== 'string') return '';
  let host = hostname.trim().toLowerCase();
  if (!host) return '';
  // Strip a trailing FQDN dot and an optional port.
  if (host.endsWith('.')) host = host.slice(0, -1);
  const colon = host.lastIndexOf(':');
  if (colon > -1 && /^\d+$/.test(host.slice(colon + 1))) host = host.slice(0, colon);
  // IPv6 literals arrive bracketed.
  return host.replace(/^\[|\]$/g, '');
}

/** Sleep helper used by the remote data refresher. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  slugify,
  clampNumber,
  toBoolean,
  isNonEmptyString,
  isSafeHttpUrl,
  safeHostname,
  truncate,
  uniqueStrings,
  normalizeHostname,
  delay
};
