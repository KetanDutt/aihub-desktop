/**
 * Request-level decisions (`evaluateRequest`) with the Electron session stubbed.
 */

jest.mock('electron', () => ({
  session: {
    defaultSession: {
      webRequest: { onBeforeRequest: jest.fn() }
    }
  }
}), { virtual: true });

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

const blocking = require('../src/blocking');

beforeEach(() => blocking._resetForTests());

describe('evaluateRequest', () => {
  it('lets internal URLs through', () => {
    expect(blocking.evaluateRequest({ url: 'file:///app/index.html' }).allow).toBe(true);
    expect(blocking.evaluateRequest({ url: 'devtools://devtools/x' }).allow).toBe(true);
    expect(blocking.evaluateRequest({ url: 'http://localhost:5173' }).allow).toBe(true);
    expect(blocking.evaluateRequest({ url: 'data:image/png;base64,AA==' }).allow).toBe(true);
  });

  it('allows everything when blocking is disabled', () => {
    blocking.updateBlockingState({ blockingEnabled: false }, null);
    expect(blocking.evaluateRequest({ url: 'https://evil.example', webContentsId: 7 }).allow).toBe(true);
  });

  it('filters registered tabs against their allow-list', () => {
    blocking.updateBlockingState(
      { blockingEnabled: true },
      { service_domains: { chatgpt: ['openai.com'] }, common_auth_domains: ['google.com'] }
    );

    const allowed = blocking.updateTabDomains(42, 'chatgpt', {
      service_domains: { chatgpt: ['openai.com'] },
      common_auth_domains: ['google.com']
    });
    expect(allowed.has('openai.com')).toBe(true);

    expect(
      blocking.evaluateRequest({ url: 'https://cdn.openai.com/file.js', webContentsId: 42 }).allow
    ).toBe(true);
    expect(
      blocking.evaluateRequest({ url: 'https://accounts.google.com/x', webContentsId: 42 }).allow
    ).toBe(true);

    const blocked = blocking.evaluateRequest({ url: 'https://tracker.example/pixel', webContentsId: 42 });
    expect(blocked.allow).toBe(false);
    expect(blocked.reason).toBe('blocked');
  });

  it('trusts the shell webContents', () => {
    blocking.updateBlockingState({ blockingEnabled: true }, { service_domains: { a: ['a.com'] } });
    blocking.registerTrustedWebContents(1);
    expect(
      blocking.evaluateRequest({ url: 'https://anything.example/img.png', webContentsId: 1 }).reason
    ).toBe('trusted');
  });

  it('fails open for unknown webContents by default, closed in strict mode', () => {
    blocking.updateBlockingState({ blockingEnabled: true, strictBlocking: false }, null);
    expect(
      blocking.evaluateRequest({ url: 'https://x.example', webContentsId: 99 }).allow
    ).toBe(true);

    blocking.updateBlockingState({ blockingEnabled: true, strictBlocking: true }, null);
    expect(
      blocking.evaluateRequest({ url: 'https://x.example', webContentsId: 99 }).allow
    ).toBe(false);
  });

  it('tracks blocked/allowed counters', () => {
    blocking.updateBlockingState({ blockingEnabled: true }, { service_domains: { s: ['ok.example'] } });
    blocking.updateTabDomains(5, 's', { service_domains: { s: ['ok.example'] } });
    blocking.evaluateRequest({ url: 'https://ok.example/a', webContentsId: 5 });
    blocking.evaluateRequest({ url: 'https://nope.example/b', webContentsId: 5 });
    const stats = blocking.getStats();
    expect(stats.allowed).toBe(1);
    expect(stats.blocked).toBe(1);
  });
});

describe('isInternalUrl', () => {
  it('covers the protocols the shell needs', () => {
    expect(blocking.isInternalUrl('about:blank')).toBe(true);
    expect(blocking.isInternalUrl('blob:https://x')).toBe(true);
    expect(blocking.isInternalUrl('https://remote.example')).toBe(false);
  });
});
