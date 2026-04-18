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
    createTab: (serviceId, url, userAgent) => ipcRenderer.invoke('create-tab', { serviceId, url, userAgent }),
    switchTab: (serviceId) => ipcRenderer.send('switch-tab', serviceId),
    closeTab: (serviceId) => ipcRenderer.send('close-tab', serviceId),
    setViewBounds: (bounds) => ipcRenderer.send('set-view-bounds', bounds)
});
