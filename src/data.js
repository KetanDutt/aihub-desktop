/**
 * Service catalogue + domain rules loader.
 *
 * Resolution order for both datasets:
 *   1. the copy downloaded into the user data directory (fresh, remote);
 *   2. the copy bundled with the app (always present, works offline);
 *
 * Remote payloads are size-capped, time-limited, JSON-validated *before* they
 * touch disk and written atomically, so a truncated or hostile response can
 * never corrupt the cached data.
 */

const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const https = require('https');
const http = require('http');

const log = require('electron-log');
const configStore = require('./config');
const paths = require('./paths');
const { LIMITS, STORAGE, STALE_DATA_MS } = require('./constants');
const { slugify, isSafeHttpUrl, uniqueStrings, normalizeHostname } = require('./utils');

let servicesCache = null;
let servicesSource = null;
let rulesCache = null;
let rulesSource = null;
let inflightUpdate = null;

function userServicesPath() {
  return path.join(paths.userDataDir(), STORAGE.SERVICES_FILENAME);
}

function userRulesPath() {
  return path.join(paths.userDataDir(), STORAGE.RULES_FILENAME);
}

function bundledServicesPath() {
  return path.join(paths.bundledDataDir(), STORAGE.LOCAL_SERVICES_FILENAME);
}

function bundledRulesPath() {
  return path.join(paths.bundledDataDir(), STORAGE.LOCAL_RULES_FILENAME);
}

// ---------------------------------------------------------------------------
// Validation / normalisation
// ---------------------------------------------------------------------------

/**
 * Accept either the legacy `[name, url, type, privacy, color]` tuple or a
 * `{name, url, …}` object and return a single canonical shape.
 * @returns {object|null}
 */
function normalizeService(raw) {
  let name;
  let url;
  let type;
  let privacy;
  let color;

  if (Array.isArray(raw)) {
    [name, url, type, privacy, color] = raw;
  } else if (raw && typeof raw === 'object') {
    ({ name, url, type, privacy, color } = raw);
  } else {
    return null;
  }

  if (typeof name !== 'string' || typeof url !== 'string') return null;

  const cleanName = name.trim();
  const cleanUrl = url.trim();
  if (!cleanName || !isSafeHttpUrl(cleanUrl)) return null;

  const id = slugify(cleanName);
  if (!id) return null;

  const cleanColor =
    typeof color === 'string' && /^[0-9a-f]{6}$/i.test(color.trim()) ? color.trim().toLowerCase() : null;

  return {
    id,
    name: cleanName,
    url: cleanUrl,
    type: typeof type === 'string' && type.trim() ? type.trim() : 'AI Service',
    privacy: typeof privacy === 'string' ? privacy.trim() : '',
    color: cleanColor
  };
}

/** Validate + normalise a services payload. Returns null when unusable. */
function normalizeServicesPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const list = Array.isArray(payload) ? payload : payload.ai_services;
  if (!Array.isArray(list) || list.length === 0) return null;

  const services = [];
  const seen = new Set();
  for (const raw of list) {
    const service = normalizeService(raw);
    if (!service || seen.has(service.id)) continue;
    seen.add(service.id);
    services.push(service);
  }
  if (services.length === 0) return null;

  return {
    schemaVersion: 1,
    ai_services: services,
    serviceCount: services.length
  };
}

/** Validate a rules payload. Returns null when unusable. */
function normalizeRulesPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const rawServiceDomains = payload.service_domains;
  if (!rawServiceDomains || typeof rawServiceDomains !== 'object' || Array.isArray(rawServiceDomains)) {
    return null;
  }

  const serviceDomains = {};
  for (const [serviceId, domains] of Object.entries(rawServiceDomains)) {
    const id = slugify(serviceId);
    if (!id || !Array.isArray(domains)) continue;
    const cleaned = uniqueStrings(domains.map(normalizeHostname)).slice(0, 200);
    if (cleaned.length > 0) serviceDomains[id] = cleaned;
  }
  if (Object.keys(serviceDomains).length === 0) return null;

  return {
    schemaVersion: 1,
    service_domains: serviceDomains,
    common_auth_domains: uniqueStrings(
      Array.isArray(payload.common_auth_domains) ? payload.common_auth_domains.map(normalizeHostname) : []
    ).slice(0, 200),
    always_allowed_domains: uniqueStrings(
      Array.isArray(payload.always_allowed_domains) ? payload.always_allowed_domains.map(normalizeHostname) : []
    ).slice(0, 100)
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function readJsonFile(filePath, maxBytes = LIMITS.FETCH_MAX_BYTES) {
  const stat = await fsPromises.stat(filePath);
  if (stat.size === 0 || stat.size > maxBytes) return null;
  const raw = await fsPromises.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/** @returns {Promise<object|null>} normalised services (cached) */
async function loadServices({ force = false } = {}) {
  if (servicesCache && !force) return servicesCache;

  const candidates = [
    { file: userServicesPath(), source: 'remote' },
    { file: bundledServicesPath(), source: 'bundled' }
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate.file)) continue;
      const payload = await readJsonFile(candidate.file);
      const normalized = normalizeServicesPayload(payload);
      if (normalized) {
        servicesCache = normalized;
        servicesSource = candidate.source;
        log.info(`Loaded ${normalized.ai_services.length} services from ${candidate.source} data`);
        return servicesCache;
      }
      log.warn(`Ignoring invalid services file: ${candidate.file}`);
    } catch (error) {
      log.warn(`Unable to read services file ${candidate.file}:`, error.message);
    }
  }

  servicesCache = null;
  servicesSource = null;
  return null;
}

