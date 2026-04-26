const { app, session, dialog } = require('electron');

// Configure logging
const log = require('electron-log');
if (app.isPackaged) {
    log.transports.console.level = false;
    log.transports.file.level = 'info';
} else {
    log.transports.console.level = 'debug';
    log.transports.file.level = 'debug';
}

const dataStore = require('./src/data');
const windowManager = require('./src/window');
const blockingManager = require('./src/blocking');
const ipcManager = require('./src/ipc');
const updaterManager = require('./src/updater');

// Global error handling
process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error);
    dialog.showErrorBox('Unexpected Error', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// App Lifecycle

function validateServiceId(serviceId) {
    return serviceId && /^[a-z0-9]+$/i.test(serviceId);
}

function handleDeepLinkUrl(urlStr) {
    if (!urlStr || !urlStr.startsWith('aihub://')) return;
    try {
        const urlObj = new URL(urlStr);
        const serviceId = urlObj.hostname; // e.g. aihub://chatgpt -> chatgpt

        // Security: Validate serviceId to be alphanumeric only
        if (!validateServiceId(serviceId)) {
            log.warn('Rejected invalid deep link serviceId:', serviceId);
            return;
        }

        const mainWindow = windowManager.getMainWindow();
        if (mainWindow) {
            // Send IPC to renderer to create/switch tab because renderer manages state
            mainWindow.webContents.send('deep-link-open', serviceId);
        }
    } catch (e) {
        log.error('Failed to parse deep link:', e);
    }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }

    // Deep link handling in windows/linux
    const url = commandLine.find(arg => arg.startsWith('aihub://'));
    if (url) {
        log.info('Opened via deep link:', url);
        handleDeepLinkUrl(url);
    }
  });

  app.on('open-url', (event, url) => {
      // macOS deep link handling
      event.preventDefault();
      log.info('Opened via deep link (macOS):', url);
      handleDeepLinkUrl(url);
  });

  app.whenReady().then(async () => {
    log.info('App starting...');

    // Initialize IPC handlers
    ipcManager.setupIpcHandlers();

    // Load initial data
    await dataStore.loadRules();

    // Set up blocking
    blockingManager.updateBlockingState(require('./src/config').getConfig(), require('./src/data').getRulesCache(), require('./src/config').getConfig().lastActiveService);
    blockingManager.setupWebRequestBlocking();

    // Create UI
    windowManager.createMainWindow();
    windowManager.setupTray();
    windowManager.setupGlobalShortcuts();

    // Auto Update
    updaterManager.setupAutoUpdater();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    const { globalShortcut } = require('electron');
    globalShortcut.unregisterAll();
    if (session.defaultSession) {
        session.defaultSession.webRequest.onBeforeRequest(null);
    }
  });
}

module.exports = {
    validateServiceId
};
