/**
 * Cookie cache primitives: the reason a restart does not sign you out.
 */

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

const cookies = require('../src/cookies');
const { SESSION } = require('../src/constants');

const DAY = 86400;

describe('normalizeCookie', () => {
  it('accepts a Chromium cookie and flags session-only ones', () => {
    const normalized = cookies.normalizeCookie({
      name: '__Secure-next-auth.session-token',
      value: 'abc',
      domain: '.chatgpt.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction'
    });
    expect(normalized.sessionOnly).toBe(true);
    expect(normalized.secure).toBe(true);
    expect(normalized.sameSite).toBe('no_restriction');
    expect(normalized.expirationDate).toBeUndefined();
  });

  it('defaults the path and keeps https-only cookies marked secure', () => {
    const normalized = cookies.normalizeCookie({ name: 'a', value: 'b', domain: 'example.com' });
    expect(normalized.path).toBe('/');
    expect(normalized.secure).toBe(false);
  });

  it('rejects unusable input', () => {
    expect(cookies.normalizeCookie(null)).toBeNull();
    expect(cookies.normalizeCookie({ name: '', value: 'x', domain: 'a.com' })).toBeNull();
    expect(cookies.normalizeCookie({ name: 'x', value: 'y' })).toBeNull(); // no scope
    expect(cookies.normalizeCookie({ name: 'x', value: 'z'.repeat(16 * 1024 + 1), domain: 'a.com' })).toBeNull();
    expect(cookies.normalizeCookie({ name: 'n'.repeat(600), value: 'v', domain: 'a.com' })).toBeNull();
  });

  it('drops an unknown sameSite instead of trusting it', () => {
    const normalized = cookies.normalizeCookie({ name: 'a', value: 'b', domain: 'x.com', sameSite: 'yolo' });
    expect(normalized.sameSite).toBeUndefined();
  });
});

describe('pinCookie', () => {
  it('gives a session cookie a bounded expiry', () => {
    const now = 1_700_000_000_000;
    const pinned = cookies.pinCookie(
      { name: 'sid', value: 'v', domain: 'a.com', path: '/', sessionOnly: true },
      now
    );
    expect(pinned.sessionOnly).toBe(false);
    expect(pinned.expirationDate).toBe(Math.floor(now / 1000) + Math.floor(SESSION.COOKIE_PIN_LIFETIME_MS / 1000));
    expect(pinned._pinned).toBe(true);
  });

  it('never shortens a cookie that already lives longer', () => {
    const now = Date.now();
    const far = Math.floor(now / 1000) + 400 * DAY;
    const pinned = cookies.pinCookie({ name: 'sid', value: 'v', domain: 'a.com', path: '/', expirationDate: far }, now);
    expect(pinned.expirationDate).toBe(far);
    expect(pinned._pinned).toBeUndefined();
  });

  it('extends a cookie that is about to lapse', () => {
    const now = Date.now();
    const almost = Math.floor(now / 1000) + 60; // one minute left
    const pinned = cookies.pinCookie({ name: 'sid', value: 'v', domain: 'a.com', path: '/', expirationDate: almost }, now);
    expect(pinned.expirationDate).toBeGreaterThan(almost);
    expect(pinned._pinned).toBe(true);
  });

  it('does not mutate the caller’s record', () => {
    const original = { name: 'sid', value: 'v', domain: 'a.com', path: '/', sessionOnly: true };
    cookies.pinCookie(original);
    expect(original.expirationDate).toBeUndefined();
  });
});

describe('isAuthCookie', () => {
  it('treats session cookies and token-ish names as auth material', () => {
    expect(cookies.isAuthCookie({ name: 'x', sessionOnly: true })).toBe(true);
    expect(cookies.isAuthCookie({ name: '__Secure-token', sessionOnly: false })).toBe(true);
    expect(cookies.isAuthCookie({ name: 'cf_clearance', sessionOnly: false })).toBe(true);
  });

  it('ignores analytics cookies with a long expiry', () => {
    expect(cookies.isAuthCookie({ name: '_ga', sessionOnly: false })).toBe(false);
    expect(cookies.isAuthCookie(null)).toBe(false);
  });
});

describe('isCookieFresh', () => {
  it('drops cookies the browser has already expired', () => {
    const now = Date.now();
    expect(cookies.isCookieFresh({ expirationDate: Math.floor(now / 1000) - 10 }, now)).toBe(false);
    expect(cookies.isCookieFresh({ expirationDate: Math.floor(now / 1000) + 10 }, now)).toBe(true);
    expect(cookies.isCookieFresh({ name: 'session' }, now)).toBe(true);
    expect(cookies.isCookieFresh(null, now)).toBe(false);
  });
});

describe('mergeCookies', () => {
  it('restores only what the live jar is missing', () => {
    const live = [{ name: 'sid', domain: 'a.com', path: '/', value: 'live' }];
    const saved = [
      { name: 'sid', domain: 'a.com', path: '/', value: 'stale' },
      { name: 'cf_clearance', domain: 'a.com', path: '/', value: 'missing' }
    ];
    const { toRestore } = cookies.mergeCookies(live, saved);
    expect(toRestore.map((entry) => entry.name)).toEqual(['cf_clearance']);
  });

  it('skips expired and duplicate entries', () => {
    const now = Date.now();
    const saved = [
      { name: 'a', domain: 'x.com', path: '/', expirationDate: Math.floor(now / 1000) - 60 },
      { name: 'b', domain: 'x.com', path: '/', value: '1' },
      { name: 'b', domain: 'x.com', path: '/', value: '2' }
    ];
    const { toRestore } = cookies.mergeCookies([], saved, now);
    expect(toRestore.map((entry) => entry.name)).toEqual(['b']);
  });

  it('tolerates empty and junk input', () => {
    expect(cookies.mergeCookies(null, null).toRestore).toEqual([]);
    expect(cookies.mergeCookies([], [{ nope: true }]).toRestore).toEqual([]);
  });
});

describe('prepareSnapshot / summarise', () => {
  it('caps the snapshot and counts what it dropped', () => {
    const many = Array.from({ length: SESSION.MAX_COOKIES_PER_SERVICE + 5 }, (unused, index) => ({
      name: `c${index}`,
      value: 'v',
      domain: 'a.com',
      path: '/'
    }));
    const { entries, dropped } = cookies.prepareSnapshot(many);
    expect(entries.length).toBe(SESSION.MAX_COOKIES_PER_SERVICE);
    expect(dropped).toBe(5);
  });

  it('writes only the fields needed to replay a cookie', () => {
    const { entries } = cookies.prepareSnapshot([
      { name: 'a', value: 'b', domain: 'x.com', path: '/', sessionOnly: true, expirationDate: 123, junk: 'nope', _pinned: true }
    ]);
    expect(Object.keys(entries[0]).sort()).toEqual(
      ['domain', 'expirationDate', 'httpOnly', 'name', 'path', 'secure', 'value'].sort()
    );
  });

  it('summarises counts for the UI', () => {
    const summary = cookies.summarise([
      { name: 'sid', sessionOnly: true, _pinned: true },
      { name: '_ga', sessionOnly: false },
      { name: 'cf_clearance', sessionOnly: false, expirationDate: 5000 }
    ]);
    expect(summary).toMatchObject({ count: 3, pinned: 1, auth: 2, expiresAt: 5000000 });
  });
});