/** @returns {Promise<object|null>} normalised rules (cached) */
async function loadRules({ force = false } = {}) {
  if (rulesCache && !force) return rulesCache;

  const candidates = [
    { file: userRulesPath(), source: 'remote' },
    { file: bundledRulesPath(), source: 'bundled' }
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate.file)) continue;
      const payload = await readJsonFile(candidate.file);
      const normalized = normalizeRulesPayload(payload);
      if (normalized) {
        rulesCache = normalized;
        rulesSource = candidate.source;
        log.info(
          `Loaded domain rules from ${candidate.source} data ` +
            `(${Object.keys(normalized.service_domains).length} services)`
        );
        return rulesCache;
      }
      log.warn(`Ignoring invalid rules file: ${candidate.file}`);
    } catch (error) {
      log.warn(`Unable to read rules file ${candidate.file}:`, error.message);
    }
  }

  rulesCache = null;
  rulesSource = null;
  return null;
}

function getRulesCache() {
  return rulesCache;
}

function getServicesCache() {
  return servicesCache;
}

/** Describe where the active datasets came from (shown in Settings > About). */
function getDataStatus() {
  const config = configStore.getConfig();
  return {
    servicesSource,
    rulesSource,
    serviceCount: servicesCache ? servicesCache.ai_services.length : 0,
    ruleCount: rulesCache ? Object.keys(rulesCache.service_domains).length : 0,
    lastUpdate: config.lastUpdate || null,
    isStale: isStale(config.lastUpdate)
  };
}

function isStale(lastUpdateIso) {
  if (!lastUpdateIso) return true;
  const time = Date.parse(lastUpdateIso);
  if (Number.isNaN(time)) return true;
  return Date.now() - time > STALE_DATA_MS;
}

// ---------------------------------------------------------------------------
// Remote fetching
// ---------------------------------------------------------------------------

/**
 * GET a URL with a timeout, a redirect cap and a size cap.
 * Resolves with the body as a string.
 */
function fetchUrl(url, redirectsLeft = LIMITS.FETCH_MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (e) {
      reject(new Error('Invalid URL'));
      return;
    }

    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      reject(new Error(`Unsupported protocol: ${target.protocol}`));
      return;
    }
    if (target.protocol === 'http:' && !/^localhost$|^127\.0\.0\.1$/.test(target.hostname)) {
      reject(new Error('Refusing to download service data over plain HTTP'));
      return;
    }

    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.get(
      target,
      {
        timeout: LIMITS.FETCH_TIMEOUT_MS,
        headers: { 'user-agent': 'aihub-desktop', accept: 'application/json' }
      },
      (response) => {
        const status = response.statusCode || 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume(); // drain
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const next = new URL(response.headers.location, target).toString();
          fetchUrl(next, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > LIMITS.FETCH_MAX_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );

    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
  });
}

/** Parse + validate a downloaded payload. Throws when unusable. */
async function fetchValidated(url, normalizer, label) {
  const body = await fetchUrl(url);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(`${label} is not valid JSON`);
  }
  const normalized = normalizer(parsed);
  if (!normalized) throw new Error(`${label} failed validation`);
  return normalized;
}

/** Atomic write: temp file + rename, so readers never see a partial file. */
async function writeJsonAtomic(filePath, data) {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fsPromises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsPromises.rename(tmp, filePath);
}

/**
 * Download the remote catalogue + rules. Concurrent calls share one promise.
 * @returns {Promise<{success: boolean, error?: string, services?: number, rules?: number}>}
 */
async function updateRemoteData() {
  if (inflightUpdate) return inflightUpdate;

  inflightUpdate = (async () => {
    const config = configStore.getConfig();
    const urls = config.remoteUrls || configStore.DEFAULTS.remoteUrls;
    const started = Date.now();

    try {
      log.info('Refreshing service catalogue…');
      const [services, rules] = await Promise.all([
        fetchValidated(urls.services, normalizeServicesPayload, 'Service list'),
        fetchValidated(urls.rules, normalizeRulesPayload, 'Rule set')
      ]);

      await writeJsonAtomic(userServicesPath(), services);
      await writeJsonAtomic(userRulesPath(), rules);

      servicesCache = services;
      servicesSource = 'remote';
      rulesCache = rules;
      rulesSource = 'remote';

      configStore.updateConfigItem('lastUpdate', new Date().toISOString());
      log.info(
        `Service data refreshed in ${Date.now() - started}ms ` +
          `(${services.ai_services.length} services, ${Object.keys(rules.service_domains).length} rule sets)`
      );

      return {
        success: true,
        services: services.ai_services.length,
        rules: Object.keys(rules.service_domains).length
      };
    } catch (error) {
      log.error('Unable to refresh service data:', error.message);
      // Keep serving whatever we already have (bundled or previously cached).
      await loadServices();
      await loadRules();
      return { success: false, error: error.message };
    } finally {
      inflightUpdate = null;
    }
  })();

  return inflightUpdate;
}

/**
 * Load bundled/user data, then refresh in the background when the cached copy
 * is older than {@link STALE_DATA_MS}. Never rejects.
 */
async function initialize() {
  await loadServices();
  await loadRules();

  const config = configStore.getConfig();
  if (config.autoUpdateServices === false) return;
  if (!isStale(config.lastUpdate)) return;

  // Fire and forget: the app must stay usable offline.
  updateRemoteData().catch((error) => log.warn('Background refresh failed:', error.message));
}

/** Test helper. */
function _resetForTests() {
  servicesCache = null;
  servicesSource = null;
  rulesCache = null;
  rulesSource = null;
  inflightUpdate = null;
}

module.exports = {
  initialize,
  updateRemoteData,
  loadServices,
  loadRules,
  getRulesCache,
  getServicesCache,
  getDataStatus,
  isStale,
  normalizeService,
  normalizeServicesPayload,
  normalizeRulesPayload,
  fetchUrl,
  _resetForTests
};
