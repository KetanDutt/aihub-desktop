/**
 * Adapter catalogue (pure validation + loading).
 *
 * An adapter is *data*, not code, so a service redesign can be fixed by editing
 * a JSON file instead of shipping a new build. This module is the trust
 * boundary: every field is type-checked, length-capped and shape-checked, and an
 * unusable entry is dropped rather than partially applied.
 */

const fs = require('fs');
const path = require('path');

const { LIMITS } = require('../constants');
const { slugify, isSafeHttpUrl, uniqueStrings, truncate } = require('../utils');

const MAX_SELECTORS = 12;
const MAX_SELECTOR_LENGTH = 400;
const STRATEGIES = new Set(['api', 'dom', 'auto']);

/** Reject anything that could smuggle markup or a script into a selector. */
function safeSelector(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SELECTOR_LENGTH) return null;
  if (/[<>{}]|javascript\s*:|expression\(|@import/i.test(trimmed)) return null;
  return trimmed;
}

function safeHeaderName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(trimmed) ? trimmed : null;
}

function normalizeStringMap(raw, maxEntries = 12) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, maxEntries)) {
    const header = safeHeaderName(key);
    if (!header) continue;
    if (typeof value !== 'string' || value.length > 512) continue;
    // Placeholders are resolved at request time; control characters are not.
    // eslint-disable-next-line no-control-regex
    if (/[\r\n\0]/.test(value)) continue;
    out[header] = value;
  }
  return out;
}

function normalizeDom(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const composer = safeSelector(raw.composer);
  const answer = safeSelector(raw.answer);
  if (!composer || !answer) return null;

  return {
    // https only: this origin is where we send the service's cookies.
    url: typeof raw.url === 'string' && isSafeHttpUrl(raw.url, { allowHttp: false }) ? raw.url.trim() : '',
    composer,
    submit: raw.submit === 'button' || raw.submit === 'enter' ? raw.submit : 'enter',
    submitSelector: safeSelector(raw.submitSelector),
    answer,
    // A "which answer is newest" hint: take the last matching node.
    answerAll: raw.answerAll === true,
    pending: safeSelector(raw.pending),
    stop: safeSelector(raw.stop),
    idlePolls: Number.isFinite(raw.idlePolls) ? Math.min(40, Math.max(1, Math.round(raw.idlePolls))) : 3,
    pollMs: Number.isFinite(raw.pollMs) ? Math.min(5000, Math.max(100, Math.round(raw.pollMs))) : 700,
    navigateTimeoutMs: Number.isFinite(raw.navigateTimeoutMs)
      ? Math.min(120000, Math.max(2000, Math.round(raw.navigateTimeoutMs)))
      : 45000
  };
}

/**
 * Validate the `{header, from, key}` entries an adapter needs to imitate the
 * page. `from` is a closed set of *sources* — localStorage, cookies, a URL
 * pattern — because the alternative (a JS expression from a JSON file) turns the
 * adapter catalogue into remote code execution inside a logged-in session.
 */
