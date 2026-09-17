/**
 * Favicon caching behaviour, in particular the *negative* cache.
 *
 * Misses used to be stored in the same map as hits and never expired, so an
 * icon that failed once (offline at launch, a flaky CDN, a rate limit) stayed
 * missing until the app was restarted. Misses now live in their own map with a
 * TTL, so a transient failure heals itself.
 */

jest.mock(
  'electron-log',
  () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  { virtual: true }
);

const os = require('os');
const path = require('path');
const fs = require('fs');

// Keep the on-disk cache inside a temp dir for the whole suite.
process.env.AIHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-favicon-'));

const favicon = require('../src/favicon');

describe('originOf', () => {
  it('reduces a URL to its origin and rejects non-http schemes', () => {
    expect(favicon.originOf('https://chatgpt.com/c/123?x=1')).toBe('https://chatgpt.com');
    expect(favicon.originOf('http://localhost:8788/v1')).toBe('http://localhost:8788');
    expect(favicon.originOf('file:///etc/passwd')).toBeNull();
    expect(favicon.originOf('javascript:alert(1)')).toBeNull();
    expect(favicon.originOf('not a url')).toBeNull();
  });
});

describe('negative caching', () => {
  beforeEach(() => {
    favicon._resetForTests();
    jest.restoreAllMocks();
  });

  it('retries a failed origin once the negative TTL has elapsed', async () => {
    const https = require('https');
    // Every request fails, as if the machine were offline.
    const get = jest.spyOn(https, 'get').mockImplementation(() => {
      const req = {
        on(event, handler) {
          if (event === 'error') setImmediate(() => handler(new Error('offline')));
          return req;
        },
        destroy() {}
      };
      return req;
    });

    expect(await favicon.resolveFavicon('https://unreachable.test/')).toBeNull();
    const callsAfterFirst = get.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Immediately after, the miss is served from the negative cache.
    expect(await favicon.resolveFavicon('https://unreachable.test/')).toBeNull();
    expect(get.mock.calls.length).toBe(callsAfterFirst);

    // Once the TTL expires the origin is tried again rather than being written
    // off for the lifetime of the process.
    const sevenHours = 7 * 60 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + sevenHours);

    expect(await favicon.resolveFavicon('https://unreachable.test/')).toBeNull();
    expect(get.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('never throws through the IPC wrapper', async () => {
    await expect(favicon.getFavicon('nonsense')).resolves.toEqual({ dataUrl: null });
  });
});
