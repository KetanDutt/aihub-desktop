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
  session: { defaultSession: { webRequest: { onBeforeRequest: jest.fn() } } },
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

    const updater = require('../src/updater');
    expect(typeof updater.setupAutoUpdater).toBe('function');

    const windowManager = require('../src/window');
    for (const fn of ['createTab', 'switchTab', 'closeTab', 'reorderTabs', 'setViewBounds']) {
      expect(typeof windowManager[fn]).toBe('function');
    }

    const ipc = require('../src/ipc');
    expect(typeof ipc.setupIpcHandlers).toBe('function');

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
  });
});
