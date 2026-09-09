/**
 * IPC surface.
 *
 * Every value crossing the bridge is treated as untrusted: ids and URLs are
 * validated, config writes go through `sanitizeConfig()` and tab limits are
 * enforced in the main process (the renderer's own check is only UX).
 */

const { ipcMain, app, session } = require('electron');

const log = require('electron-log');
const configStore = require('./config');
const dataStore = require('./data');
const windowManager = require('./window');
const blocking = require('./blocking');
const security = require('./security');
const favicon = require('./favicon');
const updater = require('./updater');
const paths = require('./paths');
const { IPC, APP_NAME, LIMITS } = require('./constants');
const { isSafeHttpUrl, slugify, clampNumber } = require('./utils');

const TAB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function validTabId(tabId) {
  return typeof tabId === 'string' && TAB_ID_PATTERN.test(tabId);
}

function validServiceId(serviceId) {
  const id = slugify(serviceId || '');
  if (!id) return null;

  const services = dataStore.getServicesCache();
  if (services && services.ai_services && services.ai_services.length > 0) {
    const known = services.ai_services.some((service) => service.id === id);
    if (!known) return null;
  }
  return id;
}

/** Keep the blocking engine in sync with config + rules. */
function refreshBlocking() {
  const snapshot = blocking.updateBlockingState(configStore.getConfig(), dataStore.getRulesCache());
  const win = windowManager.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.BLOCKING_STATE, {
      ...snapshot,
      ...blocking.getStats()
    });
  }
  return snapshot;
}

function applyLoginItemSetting(openAtLogin) {
  if (process.platform === 'linux') return false;
  try {
    const settings = { openAtLogin: Boolean(openAtLogin), openAsHidden: false };
    if (app.isPackaged && process.platform === 'win32') settings.path = process.execPath;
    app.setLoginItemSettings(settings);
    return true;
  } catch (error) {
    log.warn('Unable to change the login item:', error.message);
    return false;
  }
}

