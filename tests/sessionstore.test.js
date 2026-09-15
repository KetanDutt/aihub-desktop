/**
 * The session store: pinning, snapshotting and replaying cookies under a mocked
 * Electron. The fake mockJar mimics Chromium's real rule — session cookies vanish at
 * exit — which is exactly the failure this module exists to fix.
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

const mockDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-sessions-'));
process.env.AIHUB_DATA_DIR = mockDataDir;
process.env.AIHUB_BUNDLED_DIR = path.join(__dirname, '..', 'data');

/** An in-memory Chromium cookie mockJar, including the session-cookie caveat. */
function createMockJar() {
  const persistent = new Map();
  const ephemeral = new Map();

  const key = (cookie) => `${cookie.domain || ''}|${cookie.name}|${cookie.path || '/'}`;

  return {
    cookies: {
      async get(filter = {}) {
        const all = [...persistent.values(), ...ephemeral.values()];
        if (!filter.domain) return all.map((entry) => ({ ...entry }));
        const wanted = String(filter.domain).replace(/^\./, '');
        return all
          .filter((entry) => {
            const host = String(entry.domain || '').replace(/^\./, '');
            return host === wanted || host.endsWith(`.${wanted}`);
          })
          .map((entry) => ({ ...entry }));
      },
      async set(cookie) {
        const record = {
          domain: cookie.domain || 'localhost',
          path: cookie.path || '/',
          name: cookie.name,
          value: cookie.value,
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {})
        };
        if (cookie.expirationDate) persistent.set(key(record), record);
        else ephemeral.set(key(record), record);
        return record;
      },
      async remove(url, name) {
        for (const map of [persistent, ephemeral]) {
          for (const [entryKey, entry] of [...map]) {
            if (entry.name === name && url.includes(entry.domain.replace(/^\./, ''))) map.delete(entryKey);
          }
        }
      }
    },
    /** What survives a restart: only entries Chromium persisted. */
    restart() {
      ephemeral.clear();
    },
    /** A cache/profile wipe: everything Chromium stored is gone too. */
    wipe() {
      ephemeral.clear();
      persistent.clear();
    },
    size() {
      return persistent.size + ephemeral.size;
    },
    persistentSize() {
      return persistent.size;
    }
  };
}

const mockJar = createMockJar();
let mockEncrypted = null;

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => mockDataDir,
    getLocale: () => 'en-US'
  },
  session: {
    defaultSession: {
      id: 'default',
      cookies: mockJar.cookies,
      getCacheSize: jest.fn(async () => 4096),
      clearStorageData: jest.fn(async () => {}),
      clearCache: jest.fn(async () => {}),
      fetch: jest.fn(async () => ({ status: 200, text: async () => '<html>ok</html>' })),
      setUserAgent: jest.fn()
    },
    fromPartition: jest.fn(() => ({
      id: 'partition',
      cookies: mockJar.cookies,
      getCacheSize: jest.fn(async () => 0),
      clearStorageData: jest.fn(async () => {}),
      fetch: jest.fn(async () => ({ status: 200, text: async () => '' }))
    }))
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text) => {
      mockEncrypted = text;
      return Buffer.from(`enc:${text}`, 'utf8');
    },
    decryptString: (buffer) => {
      const text = buffer.toString('utf8').replace(/^enc:/, '');
      return text;
    }
  }
}), { virtual: true });

const sessionStore = require('../src/sessionstore');

