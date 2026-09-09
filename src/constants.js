/**
 * Shared constants for the AI Hub Desktop main process.
 *
 * Layout numbers are only used as a *fallback* when the renderer has not yet
 * reported the real bounds of the tab viewport (see `src/window.js`).
 */

const APP_NAME = 'AI Hub Desktop';
const APP_ID = 'com.silentcoderhere.aihubdesktop';
const PROTOCOL = 'aihub';
const GLOBAL_SHORTCUT_DEFAULT = 'CommandOrControl+Shift+A';

// -- Layout fallbacks (px, CSS pixels) ---------------------------------------
const HEADER_HEIGHT = 80;
const TABS_HEIGHT = 40;
const STATUS_BAR_HEIGHT = 28;

const LAYOUT = {
  HEADER_HEIGHT,
  TABS_HEIGHT,
  STATUS_BAR_HEIGHT,
  MIN_WIDTH: 800,
  MIN_HEIGHT: 600,
  DEFAULT_WIDTH: 1200,
  DEFAULT_HEIGHT: 800
};

// -- Limits ------------------------------------------------------------------
const LIMITS = {
  MIN_TABS: 1,
  MAX_TABS: 20,
  DEFAULT_MAX_TABS: 3,
  // Remote data
  FETCH_TIMEOUT_MS: 15000,
  FETCH_MAX_BYTES: 2 * 1024 * 1024, // 2 MB
  FETCH_MAX_REDIRECTS: 5,
  // Favicon
  FAVICON_TIMEOUT_MS: 6000,
  FAVICON_MAX_BYTES: 128 * 1024, // 128 kB
  FAVICON_CACHE_ENTRIES: 200,
  // Titles
  MAX_TITLE_LENGTH: 120,
  MAX_URL_LENGTH: 4096
};

// -- Tab hibernation ---------------------------------------------------------
const HIBERNATION = {
  DEFAULT_IDLE_MS: 15 * 60 * 1000, // 15 minutes
  MIN_IDLE_MS: 60 * 1000, // 1 minute
  MAX_IDLE_MS: 24 * 60 * 60 * 1000, // 24 hours
  SWEEP_INTERVAL_MS: 60 * 1000 // how often the idle sweep runs
};

// -- Storage -----------------------------------------------------------------
const STORAGE = {
  CONFIG_PROJECT: 'aihub-desktop',
  CONFIG_FALLBACK_FILE: 'config.json',
  DATA_DIRNAME: 'data',
  SERVICES_FILENAME: 'remote_services.json',
  RULES_FILENAME: 'remote_rules.json',
  BUNDLED_DIRNAME: 'bundled-data',
  LOCAL_SERVICES_FILENAME: 'services.json',
  LOCAL_RULES_FILENAME: 'rules.json',
  FAVICON_DIRNAME: 'favicons'
};

// Remote service/rules data is refreshed in the background when older than this.
const STALE_DATA_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// -- IPC channel names -------------------------------------------------------
// Centralised so renderer, preload and main can never drift apart.
const IPC = {
  GET_CONFIG: 'get-config',
  SAVE_CONFIG: 'save-config',
  GET_SERVICES: 'get-services',
  GET_RULES: 'get-rules',
  UPDATE_REMOTE_DATA: 'update-remote-data',
  TOGGLE_SERVICE: 'toggle-service',
  GET_FAVICON: 'get-favicon',
  GET_APP_INFO: 'get-app-info',
  OPEN_EXTERNAL: 'open-external',
  CLEAR_SESSION_DATA: 'clear-session-data',
  SET_ACTIVE_SERVICE: 'set-active-service',
  CREATE_TAB: 'create-tab',
  CLOSE_TAB: 'close-tab',
  SWITCH_TAB: 'switch-tab',
  CLOSE_OTHER_TABS: 'close-other-tabs',
  REORDER_TABS: 'reorder-tabs',
  GET_TAB_STATES: 'get-tab-states',
  HIBERNATE_TABS: 'hibernate-tabs',
  GET_LIMITS: 'get-limits',
  SET_VIEW_BOUNDS: 'set-view-bounds',
  NAV_GO_BACK: 'nav-go-back',
  NAV_GO_FORWARD: 'nav-go-forward',
  NAV_RELOAD: 'nav-reload',
  SET_ZOOM: 'set-zoom',
  OPEN_TAB_DEVTOOLS: 'open-tab-devtools',
  CHECK_FOR_UPDATES: 'check-for-updates',
  GET_UPDATE_STATUS: 'get-update-status',
  QUIT_AND_INSTALL: 'quit-and-install',
  GET_BLOCKING_STATS: 'get-blocking-stats',
  MINIMIZE_WINDOW: 'minimize-window',
  MAXIMIZE_WINDOW: 'maximize-window',
  CLOSE_WINDOW: 'close-window',
  QUIT_APP: 'quit-app',
  // main -> renderer
  DEEP_LINK_OPEN: 'deep-link-open',
  TAB_LOADING: 'tab-loading',
  TAB_STATE: 'tab-state',
  TAB_CREATED: 'tab-created',
  TAB_CLOSED: 'tab-closed',
  TABS_EMPTIED: 'tabs-emptied',
  TAB_BLOCKED: 'tab-blocked',
  BLOCKING_STATE: 'blocking-state',
  UPDATE_STATE: 'update-state',
  APP_LOG: 'app-log'
};

module.exports = {
  APP_NAME,
  APP_ID,
  PROTOCOL,
  GLOBAL_SHORTCUT_DEFAULT,
  HEADER_HEIGHT,
  TABS_HEIGHT,
  STATUS_BAR_HEIGHT,
  LAYOUT,
  LIMITS,
  HIBERNATION,
  STORAGE,
  STALE_DATA_MS,
  IPC
};
