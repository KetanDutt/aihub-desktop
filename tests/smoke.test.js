/**
 * Require every main-process module under an Electron stub so a bad import,
 * missing export or dangling IPC constant is caught at CI time, not at launch.
 */

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getName: () => 'aihub-desktop',
    getVersion: () => '0.0.0',
    getPath: () => require('os').tmpdir(),
    on: jest.fn(),
    // Never resolves, so `bootstrap` is not executed during the smoke test.
    whenReady: () => ({ then: jest.fn().mockReturnThis(), catch: jest.fn() }),
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: jest.fn(),
    setLoginItemSettings: jest.fn(),
    quit: jest.fn()
  },
  session: { defaultSession: { webRequest: { onBeforeRequest: jest.fn(), onBeforeSendHeaders: jest.fn() } }, fromPartition: jest.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (t) => Buffer.from(t), decryptString: (b) => b.toString() },
  dialog: { showErrorBox: jest.fn(), showMessageBox: jest.fn(), showMessageBoxSync: jest.fn() },
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  shell: { openExternal: jest.fn() },
  clipboard: { writeText: jest.fn() },
  Notification: { isSupported: () => false },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
  globalShortcut: { register: jest.fn(), unregister: jest.fn(), unregisterAll: jest.fn() },
  Menu: { buildFromTemplate: () => ({}) },
  Tray: jest.fn().mockImplementation(() => ({
    setToolTip: jest.fn(),
    setContextMenu: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn()
  })),
  BrowserWindow: jest.fn(),
  WebContentsView: jest.fn(),
  webContents: { getAllWebContents: () => [] }
}), { virtual: true });

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  transports: { console: { level: false }, file: { level: 'info', maxSize: 0 } },
  catchErrors: jest.fn()
}), { virtual: true });

jest.mock('electron-store', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    store: {}
  }))
}), { virtual: true });

