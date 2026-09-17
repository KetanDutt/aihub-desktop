/**
 * Menu catalogue: the pre-audited, offline copy of everything the UI needs to
 * describe a service before its tab has ever loaded.
 *
 * `data/catalog.json` + `assets/icons/` are produced by
 * `scripts/audit-services.js` (`npm run services:audit`). This module only
 * reads them, so it stays free of Electron and of any network access and can be
 * unit-tested directly.
 *
 * Icons are returned as data URLs because the shell renderer's CSP allows
 * `img-src 'self' data:` only — it can never load a remote image itself.
 */

const fs = require('fs');
const path = require('path');

const MIME_BY_EXT = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

/** Hard cap so a tampered icon file can never blow up the renderer payload. */
const MAX_ICON_BYTES = 256 * 1024;

let cache = null;
const iconCache = new Map(); // serviceId -> dataUrl|null

function repoRoot() {
  return path.join(__dirname, '..');
}

function catalogFile() {
  if (process.env.AIHUB_CATALOG_FILE) return process.env.AIHUB_CATALOG_FILE;
  try {
    // Packaged builds ship data/ as `bundled-data` in extraResources.
    // eslint-disable-next-line global-require
    return path.join(require('./paths').bundledDataDir(), 'catalog.json');
  } catch (e) {
    return path.join(repoRoot(), 'data', 'catalog.json');
  }
}

function iconRoot() {
  if (process.env.AIHUB_ICON_DIR) return process.env.AIHUB_ICON_DIR;
  return repoRoot();
}

/**
 * Load and validate the catalogue. A missing or broken file is not fatal: the
 * app simply falls back to live favicon fetching and the plain services list.
 *
 * @returns {{services: object[], byId: Map<string, object>}|null}
 */
function load({ force = false } = {}) {
  if (cache && !force) return cache;

  try {
    const file = catalogFile();
    if (!fs.existsSync(file)) return null;
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(payload.services) ? payload.services : null;
    if (!list) return null;

    const services = list.filter((entry) => entry && typeof entry.id === 'string' && entry.id);
    cache = {
      generatedAt: payload.generatedAt || null,
      mode: payload.mode || 'offline',
      services,
      byId: new Map(services.map((entry) => [entry.id, entry]))
    };
    return cache;
  } catch (e) {
    return null;
  }
}

/** Catalogue record for a service id, or null. */
function entryFor(serviceId) {
  const catalog = load();
  if (!catalog || typeof serviceId !== 'string') return null;
  return catalog.byId.get(serviceId) || null;
}

/**
 * The cached icon for a service as a data URL.
 * Reads from disk once per service, then serves from memory.
 *
 * @returns {string|null}
 */
function iconDataUrl(serviceId) {
  if (iconCache.has(serviceId)) return iconCache.get(serviceId);

  const entry = entryFor(serviceId);
  let result = null;

  if (entry && typeof entry.icon === 'string' && entry.icon) {
    // The path comes from a generated file in the repo, but normalise anyway so
    // a hand-edited catalogue can never escape the icon directory.
    const relative = path.normalize(entry.icon).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(iconRoot(), relative);
    const ext = path.extname(file).toLowerCase();
    try {
      if (MIME_BY_EXT[ext] && fs.existsSync(file)) {
        const stat = fs.statSync(file);
        if (stat.size > 0 && stat.size <= MAX_ICON_BYTES) {
          const buffer = fs.readFileSync(file);
          result = `data:${MIME_BY_EXT[ext]};base64,${buffer.toString('base64')}`;
        }
      }
    } catch (e) {
      result = null;
    }
  }

  iconCache.set(serviceId, result);
  return result;
}

/**
 * Menu-facing details for a service: exact homepage, login URL, whether an
 * account is needed and the cached icon.
 *
 * @returns {object|null}
 */
function detailsFor(serviceId) {
  const entry = entryFor(serviceId);
  if (!entry) return null;
  return {
    id: entry.id,
    name: entry.name,
    homepage: entry.homepage,
    loginUrl: entry.loginUrl || null,
    requiresLogin: entry.requiresLogin !== false,
    type: entry.type || 'AI Service',
    privacy: entry.privacy || '',
    color: entry.color || null,
    authDomains: Array.isArray(entry.authDomains) ? entry.authDomains : [],
    hasLoginProfile: Boolean(entry.hasLoginProfile),
    hasApiAdapter: Boolean(entry.hasApiAdapter),
    iconSource: entry.iconSource || null,
    icon: iconDataUrl(entry.id),
    lastChecked: (entry.probe && entry.probe.checkedAt) || null,
    reachable: entry.probe ? Boolean(entry.probe.reachable) : null
  };
}

/**
 * Enrich a normalised services list with catalogue data.
 * Entries missing from the catalogue pass through untouched.
 */
function enrich(services) {
  if (!Array.isArray(services)) return [];
  return services.map((service) => {
    const details = detailsFor(service.id);
    if (!details) return { ...service, icon: null, homepage: service.url };
    return {
      ...service,
      // The catalogue never overrides a colour/name the live catalogue provides;
      // it only adds what the remote list cannot carry.
      homepage: details.homepage || service.url,
      loginUrl: details.loginUrl,
      authDomains: details.authDomains,
      hasLoginProfile: details.hasLoginProfile,
      hasApiAdapter: details.hasApiAdapter,
      icon: details.icon,
      iconSource: details.iconSource,
      lastChecked: details.lastChecked
    };
  });
}

/** Summary for the settings/about panel. */
function status() {
  const catalog = load();
  if (!catalog) return { available: false, serviceCount: 0, generatedAt: null, mode: null };
  return {
    available: true,
    serviceCount: catalog.services.length,
    generatedAt: catalog.generatedAt,
    mode: catalog.mode,
    withIcons: catalog.services.filter((entry) => entry.icon).length,
    requiringLogin: catalog.services.filter((entry) => entry.requiresLogin !== false).length
  };
}

/** Test helper. */
function _resetForTests() {
  cache = null;
  iconCache.clear();
}

module.exports = {
  load,
  entryFor,
  detailsFor,
  iconDataUrl,
  enrich,
  status,
  _resetForTests
};
