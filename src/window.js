const { app, BrowserWindow, Tray, Menu, globalShortcut, WebContentsView } = require('electron');
const path = require('path');
const configStore = require('./config');
const log = require('electron-log');

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
      updateViewsBounds();
  });

  // Set up deep linking
  app.setAsDefaultProtocolClient('aihub');
}

function getMainWindow() {
  return mainWindow;
}

function setupTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'ui', 'favicon.png');
    tray = new Tray(iconPath);
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

    view.webContents.loadURL(url);
    mainWindow.contentView.addChildView(view);
    views[serviceId] = view;

    updateViewsBounds();
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

function updateViewsBounds() {
    if (!mainWindow) return;

    const bounds = mainWindow.getBounds();
    // Assuming top header/sidebar takes some space. Let's adjust based on index.html layout.
    // Generally renderer will pass bounds, or we calculate it.
    // For simplicity, we calculate a rough estimate based on a typical layout.
    // Width: total - sidebar(320px, unless hidden). Let's let renderer tell us the bounds for better accuracy,
    // or set a default.
    // To properly handle dynamic bounds, renderer must update us. We will export an IPC handler.
}

function setViewBounds(bounds) {
    if (!mainWindow) return;
    for (const view of Object.values(views)) {
        view.setBounds(bounds);
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
  setViewBounds
};
