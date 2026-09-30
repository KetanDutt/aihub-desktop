/**
 * Centralised logger.
 *
 * `electron-log` writes to both the console and a rotating file inside the user
 * data directory. Everything in the main process goes through this module so
 * log configuration lives in exactly one place, and so a missing/partial
 * `electron-log` (an offline install, a unit-test mock, an older runtime)
 * degrades to a no-op instead of crashing a request or a test.
 *
 *   const log = require('./logger');
 *   log.info('…'); log.warn('…'); log.error('…'); log.debug('…');
 *
 * Never log secrets: cookie values, the local API key and anything read from
 * `sessionstore` must stay out of the log file (see `docs/security.md`).
 */

const raw = require('electron-log');

/** Levels electron-log ships with; `log` is its generic entry point. */
const LEVELS = ['error', 'warn', 'info', 'verbose', 'debug', 'silly', 'log'];

let configured = false;

function readIsPackaged() {
  try {
    // eslint-disable-next-line global-require
    return Boolean(require('electron').app && require('electron').app.isPackaged);
  } catch (e) {
    return false;
  }
}

/**
 * Forward to the underlying logger when it implements the level.
 *
 * A level the backend does not implement is dropped rather than faked with
 * `console.log`: tests stub `electron-log` with only the methods they assert
 * on, and mirroring every debug call to stdout would drown their output.
 */
function forward(level, args) {
  const fn = raw && typeof raw[level] === 'function' ? raw[level] : null;
  if (!fn) return undefined;
  try {
    return fn.apply(raw, args);
  } catch (error) {
    // Logging must never be the reason something fails.
    return undefined;
  }
}

/**
 * Configure transports once. Safe to call multiple times, and safe to call
 * against a partial backend.
 * @param {{ isPackaged?: boolean }} [options] Override auto-detection (tests).
 * @returns {object} this logger
 */
function configure({ isPackaged = readIsPackaged() } = {}) {
  if (configured) return logger;
  configured = true;

  try {
    const file = raw && raw.transports && raw.transports.file;
    const consoleTransport = raw && raw.transports && raw.transports.console;
    // Cap the on-disk log so a chatty session cannot fill the disk.
    if (file) {
      file.maxSize = 5 * 1024 * 1024; // 5 MB, rotated to a single `.old` file
      file.level = isPackaged ? 'info' : 'debug';
      // The log names services, hosts and file paths; keep it owner-only on
      // POSIX. Windows ignores file modes, hence the platform check.
      if (process.platform !== 'win32' && file.writeOptions) file.writeOptions.mode = 0o600;
    }
    if (consoleTransport) consoleTransport.level = isPackaged ? false : 'debug';

    if (typeof raw.catchErrors === 'function') {
      raw.catchErrors({
        showDialog: false,
        onError(error) {
          forward('error', ['Caught error:', error]);
        }
      });
    }
  } catch (error) {
    // A mocked or minimal backend: keep going, the app still runs.
  }

  return logger;
}

/** Absolute path of the log file (shown in Settings > About). */
function getLogPath() {
  try {
    const file = raw && raw.transports && raw.transports.file;
    if (!file || typeof file.getFile !== 'function') return null;
    return file.getFile().path;
  } catch (e) {
    return null;
  }
}

/** Reset for tests. */
function _resetForTests() {
  configured = false;
}

/** A logger that tags every line, for modules that log a lot. */
function scope(name) {
  const tag = `[${name}]`;
  const scoped = {};
  for (const level of LEVELS) {
    scoped[level] = (...args) => forward(level, [tag, ...args]);
  }
  return scoped;
}

const logger = {
  configure,
  getLogPath,
  scope,
  _resetForTests,
  /** Escape hatch for callers that need a transport detail (rare). */
  get raw() {
    return raw;
  }
};

for (const level of LEVELS) {
  logger[level] = (...args) => forward(level, args);
}

// Transports may be read by advanced callers/tests; expose the real ones when
// the backend has them so behaviour is unchanged for anything that relied on it.
if (raw && raw.transports) {
  for (const [key, value] of Object.entries(raw.transports)) {
    if (!(key in logger)) logger[key] = value;
  }
}

configure();

module.exports = logger;
