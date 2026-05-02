const { app, BrowserWindow, Tray, Menu, globalShortcut, WebContentsView } = require('electron');
const path = require('path');
const configStore = require('./config');
const log = require('electron-log');

const { HEADER_HEIGHT, TABS_HEIGHT, STATUS_BAR_HEIGHT } = require('./constants');

let mainWindow = null;
let tray = null;
let views = {}; // Maps tab ID to WebContentsView instance
let activeTabId = null;

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

function createTab(tabId, serviceId, url, userAgent) {
    if (!mainWindow) return;

    if (views[tabId]) {
        switchTab(tabId);
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


    view.webContents.on('context-menu', () => {
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

    // Notify tab loading state
    view.webContents.on('did-start-loading', () => {
        if (mainWindow) {
            mainWindow.webContents.send('tab-loading', { tabId, isLoading: true });
        }
    });

    view.webContents.on('did-stop-loading', () => {
        if (mainWindow) {
            mainWindow.webContents.send('tab-loading', { tabId, isLoading: false });
        }
    });

    const sendNavState = () => {
        if (mainWindow && !view.webContents.isDestroyed()) {
            mainWindow.webContents.send('tab-nav-state', {
                tabId,
                canGoBack: view.webContents.canGoBack(),
                canGoForward: view.webContents.canGoForward()
            });
        }
    };

    view.webContents.on('did-navigate', sendNavState);
    view.webContents.on('did-navigate-in-page', sendNavState);

    mainWindow.contentView.addChildView(view);
    views[tabId] = view;

    // Register allowed domains for this specific webContents
    const { updateTabDomains } = require('./blocking');
    const dataStore = require('./data');
    updateTabDomains(view.webContents.id, serviceId, dataStore.getRulesCache());

    applyViewBounds();
    switchTab(tabId);

    // Update config state
    let openTabs = configStore.getConfig().openTabs || [];
    if (!openTabs.find(t => t.id === tabId)) {
        openTabs.push({ id: tabId, serviceId, url });
        configStore.updateConfigItem('openTabs', openTabs);
    }

    return { success: true };
}

function switchTab(tabId) {
    if (!mainWindow || activeTabId === tabId) return;

    // Suspend currently active tab if it exists
    if (activeTabId && views[activeTabId]) {
        const activeView = views[activeTabId];
        activeView.webContents.setBackgroundThrottling(true);
        mainWindow.contentView.removeChildView(activeView);
    }

    // Wake up target tab
    if (views[tabId]) {
        const targetView = views[tabId];
        targetView.webContents.setBackgroundThrottling(false);
        mainWindow.contentView.addChildView(targetView);
        activeTabId = tabId;

        // Also update the active service id in config so settings UI/others know
        // which service is active. We need to find the serviceId for this tabId.
        const openTabs = configStore.getConfig().openTabs || [];
        const tabData = openTabs.find(t => t.id === tabId);
        if (tabData && tabData.serviceId) {
             configStore.updateConfigItem('lastActiveService', tabData.serviceId);
        }
    } else {
        activeTabId = null;
    }

    configStore.updateConfigItem('activeTabId', tabId);
}

function closeTab(tabId) {
    if (!mainWindow || !views[tabId]) return;

    const view = views[tabId];

    // Unregister domain blocking for this webContents
    const { removeTabDomains } = require('./blocking');
    removeTabDomains(view.webContents.id);

    // Remove from UI if it's currently showing or in the view hierarchy
    mainWindow.contentView.removeChildView(view);
    view.webContents.close();
    delete views[tabId];

    if (activeTabId === tabId) {
        activeTabId = null;
    }

    let openTabs = configStore.getConfig().openTabs || [];
    openTabs = openTabs.filter(t => t.id !== tabId);
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





function navGoBack(tabId) {
    if (views[tabId] && views[tabId].webContents.canGoBack()) {
        views[tabId].webContents.goBack();
    }
}
function navGoForward(tabId) {
    if (views[tabId] && views[tabId].webContents.canGoForward()) {
        views[tabId].webContents.goForward();
    }
}
function navReload(tabId) {
    if (views[tabId]) {
        views[tabId].webContents.reload();
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
  applyViewBounds
};
