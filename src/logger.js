/**
 * Centralised logger.
 *
 * `electron-log` writes to both the console and a rotating file inside the user
 * data directory. Everything in the main process should use this module so log
 * configuration lives in exactly one place.
 */

const log = require('electron-log');

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
 * Configure transports once. Safe to call multiple times.
 * @param {{ isPackaged?: boolean }} [options] Override auto-detection (tests).
 * @returns {object} the configured logger
 */
function configure({ isPackaged = readIsPackaged() } = {}) {
  if (configured) return log;

  // Cap the on-disk log so a chatty session cannot fill the disk.
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
  log.transports.file.level = isPackaged ? 'info' : 'debug';
  log.transports.console.level = isPackaged ? false : 'debug';

  if (typeof log.catchErrors === 'function') {
    log.catchErrors({
      showDialog: false,
      onError(error) {
        log.error('Caught error:', error);
      }
    });
  }

  configured = true;
  return log;
}

/** Absolute path of the log file (shown in Settings > About). */
function getLogPath() {
  try {
    return log.transports.file.getFile().path;
  } catch (e) {
    return null;
  }
}

/** Reset for tests. */
function _resetForTests() {
  configured = false;
}

configure();

module.exports = log;
module.exports.configure = configure;
module.exports.getLogPath = getLogPath;
module.exports._resetForTests = _resetForTests;
