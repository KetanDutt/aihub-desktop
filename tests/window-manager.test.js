/**
 * Window / tab-host integration tests.
 *
 * `src/window.js` is the module every tab actually lives in, and until now it
 * had almost no coverage because it needs a full Electron surface. The stub
 * below provides just enough of `BrowserWindow`, `WebContentsView`, `Tray`,
 * `Menu` and `screen` to drive it: creating tabs, switching, closing,
 * hibernating, reporting bounds and forwarding shortcuts.
 */

jest.mock('electron', () => {
  // `events` is a built-in, so it may be required inside the factory.
  const { EventEmitter } = require('events');

  class FakeWebContents extends EventEmitter {
    constructor(id) {
      super();
      this.id = id;
      this.session = {
        setWebRTCIPHandlingPolicy: jest.fn(),
        webRequest: { onBeforeRequest: jest.fn() }
      };
      this.navigationHistory = {
        canGoBack: () => false,
        canGoForward: () => false,
        goBack: jest.fn(),
        goForward: jest.fn()
      };
      this.loadURL = jest.fn().mockResolvedValue(undefined);
      this.reload = jest.fn();
      this.reloadIgnoringCache = jest.fn();
      this.stop = jest.fn();
      this.close = jest.fn();
      this.setZoomFactor = jest.fn();
      this.setAudioMuted = jest.fn();
      this.setBackgroundThrottling = jest.fn();
      this.isDestroyed = jest.fn(() => false);
      this.getURL = jest.fn(() => '');
      this.send = jest.fn();
      this.openDevTools = jest.fn();
      this.findInPage = jest.fn(() => 1);
      this.stopFindInPage = jest.fn();
    }
  }

  const contents = [];
  let nextId = 100;

  class WebContentsView {
    constructor() {
      this.webContents = new FakeWebContents((nextId += 1));
      contents.push(this.webContents);
      this.setBounds = jest.fn();
    }
  }

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents((nextId += 1));
      this.children = [];
      this.visible = false;
      this.minimized = false;
      this.maximized = false;
      this.size = [options.width || 1200, options.height || 800];
      this.bounds = {
        x: options.x || 0,
        y: options.y || 0,
        width: options.width || 1200,
        height: options.height || 800
      };
      this.contentView = {
        children: this.children,
        addChildView: (view) => this.children.push(view),
        removeChildView: (view) => {
          const index = this.children.indexOf(view);
          if (index > -1) this.children.splice(index, 1);
        }
      };
      BrowserWindow.instances.push(this);
    }

    loadFile = jest.fn().mockResolvedValue(undefined);
    setIcon = jest.fn();
    show = jest.fn(() => {
      this.visible = true;
    });
    hide = jest.fn(() => {
      this.visible = false;
    });
    focus = jest.fn();
    restore = jest.fn(() => {
      this.minimized = false;
    });
    maximize = jest.fn(() => {
      this.maximized = true;
    });
    unmaximize = jest.fn(() => {
      this.maximized = false;
    });
    isMaximized = jest.fn(() => this.maximized);
    isMinimized = jest.fn(() => this.minimized);
    isVisible = jest.fn(() => this.visible);
    isFocused = jest.fn(() => this.visible);
    getContentSize = jest.fn(() => this.size);
    getBounds = jest.fn(() => this.bounds);
    getNormalBounds = jest.fn(() => this.bounds);
    setBounds = jest.fn();
    isDestroyed = jest.fn(() => false);
    close = jest.fn();
  }
  BrowserWindow.instances = [];
  BrowserWindow.last = () => BrowserWindow.instances[BrowserWindow.instances.length - 1];

  const tray = {
    setToolTip: jest.fn(),
    setContextMenu: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn()
  };

  return {
    app: {
      isPackaged: false,
      getName: () => 'aihub-desktop',
      getVersion: () => '0.0.0',
      getPath: () => require('os').tmpdir(),
      on: jest.fn(),
      setAsDefaultProtocolClient: jest.fn(),
      setLoginItemSettings: jest.fn(),
      quit: jest.fn(),
      dock: { hide: jest.fn() }
    },
    BrowserWindow,
    WebContentsView,
    Tray: jest.fn(() => tray),
    Menu: { buildFromTemplate: jest.fn(() => ({ popup: jest.fn() })) },
    globalShortcut: { register: jest.fn(() => true), unregister: jest.fn() },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, getSize: () => ({ width: 16 }) }),
      createEmpty: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })
    },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }] },
    clipboard: { writeText: jest.fn() },
    session: { defaultSession: { webRequest: { onBeforeRequest: jest.fn() } } },
    __tray: tray,
    __contents: contents,
    __BrowserWindow: BrowserWindow
  };
}, { virtual: true });

const electron = require('electron');

