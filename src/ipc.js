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

  ipcMain.handle('create-tab', (event, { serviceId, url, userAgent }) => {
    log.info(`Creating tab for ${serviceId} at ${url}`);
    return windowManager.createTab(serviceId, url, userAgent);
  });

  ipcMain.on('switch-tab', (event, serviceId) => {
    log.info(`Switching to tab ${serviceId}`);
    windowManager.switchTab(serviceId);
  });

    ipcMain.on('nav-go-back', (event, serviceId) => windowManager.navGoBack(serviceId));
  ipcMain.on('nav-go-forward', (event, serviceId) => windowManager.navGoForward(serviceId));
  ipcMain.on('nav-reload', (event, serviceId) => windowManager.navReload(serviceId));

  ipcMain.on('close-tab', (event, serviceId) => {
    log.info(`Closing tab ${serviceId}`);
    windowManager.closeTab(serviceId);
  });
}

module.exports = {
  setupIpcHandlers
};
