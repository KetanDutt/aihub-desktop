/**
 * Auto-update wiring (electron-updater).
 *
 * Update checks only run in packaged builds: in development there is no
 * `app-update.yml`, and calling `checkForUpdates()` would just throw. The
 * current state is mirrored to the renderer so Settings > About can show it.
 */

const { app, dialog, Notification } = require('electron');
const log = require('electron-log');
const { IPC } = require('./constants');

const state = {
  enabled: false,
  status: 'idle', // idle | checking | available | downloading | downloaded | error | up-to-date
  version: null,
  progress: 0,
  error: null
};

function broadcast() {
  try {
    // Required lazily: window.js loads this module from its tray menu.
    // eslint-disable-next-line global-require
    const windowManager = require('./window');
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.UPDATE_STATE, getStatus());
  } catch (e) {
    log.debug('Unable to broadcast update state:', e.message);
  }
}

function setStatus(status, extra = {}) {
  Object.assign(state, { status }, extra);
  broadcast();
  return getStatus();
}

function getStatus() {
  return {
    ...state,
    currentVersion: app.getVersion(),
    channel: process.platform
  };
}

function notifyUpdateReady(autoUpdater) {
  const install = () => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      log.error('Unable to install update:', e.message);
    }
  };

  if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'Update ready',
      body: 'AI Hub Desktop will install the update the next time it restarts.'
    });
    notification.on('click', install);
    notification.show();
    return;
  }

  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: 'A new version has been downloaded. Restart to install it now?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    .then((result) => {
      if (result.response === 0) install();
    })
    .catch(() => {});
}

/**
 * @param {{ force?: boolean }} [options] `force` checks even when the previous
 *   state says an update is already downloaded.
 * @returns {Promise<object>} the new status
 */
async function checkForUpdates({ force = false } = {}) {
  if (!state.enabled) {
    return setStatus('idle', { error: 'Updates are only available in packaged builds' });
  }

  // eslint-disable-next-line global-require
  const { autoUpdater } = require('electron-updater');

  if (state.status === 'downloaded' && !force) return getStatus();

  setStatus('checking');
  try {
    await autoUpdater.checkForUpdates();
    return getStatus();
  } catch (error) {
    log.error('Update check failed:', error.message);
    return setStatus('error', { error: error.message });
  }
}

function quitAndInstall() {
  if (!state.enabled) return false;
  // eslint-disable-next-line global-require
  const { autoUpdater } = require('electron-updater');
  try {
    autoUpdater.quitAndInstall(false, true);
    return true;
  } catch (e) {
    log.error('Unable to install update:', e.message);
    return false;
  }
}

/**
 * Wire up electron-updater. Safe to call in development (it becomes a no-op).
 */
function setupAutoUpdater() {
  if (!app.isPackaged) {
    log.info('Auto-update disabled (development build)');
    state.enabled = false;
    return getStatus();
  }

  let autoUpdater;
  try {
    // eslint-disable-next-line global-require
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    log.error('electron-updater unavailable:', error.message);
    return getStatus();
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setStatus('checking'));

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info && info.version);
    setStatus('available', { version: info && info.version, progress: 0 });
  });

  autoUpdater.on('update-not-available', () => setStatus('up-to-date', { error: null }));

  autoUpdater.on('download-progress', (progress) => {
    setStatus('downloading', { progress: Math.round(progress.percent || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info && info.version);
    setStatus('downloaded', { version: info && info.version, progress: 100 });
    notifyUpdateReady(autoUpdater);
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error:', error && error.message);
    setStatus('error', { error: (error && error.message) || 'Unknown update error' });
  });

  state.enabled = true;

  // Give the window a moment to appear before the first check.
  setTimeout(() => {
    checkForUpdates().catch((error) => log.warn('Initial update check failed:', error.message));
  }, 8000);

  return getStatus();
}

module.exports = {
  setupAutoUpdater,
  checkForUpdates,
  getStatus,
  quitAndInstall,
  _resetForTests() {
    state.enabled = false;
    state.status = 'idle';
    state.version = null;
    state.progress = 0;
    state.error = null;
  }
};