jest.mock('../src/config', () => ({
  getConfig: jest.fn(() => ({
    maxActiveServices: 3,
    darkMode: true,
    minimizeToTray: true,
    globalShortcut: 'CommandOrControl+Shift+A',
    lastActiveService: null,
    hibernateTabs: true,
    hibernateAfterMinutes: 15
  })),
  getConfigItem: jest.fn((key, fallback) => {
    const values = {
      windowBounds: null,
      windowMaximized: false,
      maxActiveServices: 3
    };
    return key in values ? values[key] : fallback;
  }),
  updateConfigItem: jest.fn()
}));

jest.mock('../src/data', () => ({
  getRulesCache: jest.fn(() => ({ service_domains: { chatgpt: ['openai.com'] } })),
  getServicesCache: jest.fn(() => ({ ai_services: [{ id: 'chatgpt' }] }))
}));

jest.mock('../src/blocking', () => ({
  updateTabDomains: jest.fn(() => new Set(['openai.com'])),
  removeTabDomains: jest.fn(),
  registerTrustedWebContents: jest.fn(),
  isDomainAllowed: jest.fn(() => true)
}));

jest.mock('../src/security', () => ({
  installShellGuards: jest.fn(),
  attachTabGuards: jest.fn(),
  openExternal: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/stealth', () => ({
  applyToSession: jest.fn(),
  applyToWebContents: jest.fn().mockResolvedValue(undefined),
  handleChallenge: jest.fn(),
  noteChallengeCleared: jest.fn()
}));

jest.mock('../src/sessionstore', () => ({ partitionFor: jest.fn(() => null) }));

jest.mock('../src/logins', () => ({ observe: jest.fn() }));

jest.mock('../src/catalog', () => ({ detailsFor: jest.fn(() => ({ homepage: 'https://chatgpt.com/' })) }));

const configStore = require('../src/config');
const security = require('../src/security');
const windowManager = require('../src/window');
const { LAYOUT } = require('../src/constants');

function resetTabs() {
  const tabs = windowManager._tabs;
  tabs.tabs.clear();
  tabs.order = [];
  tabs.activeTabId = null;
  tabs.setLimit(3);
  windowManager._views.clear();
}

beforeEach(() => {
  jest.clearAllMocks();
  resetTabs();
  electron.__BrowserWindow.instances.length = 0;
  windowManager.createMainWindow();
});

describe('window creation', () => {
  it('opens at the default size when nothing is saved', () => {
    const win = windowManager.getMainWindow();
    expect(win.options.width).toBe(LAYOUT.DEFAULT_WIDTH);
    expect(win.options.height).toBe(LAYOUT.DEFAULT_HEIGHT);
    expect(win.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });
  });

  it('restores a saved position that is still on screen', () => {
    windowManager.shutdown();
    electron.__BrowserWindow.instances.length = 0;
    configStore.getConfigItem.mockImplementation((key, fallback) => {
      if (key === 'windowBounds') return { x: 120, y: 90, width: 1000, height: 700 };
      if (key === 'windowMaximized') return false;
      return fallback;
    });

    windowManager.createMainWindow();
    const win = windowManager.getMainWindow();
    expect(win.options).toMatchObject({ x: 120, y: 90, width: 1000, height: 700 });

    configStore.getConfigItem.mockImplementation((key, fallback) =>
      key === 'windowBounds' ? null : fallback
    );
  });

  it('ignores a saved position on a display that no longer exists', () => {
    windowManager.shutdown();
    electron.__BrowserWindow.instances.length = 0;
    configStore.getConfigItem.mockImplementation((key, fallback) => {
      if (key === 'windowBounds') return { x: 9000, y: 4000, width: 1000, height: 700 };
      if (key === 'windowMaximized') return false;
      return fallback;
    });

    windowManager.createMainWindow();
    expect(windowManager.getMainWindow().options.width).toBe(LAYOUT.DEFAULT_WIDTH);

    configStore.getConfigItem.mockImplementation((key, fallback) =>
      key === 'windowBounds' ? null : fallback
    );
  });

  it('treats the shell as trusted so the UI is never domain-filtered', () => {
    const win = windowManager.getMainWindow();
    win.webContents.emit('did-finish-load');
    expect(require('../src/blocking').registerTrustedWebContents).toHaveBeenCalledWith(win.webContents.id);
  });
});