describe('module graph', () => {
  it('every main-process module loads and exposes its API', () => {
    const constants = require('../src/constants');
    expect(constants.IPC.CREATE_TAB).toBe('create-tab');

    const blocking = require('../src/blocking');
    expect(typeof blocking.setupWebRequestBlocking).toBe('function');

    const config = require('../src/config');
    expect(typeof config.saveConfig).toBe('function');

    const data = require('../src/data');
    expect(typeof data.updateRemoteData).toBe('function');

    const tabs = require('../src/tabs');
    expect(typeof tabs.TabManager).toBe('function');

    const security = require('../src/security');
    expect(typeof security.hardenSession).toBe('function');

    const favicon = require('../src/favicon');
    expect(typeof favicon.getFavicon).toBe('function');

    const catalog = require('../src/catalog');
    expect(typeof catalog.detailsFor).toBe('function');

    const updater = require('../src/updater');
    expect(typeof updater.setupAutoUpdater).toBe('function');

    const windowManager = require('../src/window');
    for (const fn of [
      'createTab',
      'switchTab',
      'closeTab',
      'reorderTabs',
      'setViewBounds',
      'navGoBack',
      'navGoForward',
      'navReload',
      'navReloadHard',
      'navStop',
      'navHome',
      'setZoom',
      'setMuted',
      'findInPage',
      'stopFindInPage'
    ]) {
      expect(typeof windowManager[fn]).toBe('function');
    }

    const ipc = require('../src/ipc');
    expect(typeof ipc.setupIpcHandlers).toBe('function');

    for (const [_name, mod] of [
      ['cookies', require('../src/cookies')],
      ['loginstate', require('../src/loginstate')],
      ['fingerprint', require('../src/fingerprint')],
      ['stealth', require('../src/stealth')],
      ['sessionstore', require('../src/sessionstore')],
      ['logins', require('../src/logins')]
    ]) {
      expect(mod).toBeDefined();
      expect(typeof mod).toBe('object');
    }

    const apiOpenai = require('../src/api/openai');
    const apiServer = require('../src/api/server');
    const apiAdapters = require('../src/api/adapters');
    const apiQueue = require('../src/api/queue');
    const apiHttp = require('../src/api/http');
    const apiTemplate = require('../src/api/template');
    expect(typeof apiOpenai.normalizeChatRequest).toBe('function');
    expect(typeof apiServer.createApiServer).toBe('function');
    expect(typeof apiAdapters.loadAdapters).toBe('function');
    expect(typeof apiQueue.createQueue).toBe('function');
    expect(typeof apiHttp.sendRequest).toBe('function');
    expect(typeof apiTemplate.renderTemplate).toBe('function');
    expect(typeof require('../src/api/engine').complete).toBe('function');
    expect(typeof require('../src/api').setup).toBe('function');

    const main = require('../main');
    expect(typeof main.validateServiceId).toBe('function');
  });

  it('IPC channel constants are unique', () => {
    const { IPC } = require('../src/constants');
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });

  it('setupIpcHandlers registers every declared channel exactly once', () => {
    const electron = require('electron');
    const ipc = require('../src/ipc');
    ipc.setupIpcHandlers();

    const handled = electron.ipcMain.handle.mock.calls.map((c) => c[0]);
    const listened = electron.ipcMain.on.mock.calls.map((c) => c[0]);
    const all = [...handled, ...listened];

    expect(all.length).toBe(new Set(all).size); // no duplicate registration
    expect(all).toContain('create-tab');
    expect(all).toContain('get-config');
    expect(all).toContain('set-zoom');
    expect(all).toContain('set-muted');
    expect(all).toContain('find-in-page');
    expect(all).toContain('stop-find-in-page');
  });

  it('registers the session, login and local API channels', () => {
    const electron = require('electron');
    const ipc = require('../src/ipc');
    const logins = require('../src/logins');
    const api = require('../src/api');

    ipc.setupIpcHandlers();
    logins.setup({});
    api.setup({});

    const handled = electron.ipcMain.handle.mock.calls.map((call) => call[0]);
    const listened = electron.ipcMain.on.mock.calls.map((call) => call[0]);
    const all = [...handled, ...listened];
    for (const channel of [
      'get-login-states',
      'relogin-service',
      'touch-session',
      'get-session-stats',
      'clear-service-data',
      'get-api-status',
      'rotate-api-token',
      'api-ping'
    ]) {
      expect(handled).toContain(channel);
    }

    // No channel may be registered twice across modules (Electron throws on a
    // duplicate handler, which would take the whole app down at boot).
    expect(all.length).toBe(new Set(all).size);

    // Every IPC constant the renderer can reach must have a registration.
    const { IPC } = require('../src/constants');
    const registered = new Set(all);
    const rendererFacing = [
      IPC.GET_CONFIG, IPC.SAVE_CONFIG, IPC.GET_SERVICES, IPC.GET_RULES, IPC.UPDATE_REMOTE_DATA,
      IPC.TOGGLE_SERVICE, IPC.GET_FAVICON, IPC.GET_APP_INFO, IPC.OPEN_EXTERNAL, IPC.CLEAR_SESSION_DATA,
      IPC.CREATE_TAB, IPC.SWITCH_TAB, IPC.CLOSE_TAB, IPC.CLOSE_OTHER_TABS, IPC.REORDER_TABS,
      IPC.GET_TAB_STATES, IPC.HIBERNATE_TABS, IPC.GET_LIMITS, IPC.SET_ACTIVE_SERVICE, IPC.SET_VIEW_BOUNDS,
      IPC.NAV_GO_BACK, IPC.NAV_GO_FORWARD, IPC.NAV_RELOAD, IPC.SET_ZOOM, IPC.SET_MUTED, IPC.FIND_IN_PAGE,
      IPC.STOP_FIND_IN_PAGE, IPC.OPEN_TAB_DEVTOOLS, IPC.CHECK_FOR_UPDATES, IPC.GET_UPDATE_STATUS,
      IPC.QUIT_AND_INSTALL, IPC.GET_BLOCKING_STATS, IPC.MINIMIZE_WINDOW, IPC.MAXIMIZE_WINDOW,
      IPC.CLOSE_WINDOW, IPC.QUIT_APP, IPC.GET_LOGIN_STATES, IPC.GET_SESSION_STATS, IPC.RELOGIN_SERVICE,
      IPC.CLEAR_SERVICE_DATA, IPC.TOUCH_SESSION, IPC.GET_API_STATUS, IPC.ROTATE_API_TOKEN, IPC.API_PING
    ];
    for (const channel of rendererFacing) expect(registered).toContain(channel);
  });
});
