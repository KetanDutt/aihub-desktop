/**
 * Window, tray, shortcuts and the `WebContentsView` tab host.
 *
 * Layout: the shell UI (`ui/index.html`) draws the header, tab strip and status
 * bar. Each service lives in its own `WebContentsView` positioned over the
 * `#webviews-container` element. The renderer reports the container's real
 * bounds; the numbers in `constants.js` are only a fallback for the first
 * frames before that report arrives.
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  WebContentsView,
  nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');

const log = require('electron-log');
const configStore = require('./config');
const dataStore = require('./data');
const blocking = require('./blocking');
const security = require('./security');
const stealth = require('./stealth');
const sessionStore = require('./sessionstore');
const loginMonitor = require('./logins');
const { TabManager } = require('./tabs');
const {
  LAYOUT,
  LIMITS,
  HIBERNATION,
  GLOBAL_SHORTCUT_DEFAULT,
  PROTOCOL,
  APP_NAME,
  IPC
} = require('./constants');
const { clampNumber, clampFloat, truncate, safeHostname } = require('./utils');

let mainWindow = null;
let tray = null;
let registeredShortcut = null;
let hibernationTimer = null;
let persistTimer = null;
let viewBounds = null; // last bounds reported by the renderer
let isQuitting = false;

const tabs = new TabManager({
  limit: LIMITS.DEFAULT_MAX_TABS,
  onChange: () => schedulePersist()
});

/** tabId -> WebContentsView (absent while the tab is hibernated) */
const views = new Map();

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function iconPath(name) {
  const candidates = [
    path.join(__dirname, '..', 'build', name),
    path.join(__dirname, '..', 'ui', 'favicon.png')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createMainWindow() {
  const config = configStore.getConfig();
  tabs.setLimit(config.maxActiveServices);

  mainWindow = new BrowserWindow({
    width: LAYOUT.DEFAULT_WIDTH,
    height: LAYOUT.DEFAULT_HEIGHT,
    minWidth: LAYOUT.MIN_WIDTH,
    minHeight: LAYOUT.MIN_HEIGHT,
    title: APP_NAME,
    backgroundColor: config.darkMode === false ? '#e8ecf3' : '#080a0e',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });

  const icon = iconPath('icon.png');
  if (icon) mainWindow.setIcon(nativeImage.createFromPath(icon));

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // The shell UI must never be filtered by the domain allow-list.
    blocking.registerTrustedWebContents(mainWindow.webContents.id);
    applyViewBounds();
  });

  security.installShellGuards(mainWindow);

  mainWindow.on('resize', () => applyViewBounds());
  mainWindow.on('maximize', () => applyViewBounds());
  mainWindow.on('unmaximize', () => applyViewBounds());

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (configStore.getConfig().minimizeToTray !== false) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    destroyAllViews();
    mainWindow = null;
  });

  // Deep links. On Windows the URL arrives on the command line, which in
  // development means passing the electron binary + app path explicitly.
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '')]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  startHibernationSweep();
  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

