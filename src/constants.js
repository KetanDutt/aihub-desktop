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
// Keep in sync with the CSS custom properties in ui/styles.css
// (--header-height, --tabs-height, --status-height). The renderer reports the
// real #webviews-container bounds; these only cover the first frames.
const HEADER_HEIGHT = 54;
const TABS_HEIGHT = 44;
const STATUS_BAR_HEIGHT = 30;

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

// -- Login / session persistence ---------------------------------------------
const SESSION = {
  /** Prefix of the persistent partition used when sessions are isolated. */
  PARTITION_PREFIX: 'persist:aihub-',
  /** How often the login/keep-alive sweep runs. */
  SWEEP_INTERVAL_MS: 60 * 1000,
  /** Session cookies are re-stamped with this lifetime so they survive a quit. */
  COOKIE_PIN_LIFETIME_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  /** Never shorten a cookie below this remaining lifetime when pinning. */
  COOKIE_PIN_MIN_REMAINING_MS: 24 * 60 * 60 * 1000, // 1 day
  /** Cookies older than this are treated as suspicious when restoring. */
  COOKIE_MAX_AGE_MS: 400 * 24 * 60 * 60 * 1000, // ~13 months
  /** A service is "needs relogin" when it was logged in and now is not. */
  RELOGIN_GRACE_MS: 5 * 60 * 1000,
  /** Snapshot cadence (cookie backup written to disk). */
  SNAPSHOT_INTERVAL_MS: 10 * 60 * 1000,
  /** Default keep-alive cadence for logged-in services. */
  DEFAULT_KEEPALIVE_MINUTES: 45,
  MIN_KEEPALIVE_MINUTES: 5,
  MAX_KEEPALIVE_MINUTES: 720,
  /** Max cookies handled per service (guard against hostile payloads). */
  MAX_COOKIES_PER_SERVICE: 500
};

// -- Local OpenAI-compatible API ---------------------------------------------
const API = {
  DEFAULT_PORT: 8788,
  MIN_PORT: 1024,
  MAX_PORT: 65535,
  /** Only these bind targets are allowed (loopback). */
  LOOPBACK_HOSTS: ['127.0.0.1', 'localhost', '::1'],
  MAX_BODY_BYTES: 1024 * 1024, // 1 MB
  MAX_MESSAGES: 200,
  MAX_MESSAGE_CHARS: 64 * 1024,
  DEFAULT_TIMEOUT_SECONDS: 180,
  MIN_TIMEOUT_SECONDS: 5,
  MAX_TIMEOUT_SECONDS: 900,
  DEFAULT_CONCURRENCY: 2,
  MAX_CONCURRENCY: 8,
  DEFAULT_RATE_LIMIT_PER_MINUTE: 60,
  MAX_RATE_LIMIT_PER_MINUTE: 600,
  /** How many past requests are kept for the settings panel. */
  REQUEST_LOG_ENTRIES: 25,
  /** Prefix stripped from model ids (`aihub/chatgpt` -> `chatgpt`). */
  MODEL_PREFIX: 'aihub/',
  /** Deliberate delay when a request is unauthenticated, in ms. */
  AUTH_FAILURE_DELAY_MS: 400
};

// -- Anti-bot hardening ------------------------------------------------------
const STEALTH = {
  /** Challenge pages we wait out instead of treating as a logged-out state. */
  CHALLENGE_HOSTS: [
    'challenges.cloudflare.com',
    'cf-challenge.cloudflare.com',
    'geo.captcha-delivery.com',
    'captcha-delivery.com',
    'fastly.com'
  ],
  /** Retries when a tab lands on a bot challenge. */
  CHALLENGE_MAX_RETRIES: 3,
  CHALLENGE_BASE_DELAY_MS: 4000,
  CHALLENGE_JITTER_MS: 3500,
  /** Minimum spacing between two automated reloads of the same tab. */
  MIN_RETRY_SPACING_MS: 5000,
  KEYSTROKE_MIN_DELAY_MS: 18,
  KEYSTROKE_MAX_DELAY_MS: 70,
  /** Blink features that must be off for a non-automated fingerprint. */
  DISABLED_BLINK_FEATURES: ['AutomationControlled']
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
  LOCAL_LOGINS_FILENAME: 'logins.json',
  LOCAL_ADAPTERS_FILENAME: 'adapters.json',
  FAVICON_DIRNAME: 'favicons',
  // Session cache: pinned cookies + login records, one file per service.
  SESSIONS_DIRNAME: 'sessions',
  SESSION_INDEX_FILENAME: 'index.json',
  SESSION_COOKIE_SUFFIX: '.cookies.json',
  FINGERPRINT_FILENAME: 'fingerprint.json'
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
  GET_SERVICE_DETAILS: 'get-service-details',
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
  NAV_RELOAD_HARD: 'nav-reload-hard',
  NAV_STOP: 'nav-stop',
  NAV_HOME: 'nav-home',
  SET_ZOOM: 'set-zoom',
  SET_MUTED: 'set-muted',
  FIND_IN_PAGE: 'find-in-page',
  STOP_FIND_IN_PAGE: 'stop-find-in-page',
  OPEN_TAB_DEVTOOLS: 'open-tab-devtools',
  CHECK_FOR_UPDATES: 'check-for-updates',
  GET_UPDATE_STATUS: 'get-update-status',
  QUIT_AND_INSTALL: 'quit-and-install',
  GET_BLOCKING_STATS: 'get-blocking-stats',
  // -- Sessions / logins
  GET_LOGIN_STATES: 'get-login-states',
  GET_SESSION_STATS: 'get-session-stats',
  RELOGIN_SERVICE: 'relogin-service',
  CLEAR_SERVICE_DATA: 'clear-service-data',
  TOUCH_SESSION: 'touch-session',
  // -- Local OpenAI-compatible API
  GET_API_STATUS: 'get-api-status',
  ROTATE_API_TOKEN: 'rotate-api-token',
  API_PING: 'api-ping',
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
  TAB_FIND_RESULT: 'tab-find-result',
  BLOCKING_STATE: 'blocking-state',
  LOGIN_STATE: 'login-state',
  SESSION_STATE: 'session-state',
  API_STATE: 'api-state',
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
  SESSION,
  API,
  STEALTH,
  STORAGE,
  STALE_DATA_MS,
  IPC
};
