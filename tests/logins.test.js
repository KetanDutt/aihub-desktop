/**
 * The login monitor: detection → records → re-login on open → keep-alive.
 *
 * Electron is stubbed; the cookie jar is faked, so this exercises the decision
 * making rather than Chromium.
 */

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

const os = require('os');
const fs = require('fs');
const path = require('path');

const mockDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-logins-'));
process.env.AIHUB_DATA_DIR = mockDataDir;
process.env.AIHUB_BUNDLED_DIR = path.join(__dirname, '..', 'data');

const mockLiveCookies = new Map(); // serviceId -> cookie[]

jest.mock('electron', () => {
  const cookies = {
    get: jest.fn(async (filter = {}) => {
      const serviceId = String(filter.domain || '').split('.')[0];
      return mockLiveCookies.get(serviceId) || [];
    }),
    set: jest.fn(async (cookie) => cookie),
    remove: jest.fn(async () => {}),
    on: jest.fn()
  };

  const fakeSession = {
    id: 'default',
    cookies,
    webRequest: { onBeforeRequest: jest.fn(), onBeforeSendHeaders: jest.fn() },
    setUserAgent: jest.fn(),
    getCacheSize: jest.fn(async () => 0),
    clearCache: jest.fn(async () => {}),
    clearStorageData: jest.fn(async () => {}),
    fetch: jest.fn(async () => ({ status: 200, text: async () => '' }))
  };

  return {
    app: {
      isPackaged: false,
      getPath: () => mockDataDir,
      getLocale: () => 'en-US',
      getName: () => 'aihub-desktop',
      getVersion: () => '0.0.0',
      commandLine: { appendSwitch: jest.fn() },
      on: jest.fn()
    },
    session: { defaultSession: fakeSession, fromPartition: jest.fn(() => ({ ...fakeSession, id: 'partition' })) },
    safeStorage: { isEncryptionAvailable: () => false },
    ipcMain: { handle: jest.fn(), on: jest.fn() },
    dialog: { showMessageBoxSync: jest.fn(() => 1), showMessageBox: jest.fn(async () => ({ response: 1 })) },
    BrowserWindow: jest.fn(),
    WebContentsView: jest.fn(),
    shell: { openExternal: jest.fn() },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    Menu: { buildFromTemplate: () => ({ popup: jest.fn() }) },
    globalShortcut: { register: jest.fn(), unregister: jest.fn() },
    Tray: jest.fn()
  };
});

jest.mock('electron-store', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(function Store() {
    const state = {};
    return {
      get store() {
        return state;
      },
      get: jest.fn((key, fallback) => (key in state ? state[key] : fallback)),
      set: jest.fn((keyOrObject, value) => {
        if (keyOrObject && typeof keyOrObject === 'object') Object.assign(state, keyOrObject);
        else state[keyOrObject] = value;
      }),
      delete: jest.fn()
    };
  })
}), { virtual: true });