describe('tabs', () => {
  const tabPayload = (overrides = {}) => ({
    tabId: 'chatgpt-1',
    serviceId: 'chatgpt',
    url: 'https://chatgpt.com/',
    title: 'ChatGPT',
    ...overrides
  });

  it('creates a view, registers its allow-list and navigates', () => {
    const result = windowManager.createTab(tabPayload());
    expect(result).toMatchObject({ success: true, tabId: 'chatgpt-1' });

    const view = windowManager._views.get('chatgpt-1');
    expect(view).toBeDefined();
    expect(require('../src/blocking').updateTabDomains).toHaveBeenCalledWith(view.webContents.id, 'chatgpt', expect.anything());
    expect(security.attachTabGuards).toHaveBeenCalled();
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://chatgpt.com/');
  });

  it('refuses a duplicate id and respects the tab limit', () => {
    expect(windowManager.createTab(tabPayload()).success).toBe(true);
    expect(windowManager.createTab(tabPayload())).toMatchObject({ success: false, error: 'duplicate' });

    windowManager.createTab(tabPayload({ tabId: 'chatgpt-2' }));
    windowManager.createTab(tabPayload({ tabId: 'chatgpt-3' }));
    expect(windowManager.createTab(tabPayload({ tabId: 'chatgpt-4' }))).toMatchObject({
      success: false,
      error: 'limit_reached'
    });
  });

  it('reports bounds that stay inside the window', () => {
    windowManager.createTab(tabPayload());
    windowManager.setViewBounds({ x: -50, y: 10, width: 99_999, height: 99_999 });

    const view = windowManager._views.get('chatgpt-1');
    const bounds = view.setBounds.mock.calls[view.setBounds.mock.calls.length - 1][0];
    const [width, height] = windowManager.getMainWindow().getContentSize();
    expect(bounds.x).toBe(0);
    expect(bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.height).toBeLessThanOrEqual(height);
  });

  it('falls back to the shell stage, not the whole window, before the renderer reports', () => {
    // Used for the first frames only, but the view paints *above* the shell: a
    // fallback that ignored the shell padding would cover the nav bar until the
    // renderer's report lands. The numbers mirror ui/styles.css (--shell-pad,
    // --nav-height, --shell-gap, --status-height).
    jest.isolateModules(() => {
      const fresh = require('../src/window');
      fresh.createMainWindow();
      fresh.createTab(tabPayload());

      const view = fresh._views.get('chatgpt-1');
      const bounds = view.setBounds.mock.calls[0][0];
      const [width, height] = fresh.getMainWindow().getContentSize();
      const pad = LAYOUT.SHELL_PAD;
      const top = pad + LAYOUT.NAV_HEIGHT + LAYOUT.SHELL_GAP;

      expect(bounds).toEqual({
        x: pad,
        y: top,
        width: width - pad * 2,
        height: height - top - (LAYOUT.STATUS_BAR_HEIGHT + pad + LAYOUT.SHELL_GAP)
      });
      expect(bounds.y).toBeGreaterThan(LAYOUT.HEADER_HEIGHT + LAYOUT.TABS_HEIGHT);
    });
  });

  it('accepts a collapsed container so a view can be hidden by layout', () => {
    // The renderer reports the real box of #webviews-container. On a narrow
    // window the service picker takes the whole row and that box collapses to
    // zero: the view must follow it to nothing rather than keep painting over
    // the shell (native views always sit above the renderer).
    windowManager.createTab(tabPayload());
    windowManager.setViewBounds({ x: 0, y: 0, width: 0, height: 0 });

    const view = windowManager._views.get('chatgpt-1');
    const bounds = view.setBounds.mock.calls[view.setBounds.mock.calls.length - 1][0];
    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('switches tabs, throttling the tab that goes to the background', () => {
    windowManager.createTab(tabPayload());
    windowManager.createTab(tabPayload({ tabId: 'chatgpt-2', url: 'https://chatgpt.com/c/2' }));

    const second = windowManager._views.get('chatgpt-2');
    windowManager.switchTab('chatgpt-1');

    expect(windowManager._tabs.activeTabId).toBe('chatgpt-1');
    expect(second.webContents.setBackgroundThrottling).toHaveBeenCalledWith(true);
    expect(windowManager._views.get('chatgpt-1').webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
  });

  it('closes a tab, tears its view down and activates a neighbour', () => {
    windowManager.createTab(tabPayload());
    windowManager.createTab(tabPayload({ tabId: 'chatgpt-2' }));

    const closedView = windowManager._views.get('chatgpt-2');
    const next = windowManager.closeTab('chatgpt-2');

    expect(windowManager._tabs.has('chatgpt-2')).toBe(false);
    expect(closedView.webContents.close).toHaveBeenCalled();
    expect(require('../src/blocking').removeTabDomains).toHaveBeenCalled();
    expect(next).toBe('chatgpt-1');
  });

  it('persists nothing extra when a tab is only re-highlighted', () => {
    windowManager.createTab(tabPayload());
    windowManager.createTab(tabPayload({ tabId: 'chatgpt-2' }));
    configStore.updateConfigItem.mockClear();

    // Same active tab, same records: the serialized payload is unchanged.
    windowManager.switchTab('chatgpt-2');
    expect(configStore.updateConfigItem).not.toHaveBeenCalledWith('openTabs', expect.anything());
  });

  it('reorders tabs and ignores unknown ids', () => {
    windowManager.createTab(tabPayload());
    windowManager.createTab(tabPayload({ tabId: 'chatgpt-2' }));
    expect(windowManager.reorderTabs(['chatgpt-2', 'ghost', 'chatgpt-1'])).toEqual(['chatgpt-2', 'chatgpt-1']);
  });

  it('hibernates an idle background tab and revives it on demand', () => {
    windowManager.createTab(tabPayload());
    windowManager.createTab(tabPayload({ tabId: 'chatgpt-2' }));

    // Age the background tab beyond the idle threshold.
    const stale = windowManager._tabs.get('chatgpt-1');
    stale.lastActiveAt = Date.now() - 60 * 60 * 1000;

    const hibernated = windowManager.hibernateIdleTabs();
    expect(hibernated).toEqual(['chatgpt-1']);
    expect(windowManager._views.has('chatgpt-1')).toBe(false);
    expect(windowManager._tabs.get('chatgpt-1').hibernated).toBe(true);

    windowManager.switchTab('chatgpt-1');
    expect(windowManager._views.has('chatgpt-1')).toBe(true);
    expect(windowManager._tabs.get('chatgpt-1').hibernated).toBe(false);
  });
});

describe('app shortcut forwarding', () => {
  const tabPayload = { tabId: 'chatgpt-1', serviceId: 'chatgpt', url: 'https://chatgpt.com/' };

  function input(key, modifiers = {}) {
    return {
      type: 'keyDown',
      key,
      control: Boolean(modifiers.ctrl),
      meta: Boolean(modifiers.meta),
      alt: Boolean(modifiers.alt),
      shift: Boolean(modifiers.shift),
      isComposing: false
    };
  }

  it('cancels a recognised accelerator and replays it in the shell', () => {
    windowManager.createTab(tabPayload);
    const contents = windowManager._views.get('chatgpt-1').webContents;
    const event = { preventDefault: jest.fn() };

    contents.emit('before-input-event', event, input('w', { ctrl: true }));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(windowManager.getMainWindow().webContents.send).toHaveBeenCalledWith('app-command', 'close-tab');
  });

  it('leaves everything the site owns alone', () => {
    windowManager.createTab(tabPayload);
    const contents = windowManager._views.get('chatgpt-1').webContents;
    const send = windowManager.getMainWindow().webContents.send;
    send.mockClear();

    for (const [key, mods] of [
      ['a', { ctrl: true }],
      ['Enter', {}],
      ['Escape', {}],
      ['k', { ctrl: true }]
    ]) {
      const event = { preventDefault: jest.fn() };
      contents.emit('before-input-event', event, input(key, mods));
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe('window geometry', () => {
  it('persists the normal bounds after a move or resize', () => {
    jest.useFakeTimers();
    try {
      const win = windowManager.getMainWindow();
      win.bounds = { x: 40, y: 60, width: 1100, height: 700 };
      win.emit('resize');
      jest.advanceTimersByTime(600);

      expect(configStore.updateConfigItem).toHaveBeenCalledWith('windowBounds', {
        x: 40,
        y: 60,
        width: 1100,
        height: 700
      });
      expect(configStore.updateConfigItem).toHaveBeenCalledWith('windowMaximized', false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips the write when the geometry did not change', () => {
    jest.useFakeTimers();
    try {
      const win = windowManager.getMainWindow();
      win.bounds = { x: 40, y: 60, width: 1100, height: 700 };

      win.emit('resize');
      jest.advanceTimersByTime(600);
      configStore.updateConfigItem.mockClear();

      win.emit('move');
      jest.advanceTimersByTime(600);
      expect(configStore.updateConfigItem).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('records the maximized flag without losing the normal bounds', () => {
    jest.useFakeTimers();
    try {
      const win = windowManager.getMainWindow();
      win.bounds = { x: 40, y: 60, width: 1100, height: 700 };
      win.maximized = true;

      win.emit('maximize');
      jest.advanceTimersByTime(600);

      expect(configStore.updateConfigItem).toHaveBeenCalledWith('windowMaximized', true);
      expect(configStore.updateConfigItem).not.toHaveBeenCalledWith('windowBounds', expect.anything());
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('shutdown', () => {
  it('stops timers, closes every view and tears the tray down', () => {
    windowManager.createTab({ tabId: 'chatgpt-1', serviceId: 'chatgpt', url: 'https://chatgpt.com/' });
    windowManager.setupTray();
    windowManager.shutdown();

    expect(windowManager._views.size).toBe(0);
    expect(electron.__tray.destroy).toHaveBeenCalled();
    expect(require('../src/stealth').applyToSession).toBeDefined();
  });
});
