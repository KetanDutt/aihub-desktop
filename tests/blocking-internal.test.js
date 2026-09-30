/**
 * Regression tests for the "internal URL" escape hatch in the domain filter.
 *
 * `evaluateRequest` skips the allow-list for URLs that can never leave the
 * machine (the app shell, devtools, `blob:`/`data:` payloads, loopback). The
 * original implementation matched those with `String.startsWith`, so a public
 * domain that merely *began* with an internal prefix —
 * `http://localhost.evil.com/` — was classified as internal and every request
 * to it skipped the allow-list entirely.
 *
 * These tests pin the hostname-based behaviour.
 */

jest.mock('electron', () => ({
  session: { defaultSession: { webRequest: { onBeforeRequest: jest.fn() } } },
  app: { getPath: jest.fn().mockReturnValue('mockDataPath') }
}), { virtual: true });

jest.mock('../src/config', () => ({
  getConfig: jest.fn().mockReturnValue({ blockingEnabled: true }),
  updateConfigItem: jest.fn()
}));

jest.mock('../src/data', () => ({
  getRulesCache: jest.fn().mockReturnValue({ service_domains: {} }),
  loadRules: jest.fn(),
  getCommonAuthDomains: jest.fn().mockReturnValue(new Set())
}));

const blocking = require('../src/blocking');

const { isInternalUrl, isLoopbackHostname, evaluateRequest } = blocking;

const LOOPBACK_RULES = { service_domains: { chatgpt: ['openai.com'] } };

beforeEach(() => {
  blocking._resetForTests();
  blocking.updateBlockingState({ blockingEnabled: true, strictBlocking: false }, LOOPBACK_RULES);
});

describe('isLoopbackHostname', () => {
  it('accepts real loopback names', () => {
    for (const host of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1']) {
      expect(isLoopbackHostname(host)).toBe(true);
    }
  });

  it('rejects look-alikes', () => {
    for (const host of [
      'localhost.evil.com',
      'localhostevil.com',
      'notlocalhost',
      '127.0.0.1.evil.com',
      '127.0.0.1abc',
      '128.0.0.1',
      'example.com',
      ''
    ]) {
      expect(isLoopbackHostname(host)).toBe(false);
    }
  });
});

describe('isInternalUrl', () => {
  it('keeps local UI and in-memory schemes internal', () => {
    for (const url of [
      'file:///app/ui/index.html',
      'devtools://devtools/bundled/inspector.html',
      'chrome://settings',
      'chrome-extension://abcdef/page.html',
      'data:text/html,<p>hi</p>',
      'blob:https://chatgpt.com/1234',
      'about:blank',
      'http://localhost:3000/status',
      'https://127.0.0.1/v1/models'
    ]) {
      expect(isInternalUrl(url)).toBe(true);
    }
  });

  it('does not treat a public domain as internal just because of its prefix', () => {
    for (const url of [
      'https://localhost.evil.com/collect',
      'http://localhostevil.com/track',
      'https://127.0.0.1.evil.com/track',
      'http://127.0.0.1.attacker.test/pixel.gif',
      'http://localhost@evil.com/',
      'https://remote.example/'
    ]) {
      expect(isInternalUrl(url)).toBe(false);
    }
  });

  it('is not fooled by userinfo that spells localhost', () => {
    // `http://localhost@evil.com/` has the host `evil.com`: the filter must see it.
    const decision = evaluateRequest({ url: 'http://localhost@evil.com/collect', webContentsId: 42 });
    blocking.updateTabDomains(42, 'chatgpt', LOOPBACK_RULES);
    const tracked = evaluateRequest({ url: 'http://localhost@evil.com/collect', webContentsId: 42 });
    expect(tracked.allow).toBe(false);
    expect(tracked.reason).toBe('blocked');
    expect(decision.hostname).toBe('evil.com');
  });
});

describe('evaluateRequest', () => {
  it('still allows the service’s own domains', () => {
    blocking.updateTabDomains(7, 'chatgpt', LOOPBACK_RULES);
    const decision = evaluateRequest({ url: 'https://cdn.openai.com/asset.js', webContentsId: 7 });
    expect(decision).toMatchObject({ allow: true, reason: 'allowed' });
  });

  it('never filters a scheme Chromium uses for the app itself', () => {
    expect(evaluateRequest({ url: 'file:///app/ui/index.html', webContentsId: 7 }).reason).toBe('internal');
    expect(evaluateRequest({ url: 'about:blank', webContentsId: 7 }).reason).toBe('internal');
  });

  it('reports unparsable URLs instead of guessing', () => {
    expect(evaluateRequest({ url: 'https://exa mple.com/', webContentsId: 7 }).reason).toBe('unparsable');
    expect(evaluateRequest({}).reason).toBe('no-url');
  });

  it('does not count an internal request as allowed traffic', () => {
    blocking.resetStats();
    evaluateRequest({ url: 'about:blank', webContentsId: 7 });
    expect(blocking.getStats()).toEqual({ blocked: 0, allowed: 0 });
  });
});
