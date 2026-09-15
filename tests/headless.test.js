/**
 * Headless mode: `RUN-SERVER.bat` / `npm run serve` start the API server with no
 * desktop window. Flag detection and the console banner are pure, so they are
 * tested here.
 */

const headless = require('../src/headless');

describe('headless detection', () => {
  it('recognises the command line flags', () => {
    expect(headless.isHeadless(['electron', '.', '--headless'])).toBe(true);
    expect(headless.isHeadless(['electron', '.', '--api-only'])).toBe(true);
    expect(headless.isHeadless(['electron', '.', '--no-gui'])).toBe(true);
    expect(headless.isHeadless(['electron', '.'])).toBe(false);
    expect(headless.isHeadless([])).toBe(false);
    expect(headless.isHeadless(null)).toBe(false);
  });

  it('recognises the environment variable', () => {
    expect(headless.isHeadless(['electron', '.'], { AIHUB_HEADLESS: '1' })).toBe(true);
    expect(headless.isHeadless(['electron', '.'], { AIHUB_HEADLESS: 'true' })).toBe(true);
    expect(headless.isHeadless(['electron', '.'], { AIHUB_HEADLESS: '0' })).toBe(false);
    expect(headless.isHeadless(['electron', '.'], {})).toBe(false);
  });

  it('reads the port and key switches', () => {
    expect(headless.options(['electron', '.', '--headless', '--port', '8081'])).toMatchObject({
      port: 8081,
      printKey: false
    });
    expect(headless.options(['--api-port=9000', '--print-key'])).toMatchObject({ port: 9000, printKey: true });
    expect(headless.options(['--port']).port).toBeNull();
    expect(headless.options(['--quiet']).quiet).toBe(true);
  });
});

describe('headless banner', () => {
  const status = {
    baseUrl: 'http://127.0.0.1:8788/v1',
    key: 'aihub-0123456789abcdef',
    keyMasked: 'aihub-0123…cdef',
    port: 8788,
    listening: true,
    lastError: null,
    models: [
      { id: 'aihub/chatgpt', ready: false, requiresLogin: true },
      { id: 'aihub/perplexity', ready: true, requiresLogin: false }
    ]
  };

  it('prints the endpoint, the masked key and a usable example', () => {
    const text = headless.banner(status, { version: '1.4.0' });
    expect(text).toContain('http://127.0.0.1:8788/v1');
    expect(text).toContain('aihub-0123…cdef');
    expect(text).not.toContain('aihub-0123456789abcdef');
    expect(text).toContain('/chat/completions');
    expect(text).toContain('1 need no sign-in');
  });

  it('prints the key in the clear only when asked', () => {
    expect(headless.banner(status, { printKey: true, version: '1.4.0' })).toContain('aihub-0123456789abcdef');
  });
});
