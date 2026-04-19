const { app, BrowserWindow, Tray, Menu, globalShortcut, WebContentsView } = require('electron');
const path = require('path');
const configStore = require('./config');
const log = require('electron-log');

const { HEADER_HEIGHT, TABS_HEIGHT, STATUS_BAR_HEIGHT } = require('./constants');

let mainWindow = null;
let tray = null;
let views = {}; // Maps tab ID to WebContentsView instance

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'AI Hub Desktop',
    backgroundColor: '#202124',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting && process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('resize', () => {
      applyViewBounds();
  });

  // Set up deep linking
  app.setAsDefaultProtocolClient('aihub');
}

function getMainWindow() {
  return mainWindow;
}

function setupTray() {
  try {
    const { nativeImage } = require('electron');
    const iconPath = path.join(__dirname, '..', 'ui', 'favicon.png');
    let trayIcon;
    try {
        if (require('fs').existsSync(iconPath)) {
            trayIcon = nativeImage.createFromPath(iconPath);
        } else {
            trayIcon = nativeImage.createEmpty();
            console.warn('Tray icon not found, using empty fallback');
        }
    } catch (e) {
        trayIcon = nativeImage.createEmpty();
    }
    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Window', click: () => { if (mainWindow) mainWindow.show(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('AI Hub Desktop');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) {
          if (mainWindow.isVisible()) {
              mainWindow.hide();
          } else {
              mainWindow.show();
          }
      }
    });
  } catch (error) {
    log.error('Failed to create tray:', error);
  }
}

function setupGlobalShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
}

// -- WebContentsView Tab Management --

function createTab(serviceId, url, userAgent) {
    if (!mainWindow) return;

    if (views[serviceId]) {
        switchTab(serviceId);
        return;
    }

    const config = configStore.getConfig();
    if (Object.keys(views).length >= config.maxActiveServices) {
        return { success: false, error: 'limit_reached' };
    }

    const view = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    if (userAgent) {
        view.webContents.userAgent = userAgent;
    }


    const config = configStore.getConfig();
    let finalUrl = url;
    if (config.useProxy && config.proxyUrl) {
        // Construct standard web proxy URL structure. Some proxy sites use query params, some use POST.
        // For simplicity, we just pass the URL in the d query param if it looks like proxysite.
        if (config.proxyUrl.includes('?')) {
            finalUrl = `${config.proxyUrl}&d=${encodeURIComponent(url)}`;
        } else {
            finalUrl = `${config.proxyUrl}?d=${encodeURIComponent(url)}`;
        }
        log.info(`Using proxy: ${finalUrl}`);
    }

    view.webContents.loadURL(finalUrl);


    view.webContents.on('context-menu', (event, params) => {
        const { Menu } = require('electron');
        const menu = Menu.buildFromTemplate([
            { role: 'copy' },
            { role: 'paste' },
            { type: 'separator' },
            { label: 'Reload', click: () => view.webContents.reload() },
            { type: 'separator' },
            { role: 'toggleDevTools' }
        ]);
        menu.popup();
    });

    mainWindow.contentView.addChildView(view);
    views[serviceId] = view;

    applyViewBounds();
    switchTab(serviceId);

    // Update config state
    let openTabs = configStore.getConfig().openTabs || [];
    if (!openTabs.find(t => t.id === serviceId)) {
        openTabs.push({ id: serviceId, url });
        configStore.updateConfigItem('openTabs', openTabs);
    }

    return { success: true };
}

function switchTab(serviceId) {
    if (!mainWindow) return;

    // Remove all child views from window
    const currentViews = mainWindow.contentView.children;
    for (const view of currentViews) {
         mainWindow.contentView.removeChildView(view);
    }

    // Wake up target tab and hide others
    for (const [id, view] of Object.entries(views)) {
        if (id === serviceId) {
            // Wake up
            view.webContents.setBackgroundThrottling(false);
            // Add back to display
            mainWindow.contentView.addChildView(view);
        } else {
            // Suspend other tabs
            view.webContents.setBackgroundThrottling(true);
        }
    }

    configStore.updateConfigItem('activeTabId', serviceId);
    configStore.updateConfigItem('lastActiveService', serviceId);
}

function closeTab(serviceId) {
    if (!mainWindow || !views[serviceId]) return;

    const view = views[serviceId];
    mainWindow.contentView.removeChildView(view);
    view.webContents.close();
    delete views[serviceId];

    let openTabs = configStore.getConfig().openTabs || [];
    openTabs = openTabs.filter(t => t.id !== serviceId);
    configStore.updateConfigItem('openTabs', openTabs);
}


function calculateViewBounds() {
    if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
    const [windowWidth, windowHeight] = mainWindow.getContentSize();
    return {
        x: 0,
        y: HEADER_HEIGHT + TABS_HEIGHT,
        width: windowWidth,
        height: windowHeight - (HEADER_HEIGHT + TABS_HEIGHT + STATUS_BAR_HEIGHT)
    };
}

function applyViewBounds() {
    if (!mainWindow) return;
    const bounds = calculateViewBounds();
    for (const view of Object.values(views)) {
        view.setBounds(bounds);
    }
}





function navGoBack(serviceId) {
    if (views[serviceId] && views[serviceId].webContents.canGoBack()) {
        views[serviceId].webContents.goBack();
    }
}
function navGoForward(serviceId) {
    if (views[serviceId] && views[serviceId].webContents.canGoForward()) {
        views[serviceId].webContents.goForward();
    }
}
function navReload(serviceId) {
    if (views[serviceId]) {
        views[serviceId].webContents.reload();
    }
}

module.exports = {
  createMainWindow,
  getMainWindow,
  setupTray,
  setupGlobalShortcuts,
  createTab,
  switchTab,
  closeTab,
  navGoBack,
  navGoForward,
  navReload,
  };
