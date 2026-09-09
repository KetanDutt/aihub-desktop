/**
 * Persistent configuration.
 *
 * Backed by `electron-store` (schema validated, atomic writes) with a small
 * JSON-file fallback so a broken/missing dependency can never stop the app from
 * booting.
 *
 * Everything written through IPC is funnelled through `sanitizeConfig()`:
 * unknown keys are dropped and values are coerced/clamped, which keeps internal
 * state (`openTabs`, `remoteUrls`, …) untouchable from the renderer.
 */

const fs = require('fs');
const path = require('path');
const log = require('electron-log');

const { LIMITS, STORAGE, GLOBAL_SHORTCUT_DEFAULT, HIBERNATION } = require('./constants');
const { clampNumber, toBoolean, isSafeHttpUrl, uniqueStrings, isNonEmptyString } = require('./utils');

const DEFAULT_PROXY_URL = 'https://eu.proxysite.com/includes/process.php?action=update';

const DEFAULTS = {
  lastUpdate: null,
  blockingEnabled: true,
  strictBlocking: false,
  maxActiveServices: LIMITS.DEFAULT_MAX_TABS,
  hibernateTabs: true,
  hibernateAfterMinutes: 15,
  useProxy: false,
  proxyUrl: DEFAULT_PROXY_URL,
  darkMode: true,
  minimizeToTray: true,
  launchAtLogin: false,
  globalShortcut: GLOBAL_SHORTCUT_DEFAULT,
  autoUpdateServices: true,
  enabledServices: ['chatgpt', 'claude', 'gemini'],
  lastActiveService: null,
  remoteUrls: {
    services: 'https://raw.githubusercontent.com/SilentCoderHere/aihub-config-data/main/ai_services_list.json',
    rules: 'https://raw.githubusercontent.com/SilentCoderHere/aihub-config-data/main/domain_filtering_rules.json'
  },
  openTabs: [],
  activeTabId: null
};

const schema = {
  lastUpdate: { type: ['string', 'null'], default: null },
  blockingEnabled: { type: 'boolean', default: DEFAULTS.blockingEnabled },
  strictBlocking: { type: 'boolean', default: DEFAULTS.strictBlocking },
  maxActiveServices: {
    type: 'number',
    minimum: LIMITS.MIN_TABS,
    maximum: LIMITS.MAX_TABS,
    default: DEFAULTS.maxActiveServices
  },
  hibernateTabs: { type: 'boolean', default: DEFAULTS.hibernateTabs },
  hibernateAfterMinutes: { type: 'number', default: DEFAULTS.hibernateAfterMinutes },
  useProxy: { type: 'boolean', default: DEFAULTS.useProxy },
  proxyUrl: { type: 'string', default: DEFAULTS.proxyUrl },
  darkMode: { type: 'boolean', default: DEFAULTS.darkMode },
  minimizeToTray: { type: 'boolean', default: DEFAULTS.minimizeToTray },
  launchAtLogin: { type: 'boolean', default: DEFAULTS.launchAtLogin },
  globalShortcut: { type: 'string', default: DEFAULTS.globalShortcut },
  autoUpdateServices: { type: 'boolean', default: DEFAULTS.autoUpdateServices },
  enabledServices: {
    type: 'array',
    items: { type: 'string' },
    default: DEFAULTS.enabledServices
  },
  lastActiveService: { type: ['string', 'null'], default: null },
  remoteUrls: {
    type: 'object',
    properties: {
      services: { type: 'string' },
      rules: { type: 'string' }
    },
    default: DEFAULTS.remoteUrls
  },
  openTabs: { type: 'array', default: [] },
  activeTabId: { type: ['string', 'null'], default: null }
};

// Keys the renderer is allowed to write. Internal state is deliberately absent.
const WRITABLE_KEYS = new Set([
  'blockingEnabled',
  'strictBlocking',
  'maxActiveServices',
  'hibernateTabs',
  'hibernateAfterMinutes',
  'useProxy',
  'proxyUrl',
  'darkMode',
  'minimizeToTray',
  'launchAtLogin',
  'globalShortcut',
  'autoUpdateServices',
  'enabledServices'
]);

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

/** Minimal `electron-store` compatible fallback (used if the dep cannot load). */
function createFallbackStore(filePath) {
  let data = { ...DEFAULTS };
  try {
    if (fs.existsSync(filePath)) {
      data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    }
  } catch (e) {
    log.warn('Falling back to defaults, config file unreadable:', e.message);
  }

  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (e) {
      log.error('Unable to persist configuration:', e.message);
    }
  };

  return {
    get store() {
      return { ...data };
    },
    get(key, defaultValue) {
      if (key in data) return data[key];
      return defaultValue !== undefined ? defaultValue : DEFAULTS[key];
    },
    set(keyOrObject, value) {
      if (typeof keyOrObject === 'object' && keyOrObject !== null) {
        Object.assign(data, keyOrObject);
      } else {
        data[keyOrObject] = value;
      }
      persist();
    },
    delete(key) {
      delete data[key];
      persist();
    }
  };
}

function createStore() {
  try {
    // eslint-disable-next-line global-require
    const StoreModule = require('electron-store');
    const Store = StoreModule.default || StoreModule;
    return new Store({ schema, projectName: STORAGE.CONFIG_PROJECT, defaults: DEFAULTS });
  } catch (e) {
    log.error('electron-store unavailable, using JSON fallback store:', e.message);
    let base;
    try {
      // eslint-disable-next-line global-require
      base = require('electron').app.getPath('userData');
    } catch (err) {
      base = path.join(__dirname, '..', '.aihub');
    }
    return createFallbackStore(path.join(base, STORAGE.CONFIG_FALLBACK_FILE));
  }
}