jest.mock('../src/data', () => ({
  getServicesCache: () => ({
    schemaVersion: 1,
    serviceCount: 3,
    ai_services: [
      { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', type: 'Conversational AI' },
      { id: 'claude', name: 'Claude', url: 'https://claude.ai/', type: 'Conversational AI' },
      { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', type: 'Conversational AI' }
    ]
  }),
  getRulesCache: () => ({
    service_domains: { chatgpt: ['chatgpt.com', 'openai.com'], claude: ['claude.ai'], gemini: ['google.com'] },
    common_auth_domains: [],
    always_allowed_domains: []
  })
}));

const { IPC } = require('../src/constants');
const loginMonitor = require('../src/logins');

const NOW_SECONDS = Math.floor(Date.now() / 1000);
const sessionCookie = (name = '__Secure-next-auth.session-token') => ({
  name,
  value: 'token',
  domain: '.chatgpt.com',
  path: '/',
  secure: true,
  httpOnly: true,
  expirationDate: NOW_SECONDS + 30 * 86400
});

function contentsFor(url) {
  return {
    id: Math.floor(Math.random() * 100000),
    isDestroyed: () => false,
    getURL: () => url,
    on: jest.fn(),
    once: jest.fn(),
    executeJavaScript: jest.fn(async () => JSON.stringify({ loggedIn: false, signedOut: false }))
  };
}

beforeEach(() => {
  mockLiveCookies.clear();
  loginMonitor._resetForTests();
  // Records survive by design, so a test has to clear the persisted mirror too.
  require('../src/config').updateConfigItem('sessionStates', {});
  jest.clearAllMocks();
});

describe('check()', () => {
  it('records a live session cookie as signed in', async () => {
    mockLiveCookies.set('chatgpt', [sessionCookie()]);
    const record = await loginMonitor.check('chatgpt', { url: 'https://chatgpt.com/c/1', probe: false });
    expect(record.state).toBe('logged-in');
    expect(record.reason).toBe('session-cookie');
    expect(loginMonitor.get('chatgpt').state).toBe('logged-in');
  });

  it('records a login wall as signed out', async () => {
    const record = await loginMonitor.check('claude', { url: 'https://claude.ai/login', probe: false });
    expect(record.state).toBe('logged-out');
  });

  it('labels a challenge page instead of calling it a logout', async () => {
    const record = await loginMonitor.check('gemini', {
      url: 'https://gemini.google.com/cdn-cgi/challenge-platform/h/b/x',
      probe: false
    });
    expect(record.state).toBe('challenge');
  });

  it('broadcasts a state change to the shell', async () => {
    const send = jest.fn();
    loginMonitor.setup({ send });

    mockLiveCookies.set('chatgpt', [sessionCookie()]);
    await loginMonitor.check('chatgpt', { url: 'https://chatgpt.com/', probe: false });

    const payload = send.mock.calls.find((call) => call[0] === IPC.LOGIN_STATE);
    expect(payload).toBeDefined();
    expect(payload[1]).toMatchObject({ serviceId: 'chatgpt', state: 'logged-in', changed: true });
  });
});

describe('observe()', () => {
  it('wires navigation events and schedules a check', () => {
    loginMonitor.setup({});
    const contents = contentsFor('https://chatgpt.com/');
    expect(loginMonitor.observe(contents, 'chatgpt')).toBe(true);
    expect(contents.on).toHaveBeenCalled();
    const events = contents.on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(expect.arrayContaining(['did-navigate', 'did-finish-load', 'destroyed']));
  });
});

describe('reloginOnOpen()', () => {
  it('reopens sign-in only for a session that used to work', async () => {
    const onRelogin = jest.fn();
    loginMonitor.setup({ onRelogin });

    // ChatGPT was signed in last session, and the jar is now empty.
    loginMonitor._records.set('chatgpt', { serviceId: 'chatgpt', state: 'logged-in', reason: 'session-cookie' });
    // Claude was never signed in: nothing to restore.
    loginMonitor._records.set('claude', { serviceId: 'claude', state: 'logged-out', reason: 'no-signal' });

    const result = await loginMonitor.reloginOnOpen(['chatgpt', 'claude']);
    expect(result.attempted).toEqual(['chatgpt']);
    expect(onRelogin).toHaveBeenCalledTimes(1);
    expect(onRelogin.mock.calls[0][0]).toMatchObject({
      serviceId: 'chatgpt',
      url: 'https://chatgpt.com/auth/login',
      reason: 'expired-on-launch'
    });
  });

  it('does not nag when the session is still good', async () => {
    const onRelogin = jest.fn();
    loginMonitor.setup({ onRelogin });
    mockLiveCookies.set('chatgpt', [sessionCookie()]);
    loginMonitor._records.set('chatgpt', { serviceId: 'chatgpt', state: 'logged-in', reason: 'session-cookie' });

    const result = await loginMonitor.reloginOnOpen(['chatgpt']);
    expect(result.attempted).toEqual([]);
    expect(onRelogin).not.toHaveBeenCalled();
  });

  it('honours the autoRelogin switch', async () => {
    const onRelogin = jest.fn();
    loginMonitor.setup({ onRelogin });
    require('../src/config').updateConfigItem('autoRelogin', false);

    loginMonitor._records.set('chatgpt', { serviceId: 'chatgpt', state: 'logged-in' });
    const result = await loginMonitor.reloginOnOpen(['chatgpt']);
    expect(result).toEqual({ attempted: [], skipped: 'disabled' });
    expect(onRelogin).not.toHaveBeenCalled();
    require('../src/config').updateConfigItem('autoRelogin', true);
  });

  it('treats a challenge as "still working, keep waiting"', async () => {
    const onRelogin = jest.fn();
    loginMonitor.setup({ onRelogin });
    loginMonitor._records.set('chatgpt', { serviceId: 'chatgpt', state: 'logged-in' });

    // A tab sitting on a bot challenge is "still working", not "signed out":
    // the monitor must wait it out instead of dragging the user back to login.
    loginMonitor.observe(contentsFor('https://chatgpt.com/cdn-cgi/challenge-platform/h/b/x'), 'chatgpt');

    const result = await loginMonitor.reloginOnOpen(['chatgpt']);
    expect(result.attempted).toEqual([]);
    expect(loginMonitor.get('chatgpt').state).toBe('challenge');
  });
});

describe('manual relogin', () => {
  it('records the attempt so a burst does not spam the user', async () => {
    const onRelogin = jest.fn();
    loginMonitor.setup({ onRelogin });

    await loginMonitor.relogin('claude', { reason: 'manual' });
    expect(onRelogin).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'claude', url: 'https://claude.ai/login' }));
    expect(loginMonitor.get('claude').lastReloginAt).toBeGreaterThan(0);
  });

  it('refuses a service with no login target at all', async () => {
    const result = await loginMonitor.relogin('ghostservice');
    expect(result.ok).toBe(false);
  });
});