function normalizeAuthSources(raw, allowUrlPattern = false) {
  if (!Array.isArray(raw)) return [];
  const out = [];

  for (const entry of raw.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const from = entry.from === 'localStorage' ? 'localStorage' : entry.from === 'cookie' ? 'cookie' : allowUrlPattern && entry.from === 'urlPattern' ? 'urlPattern' : null;
    if (!from) continue;

    const key = typeof entry.key === 'string' ? entry.key.trim().slice(0, 120) : '';
    if (from !== 'urlPattern' && !key) continue;

    let pattern = null;
    if (from === 'urlPattern') {
      const candidate = typeof entry.pattern === 'string' ? entry.pattern.trim().slice(0, 120) : '';
      // A plain source string for `new RegExp`: quotes, markup and anything that
      // could reach a constructor are refused. The length is capped, and the
      // engine compiles it inside a try/catch against a URL we already hold.
      if (!candidate || /[\r\n\t<>'"`]|new\s+Function|require\s*\(/.test(candidate)) continue;
      pattern = candidate;
    }

    const name =
      from === 'urlPattern'
        ? typeof entry.name === 'string'
          ? entry.name.trim().slice(0, 60)
          : ''
        : safeHeaderName(entry.header);
    if (!name) continue;

    out.push({
      name,
      from,
      key,
      pattern,
      jsonPath: typeof entry.jsonPath === 'string' ? entry.jsonPath.trim().slice(0, 60) : ''
    });
  }

  return out;
}

function normalizeApi(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // https only: an API endpoint is handed the service's session cookies.
  const url = typeof raw.url === 'string' && isSafeHttpUrl(raw.url, { allowHttp: false }) ? raw.url.trim() : '';
  if (!url) return null;

  const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : 'POST';
  if (!['POST', 'GET', 'PUT'].includes(method)) return null;

  const body = raw.body && typeof raw.body === 'object' ? raw.body : typeof raw.body === 'string' ? raw.body : null;

  return {
    url,
    method,
    sse: raw.sse !== false,
    headers: normalizeStringMap(raw.headers),
    body,
    bodyText: typeof raw.body === 'string' ? truncate(raw.body, 8192) : null,
    deltaPath: typeof raw.deltaPath === 'string' ? raw.deltaPath.slice(0, 120) : '',
    resultPath: typeof raw.resultPath === 'string' ? raw.resultPath.slice(0, 120) : '',
    errorPath: typeof raw.errorPath === 'string' ? raw.errorPath.slice(0, 120) : '',
    conversationIdPath:
      typeof raw.conversationIdPath === 'string' ? raw.conversationIdPath.slice(0, 120) : '',
    systemField: typeof raw.systemField === 'string' && raw.systemField ? raw.systemField.slice(0, 120) : null,
    // Extra headers whose values live in the page's own origin (localStorage,
    // cookies). Declarative on purpose: a data file must never carry code.
    authHeaders: normalizeAuthSources(raw.authHeaders),
    // Identifiers embedded in the endpoint path, e.g. `/organizations/{id}/…`.
    urlParams: normalizeAuthSources(raw.urlParams, true)
  };
}

/** @returns {object|null} a canonical adapter, or null when unusable */
function normalizeAdapter(raw, serviceId = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const requested = STRATEGIES.has(raw.strategy) ? raw.strategy : 'auto';
  const api = normalizeApi(raw.api);
  const dom = normalizeDom(raw.dom);
  if (!api && !dom) return null;
  // Ask for the impossible and you get the honest answer: an `api` adapter with
  // no usable endpoint becomes a `dom` adapter, not a broken one.
  const strategy = api ? requested : 'dom';
  if (!dom && strategy === 'dom') return null;

  const models = uniqueStrings(Array.isArray(raw.models) ? raw.models : []).slice(0, 40);
  const aliases = uniqueStrings(Array.isArray(raw.aliases) ? raw.aliases : []).slice(0, 20);

  return {
    serviceId,
    strategy,
    label: typeof raw.label === 'string' ? truncate(raw.label, 60) : '',
    defaultModel: typeof raw.defaultModel === 'string' ? truncate(raw.defaultModel, 120) : models[0] || 'default',
    models: models.length > 0 ? models : [raw.defaultModel || 'default'].filter(Boolean),
    aliases,
    api,
    dom
  };
}

/**
 * @param {unknown} payload parsed JSON
 * @returns {Map<string, object>|null} adapters by service id
 */
function normalizeAdaptersPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const defaults = normalizeAdapter({ ...(payload.default && typeof payload.default === 'object' ? payload.default : {}), strategy: 'dom' }, '');
  const rawAdapters = payload.adapters && typeof payload.adapters === 'object' ? payload.adapters : null;
  if (!rawAdapters) return null;

  const adapters = new Map();
  for (const [rawId, raw] of Object.entries(rawAdapters)) {
    const id = slugify(String(rawId));
    if (!id) continue;
    // The default entry fills whatever the service does not override. Merged
    // before normalisation so a partial service block is validated as a whole.
    const base = payload.default && typeof payload.default === 'object' ? payload.default : {};
    const merged = { ...base, strategy: raw && raw.strategy ? raw.strategy : base.strategy, ...(raw || {}) };
    // `dom` and `api` are merged field by field: an override that only sets
    // `answer` must keep the default `composer`, otherwise a partial entry
    // quietly loses the driver and the service becomes unusable.
    for (const block of ['dom', 'api']) {
      const inherited = base[block] && typeof base[block] === 'object' ? base[block] : null;
      const own = raw && raw[block] && typeof raw[block] === 'object' ? raw[block] : null;
      if (own) merged[block] = { ...(inherited || {}), ...own };
      else if (inherited) merged[block] = { ...inherited };
    }
    void defaults;
    const adapter = normalizeAdapter(merged, id);
    if (adapter) adapters.set(id, adapter);
  }

  return adapters.size > 0 ? adapters : null;
}

/** Bundled file first, user copy overrides (same rule as services/rules data). */
function resolveAdapterFile(userDataDir, bundledDataDir) {
  const candidates = [
    path.join(userDataDir, 'adapters.json'),
    path.join(userDataDir, 'data', 'adapters.json'),
    path.join(bundledDataDir, 'adapters.json')
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size < LIMITS.FETCH_MAX_BYTES) return candidate;
    } catch (e) {
      /* keep looking */
    }
  }
  return null;
}

function loadAdapters({ userDataDir, bundledDataDir, log = console } = {}) {
  const file = resolveAdapterFile(userDataDir, bundledDataDir);
  if (!file) return { adapters: new Map(), defaultAdapter: null, source: 'unavailable' };

  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const adapters = normalizeAdaptersPayload(payload);
    if (!adapters) return { adapters: new Map(), defaultAdapter: null, source: 'invalid' };
    const defaultAdapter = normalizeAdapter({ ...(payload && payload.default ? payload.default : {}) }, '');
    return {
      adapters,
      defaultAdapter,
      source: bundledDataDir && file.startsWith(bundledDataDir) ? 'bundled' : 'user'
    };
  } catch (error) {
    if (typeof log.warn === 'function') log.warn(`Unable to read adapters: ${error.message}`);
    return { adapters: new Map(), defaultAdapter: null, source: 'error' };
  }
}

/** Which service ids a payload covers (used by the consistency test). */
function adapterIds(adapters) {
  return [...adapters.keys()];
}

module.exports = {
  MAX_SELECTORS,
  STRATEGIES,
  safeSelector,
  safeHeaderName,
  normalizeDom,
  normalizeApi,
  normalizeAuthSources,
  normalizeAdapter,
  normalizeAdaptersPayload,
  resolveAdapterFile,
  loadAdapters,
  adapterIds
};
