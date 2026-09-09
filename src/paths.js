/**
 * Filesystem locations used by the app.
 *
 * Two locations matter:
 *  - the *bundled* data directory, shipped inside the app (works offline and on
 *    first launch before any remote sync has happened);
 *  - the *user* data directory, where downloaded copies and caches live.
 *
 * Both are resolvable without an Electron `app` object so tests can point them
 * at a temp directory through `AIHUB_DATA_DIR` / `AIHUB_BUNDLED_DIR`.
 */

const path = require('path');
const fs = require('fs');
const { STORAGE } = require('./constants');

function electronApp() {
  try {
    // eslint-disable-next-line global-require
    return require('electron').app;
  } catch (e) {
    return null;
  }
}

function isPackaged() {
  const app = electronApp();
  return Boolean(app && app.isPackaged);
}

/**
 * Directory of read-only data shipped with the app.
 * Packaged builds get it through `extraResources` (see package.json > build).
 */
function bundledDataDir() {
  if (process.env.AIHUB_BUNDLED_DIR) return process.env.AIHUB_BUNDLED_DIR;
  if (isPackaged() && process.resourcesPath) {
    return path.join(process.resourcesPath, STORAGE.BUNDLED_DIRNAME);
  }
  return path.join(__dirname, '..', STORAGE.DATA_DIRNAME);
}

/** Directory for downloaded services/rules data (writable). */
function userDataDir() {
  if (process.env.AIHUB_DATA_DIR) return process.env.AIHUB_DATA_DIR;
  const app = electronApp();
  const base = app ? app.getPath('userData') : path.join(__dirname, '..', '.aihub');
  return path.join(base, STORAGE.DATA_DIRNAME);
}

/** Directory for cached favicons. */
function faviconCacheDir() {
  if (process.env.AIHUB_DATA_DIR) {
    return path.join(process.env.AIHUB_DATA_DIR, STORAGE.FAVICON_DIRNAME);
  }
  const app = electronApp();
  const base = app ? app.getPath('userData') : path.join(__dirname, '..', '.aihub');
  return path.join(base, STORAGE.FAVICON_DIRNAME);
}

/** Create a directory (recursively) unless it already exists. */
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve the first existing file out of the given candidates.
 * @param {string[]} candidates
 * @returns {string|null}
 */
function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  bundledDataDir,
  userDataDir,
  faviconCacheDir,
  ensureDir,
  firstExisting
};