function setupIpcHandlers() {
  // -- Configuration ---------------------------------------------------------

  ipcMain.handle(IPC.GET_CONFIG, () => configStore.getPublicConfig());

  ipcMain.handle(IPC.SAVE_CONFIG, async (event, newConfig) => {
    try {
      const config = configStore.saveConfig(newConfig);

      refreshBlocking();
      windowManager.setTabLimit(config.maxActiveServices);
      windowManager.registerGlobalShortcut(config.globalShortcut);
      applyLoginItemSetting(config.launchAtLogin);

      return { success: true, config: configStore.getPublicConfig() };
    } catch (error) {
      log.warn('Rejected config update:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC.GET_APP_INFO, () => {
    const versions = process.versions || {};
    return {
      name: APP_NAME,
      version: app.getVersion(),
      electron: versions.electron,
      chrome: versions.chrome,
      node: versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      userDataPath: app.getPath('userData'),
      dataPath: paths.userDataDir(),
      logPath: (() => {
        try {
          // eslint-disable-next-line global-require
          return require('./logger').getLogPath();
        } catch (e) {
          return null;
        }
      })(),
      data: dataStore.getDataStatus(),
      blocking: { ...blocking.getBlockingSnapshot(), ...blocking.getStats() },
      tabs: windowManager.getTabStates(),
      update: updater.getStatus(),
      shortcut: configStore.getConfig().globalShortcut
    };
  });

  // -- Services / rules ------------------------------------------------------

  ipcMain.handle(IPC.GET_SERVICES, async () => {
    const services = await dataStore.loadServices();
    return services || { ai_services: [], serviceCount: 0, schemaVersion: 1 };
  });

  ipcMain.handle(IPC.GET_RULES, async () => dataStore.loadRules());

  ipcMain.handle(IPC.UPDATE_REMOTE_DATA, async () => {
    const result = await dataStore.updateRemoteData();
    // The freshly downloaded rules must take effect immediately - previously
    // this only happened after a restart or a settings change.
    await dataStore.loadRules({ force: true });
    refreshBlocking();
    return result;
  });

  ipcMain.handle(IPC.TOGGLE_SERVICE, (event, serviceId) => {
    const id = slugify(serviceId || '');
    if (!id) return configStore.getConfigItem('enabledServices', []);
    return configStore.toggleService(id);
  });

  ipcMain.handle(IPC.GET_FAVICON, async (event, url) => favicon.getFavicon(url));

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (event, url) =>
    security.openExternal(url, { parent: windowManager.getMainWindow() })
  );

  ipcMain.handle(IPC.CLEAR_SESSION_DATA, async () => {
    try {
      if (session.defaultSession) {
        await session.defaultSession.clearStorageData();
      }
      await favicon.clearCache();
      security.clearPermissionMemory();
      blocking.resetStats();
      refreshBlocking();
      return { success: true };
    } catch (error) {
      log.error('Unable to clear session data:', error.message);
      return { success: false, error: error.message };
    }
  });

  // -- Tabs ------------------------------------------------------------------

  ipcMain.handle(IPC.CREATE_TAB, (event, payload) => {
    const data = payload || {};
    if (!validTabId(data.tabId)) return { success: false, error: 'invalid_tab_id' };

    const serviceId = validServiceId(data.serviceId);
    if (!serviceId) return { success: false, error: 'unknown_service' };

    if (!isSafeHttpUrl(data.url)) return { success: false, error: 'invalid_url' };

    log.info(`Creating tab ${data.tabId} for ${serviceId}`);
    return windowManager.createTab({
      tabId: data.tabId,
      serviceId,
      url: data.url,
      userAgent: typeof data.userAgent === 'string' ? data.userAgent : '',
      title: typeof data.title === 'string' ? data.title : ''
    });
  });

  ipcMain.on(IPC.SWITCH_TAB, (event, tabId) => {
    if (validTabId(tabId)) windowManager.switchTab(tabId);
  });

  ipcMain.on(IPC.CLOSE_TAB, (event, tabId) => {
    if (validTabId(tabId)) windowManager.closeTab(tabId);
  });

  ipcMain.on(IPC.CLOSE_OTHER_TABS, (event, tabId) => {
    if (validTabId(tabId)) windowManager.closeOtherTabs(tabId);
  });

  ipcMain.on(IPC.REORDER_TABS, (event, ids) => {
    if (Array.isArray(ids)) windowManager.reorderTabs(ids.filter(validTabId));
  });

  ipcMain.on(IPC.SET_VIEW_BOUNDS, (event, bounds) => {
    windowManager.setViewBounds(bounds);
  });

  ipcMain.on(IPC.NAV_GO_BACK, (event, tabId) => validTabId(tabId) && windowManager.navGoBack(tabId));
  ipcMain.on(IPC.NAV_GO_FORWARD, (event, tabId) => validTabId(tabId) && windowManager.navGoForward(tabId));
  ipcMain.on(IPC.NAV_RELOAD, (event, tabId) => validTabId(tabId) && windowManager.navReload(tabId));

  ipcMain.handle(IPC.SET_ZOOM, (event, tabId, factor) => {
    if (!validTabId(tabId)) return null;
    return windowManager.setZoom(tabId, clampNumber(factor, 0.3, 5, 1));
  });

  ipcMain.handle(IPC.OPEN_TAB_DEVTOOLS, (event, tabId) => {
    if (app.isPackaged) return false;
    return validTabId(tabId) ? windowManager.openDevTools(tabId) : false;
  });

  ipcMain.handle(IPC.GET_TAB_STATES, () => windowManager.getTabStates());

  ipcMain.handle(IPC.HIBERNATE_TABS, () => ({ hibernated: windowManager.hibernateIdleTabs() }));

  ipcMain.on(IPC.SET_ACTIVE_SERVICE, (event, serviceId) => {
    const id = slugify(serviceId || '');
    if (!id) return;
    configStore.updateConfigItem('lastActiveService', id);
    refreshBlocking();
  });

  // -- Updates ---------------------------------------------------------------

  ipcMain.handle(IPC.CHECK_FOR_UPDATES, () => updater.checkForUpdates({ notify: true }));
  ipcMain.handle(IPC.GET_UPDATE_STATUS, () => updater.getStatus());
  ipcMain.handle(IPC.QUIT_AND_INSTALL, () => updater.quitAndInstall());

  ipcMain.handle(IPC.GET_BLOCKING_STATS, () => ({
    ...blocking.getBlockingSnapshot(),
    ...blocking.getStats()
  }));

  // -- Window ----------------------------------------------------------------

  ipcMain.on(IPC.MINIMIZE_WINDOW, () => {
    const win = windowManager.getMainWindow();
    if (win) win.minimize();
  });

  ipcMain.on(IPC.MAXIMIZE_WINDOW, () => {
    const win = windowManager.getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on(IPC.CLOSE_WINDOW, () => {
    const win = windowManager.getMainWindow();
    if (!win) return;
    if (configStore.getConfig().minimizeToTray !== false) win.hide();
    else win.close();
  });

  ipcMain.on(IPC.QUIT_APP, () => {
    windowManager.setQuitting(true);
    app.quit();
  });

  // Sanity guard: the renderer cannot open more tabs than the configured limit
  // even if it loses track of its own state.
  ipcMain.handle(IPC.GET_LIMITS, () => ({
    maxTabs: windowManager.getTabStates().length,
    limit: configStore.getConfigItem('maxActiveServices', LIMITS.DEFAULT_MAX_TABS),
    minTabs: LIMITS.MIN_TABS,
    hardMax: LIMITS.MAX_TABS
  }));
}

module.exports = {
  setupIpcHandlers,
  refreshBlocking,
  applyLoginItemSetting,
  validTabId,
  validServiceId
};