const store = createStore();

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** @returns {object} the full configuration (safe to hand to the renderer) */
function getConfig() {
  return store.store;
}

/** @returns {object} configuration with internal state stripped out */
function getPublicConfig() {
  const config = store.store;
  return {
    ...config,
    openTabs: Array.isArray(config.openTabs) ? config.openTabs : [],
    activeTabId: config.activeTabId || null
  };
}

/** Validate a user supplied proxy URL. Empty means "use the default". */
function validateProxyUrl(urlStr) {
  if (!urlStr) return true;
  return isSafeHttpUrl(urlStr);
}

/** Basic accelerator sanity check (Electron validates the real thing). */
function validateAccelerator(accelerator) {
  if (!isNonEmptyString(accelerator)) return false;
  if (accelerator.length > 64) return false;
  // Must contain a modifier or be a function key; reject anything weird.
  return /^(?:[A-Za-z0-9+]|Command|Control|Ctrl|Alt|Option|Shift|Super|CmdOrCtrl|CommandOrControl)+$/.test(
    accelerator.trim()
  );
}

/**
 * Whitelist + coerce an incoming (untrusted) config patch.
 *
 * @param {object} newConfig
 * @returns {object} a safe, partial config
 * @throws when the proxy URL is invalid
 */
function sanitizeConfig(newConfig) {
  if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
    throw new Error('Invalid configuration payload');
  }

  const useProxy = toBoolean(newConfig.useProxy, DEFAULTS.useProxy);
  let proxyUrl = isNonEmptyString(newConfig.proxyUrl)
    ? newConfig.proxyUrl.trim()
    : DEFAULTS.proxyUrl;

  if (!validateProxyUrl(proxyUrl)) {
    // Enabling the proxy with a bogus gateway is a hard error; otherwise we
    // silently fall back to the default so junk never reaches the store.
    if (useProxy) throw new Error('Invalid proxy URL or protocol');
    proxyUrl = DEFAULTS.proxyUrl;
  }

  if (newConfig.globalShortcut !== undefined && !validateAccelerator(newConfig.globalShortcut)) {
    throw new Error('Invalid keyboard shortcut');
  }

  const clean = {};
  for (const key of Object.keys(newConfig)) {
    if (!WRITABLE_KEYS.has(key)) continue;

    switch (key) {
      case 'blockingEnabled':
      case 'strictBlocking':
      case 'useProxy':
      case 'darkMode':
      case 'minimizeToTray':
      case 'launchAtLogin':
      case 'hibernateTabs':
      case 'autoUpdateServices':
        clean[key] = toBoolean(newConfig[key], DEFAULTS[key]);
        break;
      case 'maxActiveServices':
        clean[key] = clampNumber(
          newConfig[key],
          LIMITS.MIN_TABS,
          LIMITS.MAX_TABS,
          DEFAULTS.maxActiveServices
        );
        break;
      case 'hibernateAfterMinutes':
        clean[key] = clampNumber(
          newConfig[key],
          HIBERNATION.MIN_IDLE_MS / 60000,
          HIBERNATION.MAX_IDLE_MS / 60000,
          DEFAULTS.hibernateAfterMinutes
        );
        break;
      case 'enabledServices':
        clean[key] = uniqueStrings(newConfig[key]).slice(0, 200);
        break;
      case 'proxyUrl':
        clean[key] = proxyUrl;
        break;
      case 'globalShortcut':
        clean[key] = newConfig[key].trim();
        break;
      default:
        break;
    }
  }

  return clean;
}

/**
 * Merge a (untrusted) config patch into the store.
 * @param {object} newConfig
 * @returns {object} the full config after the write
 */
function saveConfig(newConfig) {
  const clean = sanitizeConfig(newConfig);
  store.set(clean);
  return store.store;
}

/**
 * Write a single key. Intended for internal state; unknown keys are ignored.
 */
function updateConfigItem(key, value) {
  if (!(key in DEFAULTS)) {
    log.warn(`Refusing to write unknown config key: ${key}`);
    return;
  }
  store.set(key, value);
}

function getConfigItem(key, fallback) {
  return store.get(key, fallback !== undefined ? fallback : DEFAULTS[key]);
}

/** Enable/disable a service in the sidebar list. */
function toggleService(serviceId) {
  if (!isNonEmptyString(serviceId)) {
    return store.get('enabledServices', DEFAULTS.enabledServices);
  }
  const id = serviceId.trim().toLowerCase();
  const enabledServices = [...(store.get('enabledServices', DEFAULTS.enabledServices) || [])];
  const index = enabledServices.indexOf(id);
  if (index === -1) {
    enabledServices.push(id);
  } else {
    enabledServices.splice(index, 1);
  }
  store.set('enabledServices', enabledServices);
  return enabledServices;
}

/** Reset everything back to factory defaults. */
function resetConfig() {
  store.set({ ...DEFAULTS });
  return store.store;
}

module.exports = {
  DEFAULTS,
  schema,
  WRITABLE_KEYS,
  getConfig,
  getPublicConfig,
  getConfigItem,
  saveConfig,
  sanitizeConfig,
  updateConfigItem,
  toggleService,
  resetConfig,
  validateProxyUrl,
  validateAccelerator
};
