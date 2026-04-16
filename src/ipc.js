const { ipcMain } = require('electron');
const configStore = require('./config');
const dataStore = require('./data');
const windowManager = require('./window');
const log = require('electron-log');

function setupIpcHandlers() {
  ipcMain.handle('get-config', () => configStore.getConfig());

  ipcMain.handle('get-services', () => {
    return dataStore.loadServices();
  });

  ipcMain.handle('get-rules', () => dataStore.loadRules());

  ipcMain.handle('update-remote-data', async () => await dataStore.updateRemoteData());

  ipcMain.handle('save-config', (event, newConfig) => {
    return configStore.saveConfig(newConfig);
  });

  ipcMain.handle('toggle-service', (event, serviceId) => {
    return configStore.toggleService(serviceId);
  });

  ipcMain.on('set-active-service', (event, serviceId) => {
    configStore.updateConfigItem('lastActiveService', serviceId);
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

  ipcMain.on('close-tab', (event, serviceId) => {
    log.info(`Closing tab ${serviceId}`);
    windowManager.closeTab(serviceId);
  });

  ipcMain.on('set-view-bounds', (event, bounds) => {
      windowManager.setViewBounds(bounds);
  });
}

module.exports = {
  setupIpcHandlers
};