describe('keep-alive pass', () => {
  it('pings a warm session and stamps the attempt', async () => {
    loginMonitor.setup({});
    const electron = require('electron');

    loginMonitor._records.set('chatgpt', {
      serviceId: 'chatgpt',
      state: 'logged-in',
      reason: 'session-cookie',
      expiresAt: Date.now() + 3600 * 1000,
      keepAliveAt: null
    });

    const result = await loginMonitor.keepAlivePass();
    expect(result.touched).toContain('chatgpt');
    expect(electron.session.defaultSession.fetch).toHaveBeenCalled();
    expect(loginMonitor.get('chatgpt').keepAliveAt).toBeGreaterThan(0);
  });

  it('leaves signed-out services alone', async () => {
    loginMonitor.setup({});
    const electron = require('electron');
    electron.session.defaultSession.fetch.mockClear();

    loginMonitor._records.set('claude', { serviceId: 'claude', state: 'logged-out' });
    const result = await loginMonitor.keepAlivePass();
    expect(result.touched).toEqual([]);
    expect(electron.session.defaultSession.fetch).not.toHaveBeenCalled();
  });

  it('does nothing when the user switched it off', async () => {
    loginMonitor.setup({});
    require('../src/config').updateConfigItem('keepAliveSessions', false);
    loginMonitor._records.set('chatgpt', { serviceId: 'chatgpt', state: 'logged-in', expiresAt: Date.now() + 1000 });

    expect((await loginMonitor.keepAlivePass()).touched).toEqual([]);
    require('../src/config').updateConfigItem('keepAliveSessions', true);
  });
});

describe('persistence', () => {
  it('survives a restart of the monitor (config round trip)', async () => {
    mockLiveCookies.set('chatgpt', [sessionCookie()]);
    await loginMonitor.check('chatgpt', { url: 'https://chatgpt.com/', probe: false });

    const stored = require('../src/config').getConfigItem('sessionStates', {});
    expect(stored.chatgpt.state).toBe('logged-in');

    loginMonitor._records.clear();
    loginMonitor.setup({});
    expect(loginMonitor.get('chatgpt').state).toBe('logged-in');
  });
});