function setQuitting(value) {
  isQuitting = value;
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow) {
    showMainWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

/** Send a message to the shell UI when it is still alive. */
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Tray + shortcuts
// ---------------------------------------------------------------------------

function buildTrayMenu() {
  const template = [
    { label: 'Show AI Hub Desktop', click: () => showMainWindow() },
    { type: 'separator' }
  ];

  const openTabs = tabs.list();
  if (openTabs.length > 0) {
    template.push({ label: 'Open tabs', enabled: false });
    for (const tab of openTabs.slice(0, 10)) {
      template.push({
        label: truncate(tab.title || tab.serviceId, 40),
        click: () => {
          showMainWindow();
          switchTab(tab.id);
        }
      });
    }
    template.push({ type: 'separator' });
  }

  template.push({
    label: 'Check for updates…',
    click: () => {
      showMainWindow();
      // eslint-disable-next-line global-require
      require('./updater').checkForUpdates({ notify: true });
    }
  });
  template.push({
    label: 'Quit',
    click: () => {
      isQuitting = true;
      app.quit();
    }
  });

  return Menu.buildFromTemplate(template);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function setupTray() {
  try {
    const icon = iconPath('tray.png') || iconPath('icon.png') || path.join(__dirname, '..', 'ui', 'favicon.png');
    let image = nativeImage.createFromPath(icon);
    if (image.isEmpty()) image = nativeImage.createEmpty();
    if (process.platform === 'darwin' && image.getSize().width > 22) {
      image = image.resize({ width: 18, height: 18 });
    }

    tray = new Tray(image);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => toggleMainWindow());
  } catch (error) {
    log.error('Unable to create the tray icon:', error.message);
    tray = null;
  }
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Register the global show/hide shortcut.
 * @returns {{ok: boolean, accelerator: string, error?: string}}
 */
function registerGlobalShortcut(accelerator) {
  const requested = accelerator || configStore.getConfig().globalShortcut || GLOBAL_SHORTCUT_DEFAULT;

  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }

  try {
    const ok = globalShortcut.register(requested, () => toggleMainWindow());
    if (!ok) {
      log.warn(`Global shortcut ${requested} is already taken by another application`);
      return { ok: false, accelerator: requested, error: 'unavailable' };
    }
    registeredShortcut = requested;
    return { ok: true, accelerator: requested };
  } catch (error) {
    log.error('Unable to register the global shortcut:', error.message);
    return { ok: false, accelerator: requested, error: error.message };
  }
}

function setupGlobalShortcuts() {
  return registerGlobalShortcut();
}

function unregisterGlobalShortcuts() {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }
}

// ---------------------------------------------------------------------------
// View bounds
// ---------------------------------------------------------------------------

function calculateViewBounds() {
  if (viewBounds) return viewBounds;
  if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
  const [width, height] = mainWindow.getContentSize();
  const top = LAYOUT.HEADER_HEIGHT + LAYOUT.TABS_HEIGHT;
  return {
    x: 0,
    y: top,
    width: Math.max(0, width),
    height: Math.max(0, height - top - LAYOUT.STATUS_BAR_HEIGHT)
  };
}

/**
 * Accept bounds reported by the renderer. Values are clamped to the window so a
 * compromised renderer cannot place a view outside the window.
 */
function setViewBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return false;
  if (!mainWindow) return false;

  const [maxWidth, maxHeight] = mainWindow.getContentSize();
  const clean = {
    x: clampNumber(bounds.x, 0, Math.max(0, maxWidth), 0),
    y: clampNumber(bounds.y, 0, Math.max(0, maxHeight), 0),
    width: clampNumber(bounds.width, 0, Math.max(0, maxWidth), 0),
    height: clampNumber(bounds.height, 0, Math.max(0, maxHeight), 0)
  };

  const changed =
    !viewBounds ||
    viewBounds.x !== clean.x ||
    viewBounds.y !== clean.y ||
    viewBounds.width !== clean.width ||
    viewBounds.height !== clean.height;

  viewBounds = clean;
  if (changed) applyViewBounds();
  return true;
}

