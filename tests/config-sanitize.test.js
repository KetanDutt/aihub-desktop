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
