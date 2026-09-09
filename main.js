/**
 * AI Hub Desktop - main process entry point.
 *
 * Responsibilities: logging, crash containment, single-instance handling, deep
 * links (`aihub://<service>`), and wiring the modules together on startup.
 */

const { app, session, dialog, webContents } = require('electron');
const path = require('path');

const log = require('./src/logger');

log.configure({ isPackaged: app.isPackaged });

// Hot reload is a development-only convenience and lives in devDependencies,
// so it must never be required in a packaged build.
if (!app.isPackaged && process.env.NODE_ENV !== 'test' && process.env.AIHUB_NO_RELOAD !== '1') {
  try {
    // eslint-disable-next-line global-require
    require('electron-reload')(__dirname, {
      electron: require(path.join(__dirname, 'node_modules', 'electron')),
      hardResetMethod: 'exit'
    });
  } catch (error) {
    log.warn('Hot reload unavailable:', error.message);
  }
}

const { PROTOCOL } = require('./src/constants');
const { slugify } = require('./src/utils');

const dataStore = require('./src/data');
const windowManager = require('./src/window');
const blockingManager = require('./src/blocking');
const ipcManager = require('./src/ipc');
const updaterManager = require('./src/updater');

/** Deep links received before the shell UI is ready. */
const pendingDeepLinks = [];
let shellReady = false;

// ---------------------------------------------------------------------------
// Crash containment
// ---------------------------------------------------------------------------

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
  try {
    if (!app.isPackaged) dialog.showErrorBox('Unexpected error', String(error && error.message));
  } catch (e) {
    /* nothing sensible left to do */
  }
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

/**
 * Validate the service id carried by an `aihub://` URL.
 * @param {string} serviceId
 * @returns {boolean}
 */
function validateServiceId(serviceId) {
  // Strict on purpose: the raw value must already be a safe slug. The renderer
  // produces ids via the same rule, so no normalisation is needed here.
  if (typeof serviceId !== 'string') return false;
  const id = serviceId.trim();
  return id.length > 0 && id.length <= 64 && /^[a-z0-9]+$/i.test(id);
}

function deliverDeepLink(serviceId) {
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed() && shellReady) {
    mainWindow.webContents.send('deep-link-open', serviceId);
    return true;
  }
  pendingDeepLinks.push(serviceId);
  return false;
}

function flushPendingDeepLinks() {
  shellReady = true;
  const mainWindow = windowManager.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  while (pendingDeepLinks.length > 0) {
    mainWindow.webContents.send('deep-link-open', pendingDeepLinks.shift());
  }
}

function handleDeepLinkUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.startsWith(`${PROTOCOL}://`)) return false;
  try {
    const url = new URL(urlStr);
    // aihub://chatgpt  -> hostname "chatgpt"; aihub:///chatgpt -> pathname.
    const serviceId = url.hostname || url.pathname.replace(/^\/+/, '');
    if (!validateServiceId(serviceId)) {
      log.warn('Rejected deep link with invalid service id:', serviceId);
      return false;
    }
    log.info('Deep link accepted:', serviceId);
    return deliverDeepLink(slugify(serviceId));
  } catch (error) {
    log.error('Unable to parse deep link:', error.message);
    return false;
  }
}

function extractDeepLink(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${PROTOCOL}://`)) || null;
}

// ---------------------------------------------------------------------------
// Hardening applied to every webContents created anywhere in the app
// ---------------------------------------------------------------------------

app.on('web-contents-created', (event, contents) => {
  // No nested <webview> tags anywhere.
  contents.on('will-attach-webview', (attachEvent) => attachEvent.preventDefault());

  contents.on('destroyed', () => {
    blockingManager.removeTabDomains(contents.id);
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function bootstrap() {
  log.info(`Starting ${app.getName()} ${app.getVersion()} (packaged: ${app.isPackaged})`);

  ipcManager.setupIpcHandlers();

  // Load the bundled/downloaded catalogue before anything can open a tab.
  await dataStore.initialize();

  blockingManager.updateBlockingState(require('./src/config').getConfig(), dataStore.getRulesCache());
  blockingManager.setupWebRequestBlocking();

  const securityManager = require('./src/security');
  securityManager.hardenSession(session.defaultSession);

  windowManager.createMainWindow();
  windowManager.setupTray();
  const shortcut = windowManager.setupGlobalShortcuts();
  if (shortcut && !shortcut.ok) {
    log.warn(`Global shortcut unavailable (${shortcut.error})`);
  }

  const mainWindow = windowManager.getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', flushPendingDeepLinks);
  }

  updaterManager.setupAutoUpdater();

  // A deep link may have launched the app.
  const initialLink = extractDeepLink(process.argv);
  if (initialLink) handleDeepLinkUrl(initialLink);
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info('Another instance is already running, exiting');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    log.info('Second instance detected, focusing the existing window');
    windowManager.showMainWindow();

    const url = extractDeepLink(commandLine);
    if (url) handleDeepLinkUrl(url);
  });

  // macOS deep links.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    log.info('Received deep link:', url);
    handleDeepLinkUrl(url);
  });

  app.whenReady().then(bootstrap).catch((error) => {
    log.error('Startup failed:', error);
    dialog.showErrorBox('Startup failed', String(error && error.message));
    app.quit();
  });

  app.on('activate', () => {
    // macOS: reopening from the Dock must always give you a window.
    if (webContents.getAllWebContents().length === 0) {
      windowManager.createMainWindow();
    } else {
      windowManager.showMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    windowManager.setQuitting(true);
  });

  app.on('will-quit', () => {
    try {
      windowManager.shutdown();
      blockingManager.teardownWebRequestBlocking();
    } catch (error) {
      log.error('Error during shutdown:', error.message);
    }
  });
}

module.exports = {
  validateServiceId,
  handleDeepLinkUrl,
  extractDeepLink
};
