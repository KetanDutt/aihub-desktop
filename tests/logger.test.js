/**
 * The logger is the one module every other main-process module imports, so it
 * has to survive a partial `electron-log`: a mocked backend in a unit test, an
 * offline install, or a future version that drops a level.
 *
 * This is a regression test for a real failure: callers used to `require`
 * `electron-log` directly, so a mock without `debug` turned
 * `updateTabDomains()` into a `TypeError` — a logging call breaking the domain
 * filter.
 */

jest.mock('electron-log', () => {
  const calls = { info: [], warn: [], error: [] };
  return {
    __esModule: true,
    info: (...args) => calls.info.push(args),
    warn: (...args) => calls.warn.push(args),
    error: (...args) => calls.error.push(args),
    // No `debug`, no `transports`, no `catchErrors` — deliberately partial.
    catchErrors: jest.fn(),
    __calls: calls
  };
}, { virtual: true });

jest.mock('electron', () => ({ app: { isPackaged: true } }), { virtual: true });

const electronLog = require('electron-log');
const log = require('../src/logger');

beforeEach(() => {
  electronLog.__calls.info.length = 0;
  electronLog.__calls.warn.length = 0;
  electronLog.__calls.error.length = 0;
  jest.clearAllMocks();
});

describe('logger', () => {
  it('loads even when the backend is missing transports and levels', () => {
    expect(typeof log.info).toBe('function');
    expect(() => log.configure()).not.toThrow();
  });

  it('forwards the levels the backend implements', () => {
    log.info('hello', 1);
    log.warn('careful');
    log.error('boom');
    expect(electronLog.__calls.info).toEqual([['hello', 1]]);
    expect(electronLog.__calls.warn).toEqual([['careful']]);
    expect(electronLog.__calls.error).toEqual([['boom']]);
  });

  it('no-ops a level the backend does not implement instead of throwing', () => {
    expect(() => log.debug('missing level')).not.toThrow();
    expect(() => log.verbose('missing level')).not.toThrow();
    expect(() => log.silly('missing level')).not.toThrow();
  });

  it('never lets a throwing backend break the caller', () => {
    const explode = { explode: true };
    // Make the backend throw for one call only.
    const original = electronLog.info;
    electronLog.info = () => {
      throw new Error('disk full');
    };
    try {
      expect(() => log.info('while the disk is full', explode)).not.toThrow();
    } finally {
      electronLog.info = original;
    }
  });

  it('exposes the log path only when the backend can report one', () => {
    expect(log.getLogPath()).toBeNull();
  });

  it('scopes every level with a tag', () => {
    const scoped = log.scope('blocking');
    scoped.info('ready');
    scoped.error('failed');
    expect(electronLog.__calls.info).toEqual([['[blocking]', 'ready']]);
    expect(electronLog.__calls.error).toEqual([['[blocking]', 'failed']]);
    expect(() => scoped.debug('dropped')).not.toThrow();
  });

  it('keeps configure() idempotent and test-resettable', () => {
    log.configure({ isPackaged: true });
    log.configure({ isPackaged: false });
    expect(() => log._resetForTests()).not.toThrow();
    expect(() => log.configure()).not.toThrow();
  });
});