function applyViewBounds() {
  if (!mainWindow) return;
  const bounds = calculateViewBounds();
  for (const view of views.values()) {
    try {
      view.setBounds(bounds);
    } catch (e) {
      log.debug('Unable to apply bounds:', e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function notifyTabState(tab) {
  if (!tab) return;
  send(IPC.TAB_STATE, {
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    hibernated: tab.hibernated,
    active: tabs.activeTabId === tab.id,
    zoomFactor: tab.zoomFactor,
    muted: Boolean(tab.muted)
  });
}

/** Cheap re-check of the challenge rule (the monitor owns the real logic). */
function isLoginChallenge(url) {
  try {
    // eslint-disable-next-line global-require
    const { isChallengeUrl } = require('./loginstate');
    return isChallengeUrl(url);
  } catch (e) {
    return false;
  }
}

/**
 * Remember that a service was used, for "most recently used" ordering in the
 * service picker. Written straight through to the store; the renderer never
 * touches this key.
 */
function noteServiceUsage(serviceId) {
  if (!serviceId) return;
  try {
    const usage = { ...(configStore.getConfigItem('serviceUsage', {}) || {}) };
    usage[serviceId] = Date.now();
    configStore.updateConfigItem('serviceUsage', usage);
  } catch (e) {
    /* usage tracking is optional */
  }
}

/** Add a view to the window unless it is already a child (keeps z-order sane). */
function ensureChildView(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const children = mainWindow.contentView.children || [];
  if (!children.includes(view)) mainWindow.contentView.addChildView(view);
}

function persistTabsNow() {
  if (!configStore) return;
  try {
    configStore.updateConfigItem('openTabs', tabs.toJSON());
    configStore.updateConfigItem('activeTabId', tabs.activeTabId);
  } catch (error) {
    log.error('Unable to persist tabs:', error.message);
  }
}

/** Debounced persistence: tab churn should not hammer the disk. */
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistTabsNow();
    refreshTrayMenu();
  }, 400);
  if (typeof persistTimer.unref === 'function') persistTimer.unref();
}

function proxyUrlFor(url) {
  const config = configStore.getConfig();
  if (!config.useProxy || !config.proxyUrl) return url;
  const separator = config.proxyUrl.includes('?') ? '&' : '?';
  const proxied = `${config.proxyUrl}${separator}d=${encodeURIComponent(url)}`;
  log.info('Routing tab through the configured proxy');
  return proxied;
}

/**
 * While a web proxy is enabled, inject the proxy host into the tab allow-list
 * so proxied traffic is not self-blocked by the domain filter.
 * @param {Set<string>} allowList
 */
function injectProxyHost(allowList) {
  const config = configStore.getConfig();
  if (!config.useProxy || !config.proxyUrl || !allowList) return;
  const host = safeHostname(config.proxyUrl);
  if (host) allowList.add(host);
}

/** Create the `WebContentsView` backing a tab record. */
function createViewForTab(tab) {
  if (!mainWindow) return null;

  const partition = sessionStore.partitionFor(tab.serviceId);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: true,
      // Isolating the jar per service is opt-in; by default everything shares
      // the persistent default session, which is what makes SSO work.
      ...(partition ? { partition } : {})
    }
  });

  if (tab.userAgent) view.webContents.userAgent = tab.userAgent;
  else stealth.applyToSession(view.webContents.session);

  const webContentsId = view.webContents.id;

  // Register the allow-list *before* navigating so no request escapes it.
  const allowList = blocking.updateTabDomains(webContentsId, tab.serviceId, dataStore.getRulesCache());
  injectProxyHost(allowList);

  // Prefer public interfaces for WebRTC so local IPs are not leaked.
  try {
    if (typeof view.webContents.session.setWebRTCIPHandlingPolicy === 'function') {
      view.webContents.session.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    }
  } catch (e) {
    log.debug('WebRTC IP policy unavailable:', e.message);
  }

  security.attachTabGuards(view.webContents, {
    isAllowed: (hostname) => blocking.isDomainAllowed(hostname, allowList, true),
    onBlocked: ({ url: _url, hostname, kind }) => {
      log.info(`Blocked ${kind} to ${hostname} in tab ${tab.id}`);
      send(IPC.TAB_BLOCKED, { tabId: tab.id, hostname, kind });
    },
    onOpenNewTab: (url) => openInNewTab(tab.serviceId, url),
    onOpenExternal: (url) => {
      security.openExternal(url, { parent: mainWindow }).catch(() => {});
    }
  });

  const contents = view.webContents;

  // Anti-bot hardening: main-world patch ahead of page scripts. Failure is
  // non-fatal (DevTools owns the debugger, or CDP is unavailable) — the tab
  // still works, just without the mask.
  stealth.applyToWebContents(contents).catch(() => {});

  // Login detection: cookie + URL + selector evidence, per service.
  loginMonitor.observe(contents, tab.serviceId);

  contents.on('did-start-loading', () => {
    tabs.update(tab.id, { loading: true });
    notifyTabState(tabs.get(tab.id));
  });

  contents.on('did-stop-loading', () => {
    tabs.update(tab.id, { loading: false });
    notifyTabState(tabs.get(tab.id));
  });

  const syncNavigation = () => {
    if (contents.isDestroyed()) return;
    const url = contents.getURL();
    tabs.update(tab.id, {
      url,
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward()
    });
    notifyTabState(tab);

    // A bot challenge is waited out with jittered backoff, and it must never be
    // misread as a signed-out session.
    if (url && isLoginChallenge(url)) {
      stealth.handleChallenge(contents, { url, serviceId: tab.serviceId });
    } else {
      stealth.noteChallengeCleared(contents);
    }
  };
  contents.on('did-navigate', syncNavigation);
  contents.on('did-navigate-in-page', syncNavigation);

  contents.on('page-title-updated', (event, title) => {
    if (!title) return;
    tabs.update(tab.id, { title });
    notifyTabState(tabs.get(tab.id));
    refreshTrayMenu();
  });

  contents.on('render-process-gone', (event, details) => {
    log.error(`Tab ${tab.id} crashed (${details && details.reason})`);
    tabs.update(tab.id, { loading: false });
    send(IPC.TAB_STATE, { ...(stateFor(tab.id) || {}), crashed: true, reason: details && details.reason });
  });

  contents.on('destroyed', () => {
    // Covers crashes and view teardown that did not go through closeTab().
    blocking.removeTabDomains(webContentsId);
    if (views.get(tab.id) === view) views.delete(tab.id);
  });

  contents.on('context-menu', () => buildTabContextMenu(tab, contents));

  contents.on('found-in-page', (event, result) => {
    send(IPC.TAB_FIND_RESULT, {
      tabId: tab.id,
      activeMatchOrdinal: result && result.activeMatchOrdinal,
      matches: result && result.matches,
      finalUpdate: result && result.finalUpdate
    });
  });

  ensureChildView(view);
  view.setBounds(calculateViewBounds());
  views.set(tab.id, view);

  // Restore per-tab zoom / mute before navigation so the first paint is correct.
  if (tab.zoomFactor && tab.zoomFactor !== 1) {
    try {
      contents.setZoomFactor(tab.zoomFactor);
    } catch (e) {
      /* ignore */
    }
  }
  if (tab.muted) {
    try {
      contents.setAudioMuted(true);
    } catch (e) {
      /* ignore */
    }
  }

  contents.loadURL(proxyUrlFor(tab.url)).catch((error) => {
    log.error(`Unable to load ${tab.url}:`, error.message);
  });

  return view;
}

