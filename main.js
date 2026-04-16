const { app, session, dialog } = require('electron');
const log = require('electron-log');
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
        // We could route this to switch to a specific tab
    }
  });

  app.on('open-url', (event, url) => {
      // macOS deep link handling
      event.preventDefault();
      log.info('Opened via deep link (macOS):', url);
  });

  app.whenReady().then(() => {
    log.info('App starting...');

    // Initialize IPC handlers
    ipcManager.setupIpcHandlers();

    // Load initial data
    dataStore.loadRules();

    // Set up blocking
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
    if (session.defaultSession) {
        session.defaultSession.webRequest.onBeforeRequest(null);
    }
  });
}
