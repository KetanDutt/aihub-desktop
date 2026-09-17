/**
 * Preload bridge.
 *
 * The shell UI runs with `contextIsolation` + `sandbox` enabled, so this is the
 * only surface it can reach. Every `on*` subscription returns an unsubscribe
 * function so the renderer can clean up after itself.
 */

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  // -- Configuration ---------------------------------------------------------
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // -- Services --------------------------------------------------------------
  getServices: () => ipcRenderer.invoke('get-services'),
  getRules: () => ipcRenderer.invoke('get-rules'),
  updateRemoteData: () => ipcRenderer.invoke('update-remote-data'),
  toggleService: (serviceId) => ipcRenderer.invoke('toggle-service', serviceId),
  getFavicon: (url, serviceId) => ipcRenderer.invoke('get-favicon', url, serviceId),
  getServiceDetails: (serviceId) => ipcRenderer.invoke('get-service-details', serviceId),

  // -- Tabs ------------------------------------------------------------------
  createTab: (tab) => ipcRenderer.invoke('create-tab', tab),
  closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),
  closeOtherTabs: (tabId) => ipcRenderer.send('close-other-tabs', tabId),
  switchTab: (tabId) => ipcRenderer.send('switch-tab', tabId),
  reorderTabs: (ids) => ipcRenderer.send('reorder-tabs', ids),
  getTabStates: () => ipcRenderer.invoke('get-tab-states'),
  hibernateTabs: () => ipcRenderer.invoke('hibernate-tabs'),
  getLimits: () => ipcRenderer.invoke('get-limits'),
  setActiveService: (serviceId) => ipcRenderer.send('set-active-service', serviceId),
  setViewBounds: (bounds) => ipcRenderer.send('set-view-bounds', bounds),

  // -- Navigation ------------------------------------------------------------
  navGoBack: (tabId) => ipcRenderer.send('nav-go-back', tabId),
  navGoForward: (tabId) => ipcRenderer.send('nav-go-forward', tabId),
  navReload: (tabId) => ipcRenderer.send('nav-reload', tabId),
  navReloadHard: (tabId) => ipcRenderer.send('nav-reload-hard', tabId),
  navStop: (tabId) => ipcRenderer.send('nav-stop', tabId),
  navHome: (tabId) => ipcRenderer.send('nav-home', tabId),
  setZoom: (tabId, factor) => ipcRenderer.invoke('set-zoom', tabId, factor),
  setMuted: (tabId, muted) => ipcRenderer.invoke('set-muted', tabId, muted),
  findInPage: (tabId, text, options) => ipcRenderer.invoke('find-in-page', tabId, text, options),
  stopFindInPage: (tabId) => ipcRenderer.invoke('stop-find-in-page', tabId),
  openDevTools: (tabId) => ipcRenderer.invoke('open-tab-devtools', tabId),

  // -- Session / privacy -----------------------------------------------------
  clearSessionData: (options) => ipcRenderer.invoke('clear-session-data', options),
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings'),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getBlockingStats: () => ipcRenderer.invoke('get-blocking-stats'),

  // -- Sessions / logins -------------------------------------------------------
  getLoginStates: () => ipcRenderer.invoke('get-login-states'),
  getSessionStats: () => ipcRenderer.invoke('get-session-stats'),
  reloginService: (serviceId) => ipcRenderer.invoke('relogin-service', serviceId),
  clearServiceData: (serviceId) => ipcRenderer.invoke('clear-service-data', serviceId),
  touchSession: (serviceId) => ipcRenderer.invoke('touch-session', serviceId),

  // -- Local OpenAI-compatible API --------------------------------------------
  getApiStatus: () => ipcRenderer.invoke('get-api-status'),
  rotateApiToken: () => ipcRenderer.invoke('rotate-api-token'),
  apiPing: () => ipcRenderer.invoke('api-ping'),

  // -- Updates ---------------------------------------------------------------
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  // -- Window ----------------------------------------------------------------
  minimize: () => ipcRenderer.send('minimize-window'),
  toggleMaximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
  quit: () => ipcRenderer.send('quit-app'),

  // -- Events (each returns an unsubscribe function) -------------------------
  onDeepLinkOpen: (callback) => subscribe('deep-link-open', callback),
  onTabState: (callback) => subscribe('tab-state', callback),
  onTabCreated: (callback) => subscribe('tab-created', callback),
  onTabClosed: (callback) => subscribe('tab-closed', callback),
  onTabsEmptied: (callback) => subscribe('tabs-emptied', callback),
  onTabBlocked: (callback) => subscribe('tab-blocked', callback),
  onTabFindResult: (callback) => subscribe('tab-find-result', callback),
  onBlockingState: (callback) => subscribe('blocking-state', callback),
  onLoginState: (callback) => subscribe('login-state', callback),
  onSessionState: (callback) => subscribe('session-state', callback),
  onApiState: (callback) => subscribe('api-state', callback),
  onUpdateState: (callback) => subscribe('update-state', callback)
});
