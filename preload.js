const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Configuration
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),

    // Services
    getServices: () => ipcRenderer.invoke('get-services'),
    getRules: () => ipcRenderer.invoke('get-rules'),
    updateRemoteData: () => ipcRenderer.invoke('update-remote-data'),

    // Service Management
    toggleService: (serviceId) => ipcRenderer.invoke('toggle-service', serviceId),

    // Tab Management
    setActiveService: (serviceId) => ipcRenderer.send('set-active-service', serviceId),
    createTab: (tabId, serviceId, url, userAgent) => ipcRenderer.invoke('create-tab', { tabId, serviceId, url, userAgent }),
    switchTab: (tabId) => ipcRenderer.send('switch-tab', tabId),
    closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),
    setViewBounds: (bounds) => ipcRenderer.send('set-view-bounds', bounds),

    // Navigation
    navGoBack: (id) => ipcRenderer.send('nav-go-back', id),
    navGoForward: (id) => ipcRenderer.send('nav-go-forward', id),
    navReload: (id) => ipcRenderer.send('nav-reload', id),

    // Session
    clearSessionData: () => ipcRenderer.invoke('clear-session-data'),

    // Deep Link
    onDeepLinkOpen: (callback) => ipcRenderer.on('deep-link-open', (event, serviceId) => callback(serviceId)),

    // Events
    onTabLoading: (callback) => ipcRenderer.on('tab-loading', (event, data) => callback(data)),
    onTabNavState: (callback) => ipcRenderer.on('tab-nav-state', (event, data) => callback(data))
});
