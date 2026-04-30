const { ipcMain } = require('electron');
const configStore = require('./config');
const dataStore = require('./data');
const windowManager = require('./window');
const log = require('electron-log');

function setupIpcHandlers() {
  ipcMain.handle('get-config', () => configStore.getConfig());

  ipcMain.handle('clear-session-data', async () => {
    const { session } = require('electron');
    if (session.defaultSession) {
      await session.defaultSession.clearStorageData();
      return true;
    }
    return false;
  });


  ipcMain.handle('get-services', async () => {
    return await dataStore.loadServices();
  });

  ipcMain.handle('get-rules', async () => await dataStore.loadRules());

  ipcMain.handle('update-remote-data', async () => await dataStore.updateRemoteData());

  ipcMain.handle('save-config', (event, newConfig) => {
    const config = configStore.saveConfig(newConfig);
    const { updateBlockingState } = require('./blocking');
    updateBlockingState(config, dataStore.getRulesCache(), config.lastActiveService);
    return config;
  });

  ipcMain.handle('toggle-service', (event, serviceId) => {
    return configStore.toggleService(serviceId);
  });

  ipcMain.on('set-active-service', (event, serviceId) => {
    configStore.updateConfigItem('lastActiveService', serviceId);
    const { updateBlockingState } = require('./blocking');
    updateBlockingState(configStore.getConfig(), dataStore.getRulesCache(), serviceId);
  });

  // -- Tab Management --

  ipcMain.handle('create-tab', (event, { tabId, serviceId, url, userAgent }) => {
    log.info(`Creating tab ${tabId} for ${serviceId} at ${url}`);
    return windowManager.createTab(tabId, serviceId, url, userAgent);
  });

  ipcMain.on('switch-tab', (event, tabId) => {
    log.info(`Switching to tab ${tabId}`);
    windowManager.switchTab(tabId);
  });

  ipcMain.on('set-view-bounds', () => {
    windowManager.applyViewBounds();
  });

  ipcMain.on('nav-go-back', (event, tabId) => windowManager.navGoBack(tabId));
  ipcMain.on('nav-go-forward', (event, tabId) => windowManager.navGoForward(tabId));
  ipcMain.on('nav-reload', (event, tabId) => windowManager.navReload(tabId));

  ipcMain.on('close-tab', (event, tabId) => {
    log.info(`Closing tab ${tabId}`);
    windowManager.closeTab(tabId);
  });
}

module.exports = {
  setupIpcHandlers
};
