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
const catalog = require('./catalog');
const updater = require('./updater');
const sessionStore = require('./sessionstore');
const loginMonitor = require('./logins');
const stealth = require('./stealth');
const localApi = require('./api');
const paths = require('./paths');
const { IPC, APP_NAME, LIMITS } = require('./constants');
const { isSafeHttpUrl, slugify, clampFloat } = require('./utils');

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

/** Push the session/login picture to the shell UI. */
function sendSessions() {
  const win = windowManager.getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.SESSION_STATE, { logins: loginMonitor.getAll(), hardening: stealth.getStatus() });
}

/** Everything the Sessions + Local API panels show, in one round trip. */
async function sessionsSnapshot() {
  const config = configStore.getConfig();
  const services = (dataStore.getServicesCache() || {}).ai_services || [];
  const wanted = new Set([...services.map((service) => service.id), ...sessionStore.listSnapshots()]);
  const perService = {};

  for (const serviceId of wanted) {
    try {
      // eslint-disable-next-line no-await-in-loop
      perService[serviceId] = await sessionStore.getStats(serviceId, services.find((s) => s.id === serviceId));
    } catch (error) {
      perService[serviceId] = { serviceId, error: error.message };
    }
  }

  return {
    perService,
    hardening: stealth.getStatus(),
    isolation: Boolean(config.isolateSessions),
    persistence: config.sessionPersistence !== false,
    keepAlive: {
      enabled: config.keepAliveSessions !== false,
      minutes: config.keepAliveMinutes,
      nextIn: null
    },
    snapshots: sessionStore.listSnapshots().length,
    usage: config.serviceUsage || {}
  };
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
      const before = configStore.getConfig();
      const config = configStore.saveConfig(newConfig);

      refreshBlocking();
      windowManager.setTabLimit(config.maxActiveServices);
      windowManager.registerGlobalShortcut(config.globalShortcut);
      applyLoginItemSetting(config.launchAtLogin);

      // Which changes need the user to know that a restart is required?
      const notices = [];
      if (Boolean(before.isolateSessions) !== Boolean(config.isolateSessions)) {
        notices.push(
          'Session isolation changed. Close and reopen your tabs so each one attaches to the right profile.'
        );
      }
      if (Boolean(before.antiBotHardening) !== Boolean(config.antiBotHardening)) {
        notices.push('Anti-bot hardening applies to newly opened tabs.');
        stealth.getProfile({ force: true });
      }
      if (Boolean(before.antiBotCanvasNoise) !== Boolean(config.antiBotCanvasNoise)) {
        notices.push('Fingerprint noise changed: reload any tab that is already open.');
      }

      // The local endpoint follows the settings live.
      await localApi.onConfigChanged(before, config).catch((error) => {
        notices.push(`Local API: ${error.message}`);
      });
      if (config.sessionPersistence === false && before.sessionPersistence !== false) {
        loginMonitor.stopSweeps();
      } else if (config.sessionPersistence !== false && before.sessionPersistence === false) {
        loginMonitor.startSweeps();
      }

      return { success: true, config: configStore.getPublicConfig(), notices };
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
      hardening: stealth.getStatus(),
      api: localApi.describe(),
      sessions: { logins: loginMonitor.getAll(), snapshots: sessionStore.listSnapshots().length },
      blocking: { ...blocking.getBlockingSnapshot(), ...blocking.getStats() },
      tabs: windowManager.getTabStates(),
      update: updater.getStatus(),
      shortcut: configStore.getConfig().globalShortcut
    };
  });

  // -- Services / rules ------------------------------------------------------

  ipcMain.handle(IPC.GET_SERVICES, async () => {
    const services = await dataStore.loadServices();
    if (!services) return { ai_services: [], serviceCount: 0, schemaVersion: 1 };
    // Merge in the audited catalogue: cached icons, exact homepages, login URLs
    // and sign-in requirements, so the menus paint fully offline.
    return { ...services, ai_services: catalog.enrich(services.ai_services), catalog: catalog.status() };
  });

  ipcMain.handle(IPC.GET_SERVICE_DETAILS, (event, serviceId) => {
    const id = validServiceId(serviceId);
    return id ? catalog.detailsFor(id) : null;
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

  ipcMain.handle(IPC.GET_FAVICON, async (event, url, serviceId) => {
    // Prefer the icon cached by the service audit: it is already on disk, so
    // the tab strip never waits on (or leaks a request to) the live site.
    const id = serviceId ? validServiceId(serviceId) : null;
    if (id) {
      const cached = catalog.iconDataUrl(id);
      if (cached) return { dataUrl: cached, source: 'catalog' };
    }
    return favicon.getFavicon(url);
  });

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (event, url) =>
    security.openExternal(url, { parent: windowManager.getMainWindow() })
  );

  /**
   * Two scopes, because one button used to sign you out of everything:
   *   `cache` — HTTP cache + cached icons + counters. Logins stay.
   *   `all`   — the full wipe (cookies, storage) *and* the cached session
   *             snapshots, i.e. a genuine sign-out.
   */
  ipcMain.handle(IPC.CLEAR_SESSION_DATA, async (event, options) => {
    const scope = options && options.scope === 'all' ? 'all' : 'cache';
    try {
      if (scope === 'all') {
        if (session.defaultSession) await session.defaultSession.clearStorageData();
        for (const serviceId of sessionStore.listSnapshots()) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await sessionStore.clearService(serviceId);
          } catch (e) {
            /* one bad service must not abort the wipe */
          }
        }
        for (const record of [...loginMonitor._records.keys()]) loginMonitor._records.delete(record);
        loginMonitor.persistRecords();
      } else if (session.defaultSession && typeof session.defaultSession.clearCache === 'function') {
        await session.defaultSession.clearCache();
      }

      await favicon.clearCache();
      security.clearPermissionMemory();
      blocking.resetStats();
      refreshBlocking();
      sendSessions();
      return { success: true, scope };
    } catch (error) {
      log.error('Unable to clear session data:', error.message);
      return { success: false, error: error.message };
    }
  });

  // -- Sessions / logins -----------------------------------------------------

  ipcMain.handle(IPC.GET_SESSION_STATS, async () => ({ logins: loginMonitor.getAll(), ...(await sessionsSnapshot()) }));

  ipcMain.handle(IPC.CLEAR_SERVICE_DATA, async (event, serviceId) => {
    const id = slugify(typeof serviceId === 'string' ? serviceId : '');
    if (!id) return { success: false, error: 'invalid_service' };
    if (!validServiceId(id)) return { success: false, error: 'unknown_service' };

    try {
      const result = await sessionStore.clearService(id);
      const record = loginMonitor._records.get(id);
      if (record) {
        record.state = loginMonitor.STATE.LOGGED_OUT;
        record.reason = 'cleared-by-user';
        record.signedInAt = null;
      }
      loginMonitor.persistRecords();
      const tabId = windowManager.tabIdForService(id);
      if (tabId) windowManager.navReload(tabId);
      sendSessions();
      return { success: true, ...result };
    } catch (error) {
      log.warn(`Unable to clear the ${id} session: ${error.message}`);
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
    // Opening a tab is the moment a login is (re)established, so the monitor is
    // pointed at it and the cached cookies are already in place.
    return windowManager.createTab({
      tabId: data.tabId,
      serviceId,
      url: data.url,
      userAgent: typeof data.userAgent === 'string' ? data.userAgent : '',
      title: typeof data.title === 'string' ? data.title : '',
      zoomFactor: typeof data.zoomFactor === 'number' ? data.zoomFactor : 1,
      muted: Boolean(data.muted)
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
  ipcMain.on(IPC.NAV_RELOAD_HARD, (event, tabId) => validTabId(tabId) && windowManager.navReloadHard(tabId));
  ipcMain.on(IPC.NAV_STOP, (event, tabId) => validTabId(tabId) && windowManager.navStop(tabId));
  ipcMain.on(IPC.NAV_HOME, (event, tabId) => validTabId(tabId) && windowManager.navHome(tabId));

  ipcMain.handle(IPC.SET_ZOOM, (event, tabId, factor) => {
    if (!validTabId(tabId)) return null;
    return windowManager.setZoom(tabId, clampFloat(factor, 0.3, 5, 1));
  });

  ipcMain.handle(IPC.SET_MUTED, (event, tabId, muted) => {
    if (!validTabId(tabId)) return null;
    return windowManager.setMuted(tabId, Boolean(muted));
  });

  ipcMain.handle(IPC.FIND_IN_PAGE, (event, tabId, text, options) => {
    if (!validTabId(tabId)) return { matches: 0 };
    const query = typeof text === 'string' ? text.slice(0, 500) : '';
    return windowManager.findInPage(tabId, query, options && typeof options === 'object' ? options : {});
  });

  ipcMain.handle(IPC.STOP_FIND_IN_PAGE, (event, tabId) => {
    if (!validTabId(tabId)) return false;
    return windowManager.stopFindInPage(tabId);
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
  sendSessions,
  sessionsSnapshot,
  refreshBlocking,
  applyLoginItemSetting,
  validTabId,
  validServiceId
};