const SERVICE = { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' };

async function seedLogin() {
  // A service cookie *without* an expiry: the classic "lost on restart" case.
  await mockJar.cookies.set({
    name: '__Secure-next-auth.session-token',
    value: 'token-123',
    domain: '.chatgpt.com',
    path: '/',
    secure: true,
    httpOnly: true
  });
  await mockJar.cookies.set({
    name: '_ga',
    value: 'analytics',
    domain: '.chatgpt.com',
    path: '/',
    expirationDate: Math.floor(Date.now() / 1000) + 86400
  });
}

beforeEach(() => {
  sessionStore._resetForTests();
  sessionStore.loadProfiles({ force: true });
});

describe('profiles', () => {
  it('loads the bundled fingerprints for the bundled catalogue', () => {
    const profile = sessionStore.profileFor('chatgpt');
    expect(profile).toBeTruthy();
    expect(profile.cookieDomains).toContain('chatgpt.com');
    expect(profile.cookieNames.some((name) => name.includes('session-token'))).toBe(true);
    expect(profile.loginUrl).toBe('https://chatgpt.com/auth/login');
  });

  it('falls back to the generic fingerprint for an unknown service', () => {
    const profile = sessionStore.profileFor('somethingnew');
    expect(profile).toBeTruthy();
    expect(profile.serviceId).toBe('somethingnew');
    expect(profile.cookieNames.length).toBeGreaterThan(0);
  });
});

describe('partitions', () => {
  it('shares the default session unless isolation is on', () => {
    expect(sessionStore.partitionFor('chatgpt')).toBeNull();
    expect(sessionStore.sessionFor('chatgpt')).toBe(require('electron').session.defaultSession);
  });
});

describe('snapshot + restore', () => {
  it('pins a session cookie, writes it to disk and replays it after a restart', async () => {
    await seedLogin();

    const result = await sessionStore.snapshotService('chatgpt', SERVICE);
    expect(result.saved).toBe(2);
    expect(result.pinned).toBe(1);

    // The snapshot is written through the encryption envelope.
    const file = sessionStore.cookieFilePath('chatgpt');
    expect(fs.existsSync(file)).toBe(true);
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw.startsWith('AIE1')).toBe(true);
    expect(mockEncrypted).toContain('token-123');
    expect(JSON.parse(mockEncrypted).cookies[0].expirationDate).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Restart: pinning is what actually keeps the login — the session cookie
    // is now persisted by Chromium itself, so nothing needs replaying.
    mockJar.restart();
    expect(mockJar.persistentSize()).toBe(2);

    // A profile/cache wipe is the case the snapshot exists for: the jar is empty
    // and the login is rebuilt from disk.
    mockJar.wipe();
    expect(mockJar.size()).toBe(0);

    const restored = await sessionStore.restoreService('chatgpt', SERVICE);
    expect(restored.restored).toBe(2);
    const live = await mockJar.cookies.get({});
    expect(live.map((cookie) => cookie.name)).toContain('__Secure-next-auth.session-token');
    // and it comes back with an expiry, so this restart was also survivable
    const replayed = live.find((cookie) => cookie.name === '__Secure-next-auth.session-token');
    expect(replayed.expirationDate).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('does not overwrite a fresher live cookie with the snapshot', async () => {
    await mockJar.cookies.set({
      name: '__Secure-next-auth.session-token',
      value: 'live-wins',
      domain: '.chatgpt.com',
      path: '/',
      secure: true
    });
    await sessionStore.snapshotService('chatgpt', SERVICE);

    await mockJar.cookies.remove('https://chatgpt.com', '__Secure-next-auth.session-token');
    await mockJar.cookies.set({
      name: '__Secure-next-auth.session-token',
      value: 'brand-new',
      domain: '.chatgpt.com',
      path: '/',
      secure: true,
      expirationDate: Math.floor(Date.now() / 1000) + 600
    });

    const restore = await sessionStore.restoreService('chatgpt', SERVICE);
    expect(restore.restored).toBe(0);
    const live = await mockJar.cookies.get({ domain: 'chatgpt.com' });
    expect(live.find((cookie) => cookie.name === '__Secure-next-auth.session-token').value).toBe('brand-new');
  });

  it('survives a corrupt snapshot file', async () => {
    fs.mkdirSync(path.dirname(sessionStore.cookieFilePath('chatgpt')), { recursive: true });
    fs.writeFileSync(sessionStore.cookieFilePath('chatgpt'), '{ this is not json');
    await expect(sessionStore.restoreService('chatgpt', SERVICE)).resolves.toMatchObject({ restored: 0 });
  });

  it('skips a snapshot for a service with no cookies at all', async () => {
    const result = await sessionStore.snapshotService('ghost', { id: 'ghost', url: 'https://ghost.invalid/' });
    expect(result.saved).toBe(0);
  });
});

describe('keep-alive', () => {
  it('pings the home origin through the session and re-snapshots', async () => {
    const electron = require('electron');
    const { snapshotService } = sessionStore;
    await seedLogin();
    await snapshotService('chatgpt', SERVICE);

    const result = await sessionStore.touchService('chatgpt', SERVICE);
    expect(result.ok).toBe(true);
    expect(electron.session.defaultSession.fetch).toHaveBeenCalled();
    const called = electron.session.defaultSession.fetch.mock.calls.at(-1);
    expect(called[0]).toBe('https://chatgpt.com/');
    expect(called[1].credentials).toBe('include');
  });

  it('refuses to ping anything that is not an absolute http(s) url', async () => {
    const result = await sessionStore.touchService('nope', { id: 'nope', url: 'javascript:alert(1)' });
    expect(result).toEqual({ ok: false, error: 'no-target' });
  });
});

describe('stats + clearing', () => {
  it('reports cookie counts and cache size for the UI', async () => {
    await seedLogin();
    await sessionStore.snapshotService('chatgpt', SERVICE);

    const stats = await sessionStore.getStats('chatgpt', SERVICE);
    expect(stats.cookies).toBe(2);
    expect(stats.pinned).toBe(1);
    expect(stats.isolated).toBe(false);
    expect(stats.partition).toBe('default');
    expect(stats.cacheSize).toBe(4096);
    expect(stats.lastSnapshotAt).toEqual(expect.any(String));
  });

  it('clears a service from the live jar *and* the snapshot', async () => {
    await seedLogin();
    await sessionStore.snapshotService('chatgpt', SERVICE);
    expect(sessionStore.hasSnapshot('chatgpt')).toBe(true);

    const result = await sessionStore.clearService('chatgpt');
    expect(result.cleared).toBeGreaterThan(0);
    expect(sessionStore.hasSnapshot('chatgpt')).toBe(false);
    expect(mockJar.size()).toBe(0);
  });
});

describe('bundled login fingerprints', () => {
  it('cover every service in the bundled catalogue (and nothing else)', () => {
    const { slugify } = require('../src/utils');
    const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'services.json'), 'utf8'));
    const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'logins.json'), 'utf8'));

    const serviceIds = catalogue.ai_services.map((tuple) => slugify(tuple[0]));
    const profileIds = Object.keys(payload.profiles);

    for (const id of serviceIds) expect(profileIds).toContain(id);
    for (const id of profileIds) expect(serviceIds).toContain(id);
  });

  it('every profile exposes a usable https login target', () => {
    const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'logins.json'), 'utf8'));
    for (const [id, raw] of Object.entries(payload.profiles)) {
      const profile = normalizeProfile(raw, id);
      expect(profile).not.toBeNull();
      expect(profile.loginUrl.startsWith('https://')).toBe(true);
      expect(profile.cookieNames.length).toBeGreaterThan(0);
      for (const name of profile.cookieNames) {
        // eslint-disable-next-line no-useless-escape
        expect(name).toMatch(/^[A-Za-z0-9_\-.~=]+$/);
      }
    }
  });

  it('never lets a selector carry markup', () => {
    const profile = normalizeProfile({ loggedInSelector: '<img onerror=x>', session_cookies: ['sid'] }, 'demo');
    expect(profile.loggedInSelector).toBeNull();
  });
});

function normalizeProfile(raw, id) {
  // eslint-disable-next-line global-require
  return require('../src/loginstate').normalizeProfile(raw, id);
}
