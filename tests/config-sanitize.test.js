/**
 * The renderer is untrusted input: `sanitizeConfig()` must clamp, coerce and
 * drop anything that is not a user-editable setting.
 */

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

jest.mock('electron-store', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    store: {}
  }))
}), { virtual: true });

const { sanitizeConfig, validateAccelerator, validateProxyUrl } = require('../src/config');

describe('session, anti-bot and local API settings', () => {
  const config = require('../src/config');

  it('accepts the new keys and coerces them', () => {
    const clean = config.sanitizeConfig({
      sessionPersistence: 'false',
      autoRelogin: 'true',
      isolateSessions: 'yes-please',
      keepAliveMinutes: 4000,
      antiBotHardening: true,
      antiBotCanvasNoise: 'false',
      apiEnabled: true,
      apiPort: 1,
      apiMaxConcurrent: 99,
      apiRateLimitPerMinute: 'abc',
      apiTimeoutSeconds: 4,
      apiServices: ['chatgpt', 'chatgpt', '', 7]
    });

    expect(clean.sessionPersistence).toBe(false);
    expect(clean.autoRelogin).toBe(true);
    expect(clean.isolateSessions).toBe(false); // junk never becomes a session change
    expect(clean.keepAliveMinutes).toBe(720);
    expect(clean.antiBotCanvasNoise).toBe(false);
    expect(clean.apiPort).toBe(1024);
    expect(clean.apiMaxConcurrent).toBe(8);
    expect(clean.apiRateLimitPerMinute).toBe(60); // falls back rather than going unlimited
    expect(clean.apiTimeoutSeconds).toBe(5);
    expect(clean.apiServices).toEqual(['chatgpt']);
  });

  it('keeps the API token and internal state out of a renderer write', () => {
    const clean = config.sanitizeConfig({
      apiToken: 'stolen',
      sessionStates: { chatgpt: { state: 'logged-in' } },
      serviceUsage: { chatgpt: 1 }
    });
    expect(clean).not.toHaveProperty('apiToken');
    expect(clean).not.toHaveProperty('sessionStates');
    expect(clean).not.toHaveProperty('serviceUsage');
  });

  it('never ships the API token to the renderer with the config snapshot', () => {
    const publicConfig = config.getPublicConfig();
    expect(publicConfig.apiToken).toBeUndefined();
  });

  it('documents every new setting in the schema and the whitelist', () => {
    const keys = [
      'sessionPersistence',
      'autoRelogin',
      'isolateSessions',
      'keepAliveSessions',
      'keepAliveMinutes',
      'antiBotHardening',
      'antiBotHumanize',
      'antiBotCanvasNoise',
      'apiEnabled',
      'apiPort',
      'apiExposeAllServices',
      'apiServices',
      'apiMaxConcurrent',
      'apiRateLimitPerMinute',
      'apiTimeoutSeconds'
    ];
    for (const key of keys) {
      expect(config.schema).toHaveProperty(key);
      expect(config.WRITABLE_KEYS.has(key)).toBe(true);
      expect(config.DEFAULTS).toHaveProperty(key);
    }
    // Internal-but-persisted keys must exist in the schema without being writable.
    for (const internal of ['apiToken', 'sessionStates', 'serviceUsage']) {
      expect(config.schema).toHaveProperty(internal);
      expect(config.WRITABLE_KEYS.has(internal)).toBe(false);
    }
  });
});

describe('sanitizeConfig', () => {
  it('drops internal state even when supplied', () => {
    const clean = sanitizeConfig({
      darkMode: true,
      openTabs: [{ id: 'evil' }],
      activeTabId: 'evil',
      remoteUrls: { services: 'https://attacker.example' },
      maxActiveServices: 5
    });
    expect(clean).not.toHaveProperty('openTabs');
    expect(clean).not.toHaveProperty('activeTabId');
    expect(clean).not.toHaveProperty('remoteUrls');
    expect(clean.darkMode).toBe(true);
    expect(clean.maxActiveServices).toBe(5);
  });

  it('clamps the tab limit into the safe range', () => {
    expect(sanitizeConfig({ maxActiveServices: 500 }).maxActiveServices).toBe(20);
    expect(sanitizeConfig({ maxActiveServices: -4 }).maxActiveServices).toBe(1);
    expect(sanitizeConfig({ maxActiveServices: 'not-a-number' }).maxActiveServices).toBe(3);
  });

  it('coerces booleans and deduplicates enabledServices', () => {
    const clean = sanitizeConfig({
      blockingEnabled: 'true',
      enabledServices: ['chatgpt', 'chatgpt', 'claude', 42, '']
    });
    expect(clean.blockingEnabled).toBe(true);
    expect(clean.enabledServices).toEqual(['chatgpt', 'claude']);
  });

  it('throws for an enabled proxy with a bad gateway', () => {
    expect(() => sanitizeConfig({ useProxy: true, proxyUrl: 'javascript:alert(1)' })).toThrow(
      'Invalid proxy URL or protocol'
    );
    expect(() => sanitizeConfig({ useProxy: true, proxyUrl: 'ftp://x' })).toThrow();
  });

  it('silently resets a bad proxy when the proxy is disabled', () => {
    const clean = sanitizeConfig({ useProxy: false, proxyUrl: 'javascript:alert(1)' });
    expect(clean.useProxy).toBe(false);
    expect(clean.proxyUrl).toMatch(/^https:\/\//);
  });

  it('rejects nonsense accelerators', () => {
    expect(() => sanitizeConfig({ globalShortcut: '"><script>' })).toThrow('Invalid keyboard shortcut');
    expect(sanitizeConfig({ globalShortcut: 'CommandOrControl+Shift+X' }).globalShortcut).toBe(
      'CommandOrControl+Shift+X'
    );
  });

  it('rejects non-object payloads', () => {
    expect(() => sanitizeConfig(null)).toThrow();
    expect(() => sanitizeConfig([1, 2])).toThrow();
  });
});

describe('validators', () => {
  it('validateProxyUrl only allows http(s)', () => {
    expect(validateProxyUrl('https://ok.example')).toBe(true);
    expect(validateProxyUrl('http://ok.example')).toBe(true);
    expect(validateProxyUrl('')).toBe(true); // empty = use default
    expect(validateProxyUrl('file:///etc/passwd')).toBe(false);
    expect(validateProxyUrl('data:text/html,x')).toBe(false);
  });

  it('validateAccelerator', () => {
    expect(validateAccelerator('CommandOrControl+Shift+A')).toBe(true);
    expect(validateAccelerator('Ctrl+Alt+Delete')).toBe(true);
    expect(validateAccelerator('')).toBe(false);
    expect(validateAccelerator('a'.repeat(100))).toBe(false);
  });
});