function buildTabContextMenu(tab, contents) {
  const template = [
    { role: 'copy' },
    { role: 'cut' },
    { role: 'paste' },
    { role: 'selectAll' },
    { type: 'separator' },
    {
      label: 'Reload',
      click: () => {
        if (!contents.isDestroyed()) contents.reload();
      }
    },
    {
      label: 'Copy page URL',
      click: () => {
        // eslint-disable-next-line global-require
        require('electron').clipboard.writeText(contents.getURL());
      }
    },
    {
      label: 'Open in browser',
      click: () => {
        security.openExternal(contents.getURL(), { parent: mainWindow }).catch(() => {});
      }
    },
    { type: 'separator' },
    {
      label: 'Zoom in',
      click: () => setZoom(tab.id, (tab.zoomFactor || 1) + 0.1)
    },
    {
      label: 'Zoom out',
      click: () => setZoom(tab.id, (tab.zoomFactor || 1) - 0.1)
    },
    {
      label: 'Reset zoom',
      click: () => setZoom(tab.id, 1)
    },
    { type: 'separator' },
    {
      label: tab.muted ? 'Unmute tab' : 'Mute tab',
      click: () => setMuted(tab.id, !tab.muted)
    },
    {
      label: 'Find in page…',
      accelerator: 'CommandOrControl+F',
      click: () => send(IPC.TAB_STATE, { ...(stateFor(tab.id) || {}), requestFind: true })
    }
  ];

  if (!app.isPackaged) {
    template.push({ type: 'separator' });
    template.push({ role: 'toggleDevTools' });
  }

  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function stateFor(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return null;
  return {
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    hibernated: tab.hibernated,
    active: tabs.activeTabId === tab.id,
    zoomFactor: tab.zoomFactor,
    muted: Boolean(tab.muted)
  };
}

/** Open a URL in a fresh tab, reusing the service's allow-list. */
function openInNewTab(serviceId, url) {
  const id = `${serviceId}-${Date.now()}`;
  const result = createTab({ tabId: id, serviceId, url, title: serviceId });
  if (result.success) send(IPC.TAB_CREATED, { tabId: id, serviceId, url, title: serviceId });
  return result;
}

/**
 * Create a tab and its backing view.
 * @returns {{success: boolean, error?: string}}
 */
function createTab({
  tabId,
  serviceId,
  url,
  userAgent = '',
  title = '',
  zoomFactor = 1,
  muted = false
} = {}) {
  if (!mainWindow) return { success: false, error: 'no_window' };

  const added = tabs.add({
    id: tabId,
    serviceId,
    url,
    title: title || serviceId,
    userAgent
  });

  if (!added.ok) {
    log.warn(`Refused to create tab ${tabId}: ${added.error}`);
    return { success: false, error: added.error, limit: tabs.getLimit() };
  }

  // Restore persisted zoom / mute before the view is created so the first
  // paint and audio state match the previous session.
  if (zoomFactor && zoomFactor !== 1) {
    tabs.update(tabId, { zoomFactor: clampFloat(zoomFactor, 0.3, 5, 1) });
  }
  if (muted) tabs.update(tabId, { muted: true });

  const view = createViewForTab(added.tab);
  if (!view) {
    tabs.remove(tabId);
    return { success: false, error: 'view_failed' };
  }

  noteServiceUsage(serviceId);
  activateTab(tabId);
  persistTabsNow();
  refreshTrayMenu();
  return { success: true, tabId };
}

/** Show a tab (reviving it from hibernation when needed). */
function activateTab(tabId) {
  if (!mainWindow) return false;
  const tab = tabs.get(tabId);
  if (!tab) return false;

  const previousId = tabs.activeTabId;
  tabs.activate(tabId);

  if (previousId && previousId !== tabId) {
    const previousView = views.get(previousId);
    if (previousView) {
      previousView.webContents.setBackgroundThrottling(true);
      mainWindow.contentView.removeChildView(previousView);
    }
  }

  let view = views.get(tabId);
  if (tab.hibernated || !view) {
    view = createViewForTab(tab);
    tabs.markHibernated(tabId, false);
  } else {
    view.webContents.setBackgroundThrottling(false);
    ensureChildView(view);
  }

  applyViewBounds();
  configStore.updateConfigItem('lastActiveService', tab.serviceId);
  configStore.updateConfigItem('activeTabId', tabId);
  noteServiceUsage(tab.serviceId);
  notifyTabState(tab);
  refreshTrayMenu();
  return true;
}

/** Alias kept for the IPC surface. */
function switchTab(tabId) {
  return activateTab(tabId);
}

function destroyView(tabId) {
  const view = views.get(tabId);
  if (!view) return;
  views.delete(tabId);
  try {
    blocking.removeTabDomains(view.webContents.id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.contentView.removeChildView(view);
    }
    view.webContents.close();
  } catch (e) {
    log.debug('Error tearing down view:', e.message);
  }
}

function destroyAllViews() {
  for (const tabId of [...views.keys()]) destroyView(tabId);
  views.clear();
}

/** Close a tab; returns the id of the tab that became active (or null). */
function closeTab(tabId) {
  const existed = tabs.has(tabId);
  destroyView(tabId);
  const removed = tabs.remove(tabId);
  if (!removed && !existed) return null;

  const nextId = tabs.activeTabId;
  if (nextId) {
    activateTab(nextId);
  } else {
    send(IPC.TABS_EMPTIED, {});
  }

  persistTabsNow();
  refreshTrayMenu();
  send(IPC.TAB_CLOSED, { tabId, nextActiveId: nextId });
  return nextId;
}

function closeOtherTabs(tabId) {
  for (const id of tabs.others(tabId)) closeTab(id);
  return tabs.list().map((tab) => tab.id);
}

function reorderTabs(ids) {
  const order = tabs.reorder(ids);
  persistTabsNow();
  return order;
}

// -- Navigation --------------------------------------------------------------

/**
 * Run `fn` against a live tab webContents.
 * Returns the function result, or `fallback` when the view is missing/destroyed.
 */
function withContents(tabId, fn, fallback = false) {
  const view = views.get(tabId);
  if (!view || view.webContents.isDestroyed()) return fallback;
  try {
    return fn(view.webContents);
  } catch (e) {
    log.debug('Navigation action failed:', e.message);
    return fallback;
  }
}

function navGoBack(tabId) {
  return Boolean(withContents(tabId, (contents) => contents.canGoBack() && (contents.goBack(), true)));
}

function navGoForward(tabId) {
  return Boolean(withContents(tabId, (contents) => contents.canGoForward() && (contents.goForward(), true)));
}

function navReload(tabId) {
  const tab = tabs.get(tabId);
  if (tab && tab.hibernated) return activateTab(tabId);
  return Boolean(withContents(tabId, (contents) => (contents.reload(), true)));
}

function setZoom(tabId, factor) {
  const clamped = clampFloat(factor, 0.3, 5, 1);
  tabs.update(tabId, { zoomFactor: clamped });
  withContents(tabId, (contents) => contents.setZoomFactor(clamped));
  notifyTabState(tabs.get(tabId));
  schedulePersist();
  return clamped;
}

function setMuted(tabId, muted) {
  const value = Boolean(muted);
  tabs.update(tabId, { muted: value });
  withContents(tabId, (contents) => contents.setAudioMuted(value));
  notifyTabState(tabs.get(tabId));
  schedulePersist();
  return value;
}

/**
 * Find text in the active tab's page.
 * @returns {{requestId?: number, matches?: number}|{matches: 0}}
 */
function findInPage(tabId, text, options = {}) {
  if (!text) {
    stopFindInPage(tabId);
    return { matches: 0 };
  }
  return withContents(
    tabId,
    (contents) => {
      const requestId = contents.findInPage(text, {
        forward: options.forward !== false,
        findNext: Boolean(options.findNext),
        matchCase: Boolean(options.matchCase)
      });
      return { requestId };
    },
    { matches: 0 }
  );
}

function stopFindInPage(tabId) {
  return Boolean(
    withContents(tabId, (contents) => {
      contents.stopFindInPage('clearSelection');
      return true;
    })
  );
}

function openDevTools(tabId) {
  return Boolean(withContents(tabId, (contents) => (contents.openDevTools({ mode: 'detach' }), true)));
}

// -- Hibernation -------------------------------------------------------------

function startHibernationSweep() {
  if (hibernationTimer) return;
  hibernationTimer = setInterval(() => {
    try {
      hibernateIdleTabs();
    } catch (e) {
      log.error('Hibernation sweep failed:', e.message);
    }
  }, HIBERNATION.SWEEP_INTERVAL_MS);
  if (typeof hibernationTimer.unref === 'function') hibernationTimer.unref();
}

function stopHibernationSweep() {
  if (hibernationTimer) {
    clearInterval(hibernationTimer);
    hibernationTimer = null;
  }
}

/**
 * Tear down the renderer process of tabs that have been idle for a while.
 * The tab record (url, title, history position) survives; switching back
 * recreates the view on demand.
 *
 * @returns {string[]} ids that were hibernated
 */
function hibernateIdleTabs() {
  const config = configStore.getConfig();
  if (config.hibernateTabs === false) return [];

  const idleMs = clampNumber(
    (config.hibernateAfterMinutes || 15) * 60 * 1000,
    HIBERNATION.MIN_IDLE_MS,
    HIBERNATION.MAX_IDLE_MS,
    HIBERNATION.DEFAULT_IDLE_MS
  );

  const hibernated = [];
  for (const tab of tabs.hibernationCandidates(Date.now(), idleMs)) {
    destroyView(tab.id);
    tabs.markHibernated(tab.id, true);
    notifyTabState(tabs.get(tab.id));
    hibernated.push(tab.id);
  }

  if (hibernated.length > 0) {
    log.info(`Hibernated ${hibernated.length} idle tab(s): ${hibernated.join(', ')}`);
  }
  return hibernated;
}

// -- Session restore ---------------------------------------------------------

/** Rebuild the tab strip from persisted records. */
function restoreTabs(records) {
  if (!Array.isArray(records) || records.length === 0) return { restored: 0 };

  const services = dataStore.getServicesCache();
  const knownIds = new Set((services && services.ai_services ? services.ai_services : []).map((s) => s.id));
  let restored = 0;

  for (const record of records.slice(0, LIMITS.MAX_TABS)) {
    const serviceId = record.serviceId || record.id;
    if (knownIds.size > 0 && !knownIds.has(serviceId)) {
      log.warn(`Skipping unknown service during restore: ${serviceId}`);
      continue;
    }
    const result = createTab({
      tabId: record.id,
      serviceId,
      url: record.url,
      title: record.title || serviceId,
      zoomFactor: record.zoomFactor || 1,
      muted: Boolean(record.muted)
    });
    if (result.success) restored += 1;
  }

  return { restored };
}

// ---------------------------------------------------------------------------
// Lifecycle helpers
// ---------------------------------------------------------------------------

function shutdown() {
  stopHibernationSweep();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistTabsNow();
  unregisterGlobalShortcuts();
  destroyAllViews();
  destroyTray();
}

function getTabStates() {
  return tabs.list().map((tab) => stateFor(tab.id));
}

/** Apply a new concurrent-tab limit from the settings UI. */
function setTabLimit(limit) {
  return tabs.setLimit(limit);
}

// ---------------------------------------------------------------------------
// Session / login helpers
// ---------------------------------------------------------------------------

/** The live tab for a service, if any. */
function tabIdForService(serviceId) {
  return (tabs.list().find((tab) => tab.serviceId === serviceId) || {}).id || null;
}

/**
 * Take the user to a service's sign-in page.
 *
 * Reuses the tab when it is open (and revives it from hibernation) so a stale
 * session is refreshed in place instead of eating a tab slot; otherwise opens a
 * new tab, which the tab limit may still refuse — that is reported, not hidden.
 *
 * @param {{serviceId: string, url: string}} request
 */
function reloginService({ serviceId, url }) {
  if (!serviceId || !url) return { ok: false, error: 'invalid_request' };

  const tabId = tabIdForService(serviceId);
  const tab = tabId ? tabs.get(tabId) : null;

  if (tab) {
    // Hibernated tabs have no view: wake it first, then navigate.
    if (tab.hibernated || !views.has(tabId)) activateTab(tabId);
    const view = views.get(tabId);
    if (view && !view.webContents.isDestroyed()) {
      try {
        view.webContents.loadURL(url);
        notifyTabState(tabs.get(tabId));
        return { ok: true, tabId, reused: true };
      } catch (error) {
        log.warn(`Unable to navigate ${tabId} to its sign-in page: ${error.message}`);
        return { ok: false, error: 'navigation-failed' };
      }
    }
  }

  const freshId = `${serviceId}-relogin-${Date.now().toString(36)}`;
  const created = createTab({ tabId: freshId, serviceId, url, title: `${serviceId} — sign in` });
  if (created.success) send(IPC.TAB_CREATED, { tabId: freshId, serviceId, url, title: 'Sign in' });
  return { ok: created.success, tabId: created.success ? freshId : null, reused: false, error: created.error };
}

/** Reload every live tab of a service (used after a cookie restore). */
function reloadService(serviceId) {
  const affected = tabs.list().filter((tab) => tab.serviceId === serviceId);
  for (const tab of affected) navReload(tab.id);
  return affected.length;
}

/** Service ids that currently have a tab. */
function openServiceIds() {
  return [...new Set(tabs.list().map((tab) => tab.serviceId))];
}

module.exports = {
  createMainWindow,
  getMainWindow,
  showMainWindow,
  toggleMainWindow,
  setQuitting,
  setupTray,
  refreshTrayMenu,
  setupGlobalShortcuts,
  registerGlobalShortcut,
  unregisterGlobalShortcuts,
  createTab,
  activateTab,
  switchTab,
  closeTab,
  closeOtherTabs,
  reorderTabs,
  navGoBack,
  navGoForward,
  navReload,
  setZoom,
  setMuted,
  findInPage,
  stopFindInPage,
  openDevTools,
  setViewBounds,
  applyViewBounds,
  hibernateIdleTabs,
  restoreTabs,
  getTabStates,
  setTabLimit,
  reloginService,
  reloadService,
  tabIdForService,
  openServiceIds,
  noteServiceUsage,
  shutdown,
  // exposed for tests / status reporting
  _tabs: tabs,
  _views: views
};
