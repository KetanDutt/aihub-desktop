/**
 * Session store — the "stay signed in" layer.
 *
 * Responsibilities:
 *  - resolve the Chromium session a service runs in (shared by default, or a
 *    dedicated `persist:aihub-<id>` partition when sessions are isolated);
 *  - keep a local snapshot of every service's cookies so a restart, a crashed
 *    renderer or a Chromium cache wipe cannot sign the user out;
 *  - re-stamp session cookies with a bounded expiry (Chromium otherwise drops
 *    them at exit — the classic "logged out after restart" bug);
 *  - restore that snapshot on launch, *before* the first tab navigates;
 *  - refresh long-idle sessions with a background keep-alive ping.
 *
 * Cookie values are secrets: they are written 0600 inside the user data
 * directory, encrypted with the OS keychain (`safeStorage`) when it is
 * available, and they are never passed to the renderer — only counts and
 * timestamps are.
 */

const fs = require('fs');
const path = require('path');
const { session, safeStorage, app } = require('electron');
const log = require('electron-log');

const configStore = require('./config');
const paths = require('./paths');
const cookieOps = require('./cookies');
const { STORAGE, SESSION } = require('./constants');
const { normalizeHostname, isSafeHttpUrl } = require('./utils');
const { normalizeProfile } = require('./loginstate');

const MAGIC = 'AIE1';

/** serviceId -> profile (from data/logins.json) */
let profiles = new Map();
let defaultProfile = null;
let loaded = false;

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (stat.size === 0 || stat.size > 2 * 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    log.warn(`Unable to read ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Load login fingerprints: the bundled file, optionally overridden by a copy in
 * the user data directory (so power users can fix a rotated cookie name without
 * patching the app).
 */
function loadProfiles({ force = false } = {}) {
  if (loaded && !force) return profiles;

  const payload =
    readJson(path.join(paths.userDataDir(), STORAGE.LOCAL_LOGINS_FILENAME)) ||
    readJson(path.join(paths.bundledDataDir(), STORAGE.LOCAL_LOGINS_FILENAME)) ||
    {};

  profiles = new Map();
  const entries = payload.profiles && typeof payload.profiles === 'object' ? payload.profiles : {};
  for (const [rawId, raw] of Object.entries(entries)) {
    const id = String(rawId).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!id) continue;
    const profile = normalizeProfile(raw, id);
    if (profile) profiles.set(id, profile);
  }
  defaultProfile = normalizeProfile(payload.default, '');
  loaded = true;

  log.debug(`Login fingerprints loaded for ${profiles.size} services`);
  return profiles;
}

function profileFor(serviceId) {
  loadProfiles();
  const exact = profiles.get(serviceId);
  if (exact) return exact;
  // A service we have no fingerprint for still gets the generic one, so login
  // detection degrades to "cookie that looks like a session token" instead of
  // reporting nothing at all.
  return defaultProfile ? { ...defaultProfile, serviceId } : null;
}

// ---------------------------------------------------------------------------
// Sessions / partitions
// ---------------------------------------------------------------------------

/**
 * The partition a service's data lives in. Isolation is opt-in: sharing one jar
 * is what makes Google/Microsoft SSO work across services.
 */
function partitionFor(serviceId) {
  const config = configStore.getConfig();
  if (!config.isolateSessions) return null;
  const id = String(serviceId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return id ? `${SESSION.PARTITION_PREFIX}${id}` : null;
}

/** @returns {Electron.Session} */
function sessionFor(serviceId) {
  const partition = partitionFor(serviceId);
  if (!partition) return session.defaultSession;
  try {
    return session.fromPartition(partition);
  } catch (error) {
    log.warn(`Unable to open partition ${partition}: ${error.message}`);
    return session.defaultSession;
  }
}

/** Every origin a service's cookies may live on. */
function cookieDomainsFor(serviceId, service) {
  const profile = profileFor(serviceId);
  const domains = new Set();
  for (const domain of (profile && profile.cookieDomains) || []) domains.add(domain);
  const host = normalizeHostname((service && service.url) || '');
  if (host) domains.add(host);
  if (domains.size === 0 && serviceId) domains.add(`${serviceId}.com`);
  return [...domains].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Disk layout
// ---------------------------------------------------------------------------

function sessionsDir() {
  return path.join(paths.userDataDir(), STORAGE.SESSIONS_DIRNAME);
}

function cookieFilePath(serviceId) {
  return path.join(sessionsDir(), `${serviceId}${STORAGE.SESSION_COOKIE_SUFFIX}`);
}

function indexPath() {
  return path.join(sessionsDir(), STORAGE.SESSION_INDEX_FILENAME);
}

function writePrivate(filePath, contents) {
  paths.ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (e) {
    /* Windows: the ACL already restricts the profile directory */
  }
}

function encrypt(json) {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return Buffer.concat([Buffer.from(`${MAGIC}\n`, 'utf8'), safeStorage.encryptString(json)]);
    }
  } catch (error) {
    log.debug(`safeStorage unavailable, storing snapshot unencrypted: ${error.message}`);
  }
  return Buffer.from(json, 'utf8');
}

function decrypt(buffer) {
  const text = buffer.toString('utf8');
  if (!text.startsWith(`${MAGIC}\n`)) return JSON.parse(text);
  const payload = buffer.subarray(MAGIC.length + 1);
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error('snapshot is encrypted but the OS keychain is unavailable');
  }
  return JSON.parse(safeStorage.decryptString(payload));
}

function readIndex() {
  try {
    const raw = readJson(indexPath());
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

function writeIndex(index) {
  try {
    writePrivate(indexPath(), Buffer.from(JSON.stringify(index, null, 2), 'utf8'));
  } catch (error) {
    log.warn(`Unable to write the session index: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Cookie read / write
// ---------------------------------------------------------------------------

/**
 * Read every cookie that belongs to a service.
 * @returns {Promise<object[]>}
 */
async function readCookies(serviceId, service = null) {
  const ses = sessionFor(serviceId);
  if (!ses || !ses.cookies) return [];

  const domains = cookieDomainsFor(serviceId, service);
  const collected = new Map();

  for (const domain of domains) {
    try {
      // `domain` matching in Chromium includes subdomains, which is what we want.
      // eslint-disable-next-line no-await-in-loop
      const cookies = await ses.cookies.get({ domain });
      for (const cookie of cookies || []) {
        collected.set(cookieOps.cookieKey(cookie), {
          ...cookie,
          sessionOnly: cookie.expirationDate === undefined || cookie.expirationDate === null
        });
      }
    } catch (error) {
      log.debug(`Cookie read failed for ${domain}: ${error.message}`);
    }
  }

  return [...collected.values()];
}

/**
 * Pin session cookies in the live jar so Chromium persists them itself, then
 * write our own snapshot.
 *
 * @returns {Promise<{saved: number, pinned: number, dropped: number}>}
 */
async function snapshotService(serviceId, service = null) {
  const ses = sessionFor(serviceId);
  if (!ses || !ses.cookies) return { saved: 0, pinned: 0, dropped: 0 };

  const live = await readCookies(serviceId, service);
  const pinned = [];
  let pinCount = 0;

  for (const cookie of live) {
    const normalized = cookieOps.normalizeCookie(cookie);
    if (!normalized) continue;
    const next = cookieOps.pinCookie(normalized);
    if (next._pinned) pinCount += 1;
    pinned.push(next);
  }

  const { entries, dropped } = cookieOps.prepareSnapshot(pinned);

  // Re-set the pinned session cookies so Chromium's own store has them too.
  for (const cookie of pinned) {
    if (!cookie._pinned) continue;
    try {
      await ses.cookies.set({
        url: cookieUrlFor(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite
      });
    } catch (error) {
      log.debug(`Unable to pin ${cookie.name}: ${error.message}`);
    }
  }

  try {
    const payload = JSON.stringify({
      serviceId,
      partition: partitionFor(serviceId),
      savedAt: new Date().toISOString(),
      cookies: entries
    });
    writePrivate(cookieFilePath(serviceId), encrypt(payload));

    const index = readIndex();
    index[serviceId] = {
      savedAt: new Date().toISOString(),
      count: entries.length,
      pinned: pinCount,
      dropped,
      partition: partitionFor(serviceId)
    };
    writeIndex(index);
  } catch (error) {
    log.warn(`Unable to snapshot cookies for ${serviceId}: ${error.message}`);
  }

  return { saved: entries.length, pinned: pinCount, dropped };
}

/** Chromium needs a URL to scope the write; `__Secure-` cookies need https. */
function cookieUrlFor(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  return `${cookie.secure === false && domain ? 'http' : 'https'}://${domain || 'localhost'}`;
}

/**
 * Replay a snapshot into the live jar. Called once at startup for every service
 * that has a tab or is enabled, before any navigation happens.
 *
 * @returns {Promise<{serviceId: string, restored: number, skipped: number}>}
 */
async function restoreService(serviceId, service = null) {
  const ses = sessionFor(serviceId);
  if (!ses || !ses.cookies) return { serviceId, restored: 0, skipped: 0 };

  let file;
  try {
    file = cookieFilePath(serviceId);
    if (!fs.existsSync(file)) return { serviceId, restored: 0, skipped: 0 };
  } catch (e) {
    return { serviceId, restored: 0, skipped: 0 };
  }

  let snapshot;
  try {
    snapshot = decrypt(fs.readFileSync(file));
  } catch (error) {
    log.warn(`Unable to decrypt the ${serviceId} session snapshot: ${error.message}`);
    return { serviceId, restored: 0, skipped: 0 };
  }

  const saved = Array.isArray(snapshot && snapshot.cookies) ? snapshot.cookies : [];
  if (saved.length === 0) return { serviceId, restored: 0, skipped: 0 };

  const live = await readCookies(serviceId, service);
  const { toRestore } = cookieOps.mergeCookies(live, saved);

  let restored = 0;
  let skipped = 0;
  for (const cookie of toRestore) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await ses.cookies.set({
        url: cookieUrlFor(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite
      });
      restored += 1;
    } catch (error) {
      // A `Secure` cookie replayed onto an http origin, an expired host-only
      // cookie, … — losing one cookie must not lose the whole session.
      skipped += 1;
      log.debug(`Skipped ${cookie.name} for ${serviceId}: ${error.message}`);
    }
  }

  if (restored > 0) log.info(`Restored ${restored} cached cookie(s) for ${serviceId}`);
  return { serviceId, restored, skipped };
}

/** Restore every service we have a snapshot for. */
async function restoreAll(services = []) {
  if (!configStore.getConfigItem('sessionPersistence', true)) {
    return { restored: 0, services: [], skipped: true };
  }

  const byId = new Map(services.map((service) => [service.id, service]));
  const results = [];
  for (const serviceId of listSnapshots()) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await restoreService(serviceId, byId.get(serviceId)));
  }

  return {
    restored: results.reduce((sum, result) => sum + result.restored, 0),
    services: results
  };
}

/** Snapshot every service that currently has cookies on file or an open tab. */
async function snapshotAll(services = []) {
  if (!configStore.getConfigItem('sessionPersistence', true)) return { saved: 0 };

  const byId = new Map(services.map((service) => [service.id, service]));
  const ids = new Set([...listSnapshots(), ...byId.keys()]);
  let saved = 0;

  for (const serviceId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await snapshotService(serviceId, byId.get(serviceId));
      saved += result.saved;
    } catch (error) {
      log.debug(`Snapshot failed for ${serviceId}: ${error.message}`);
    }
  }

  return { saved };
}

function listSnapshots() {
  try {
    const dir = sessionsDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(STORAGE.SESSION_COOKIE_SUFFIX))
      .map((name) => name.slice(0, -STORAGE.SESSION_COOKIE_SUFFIX.length))
      .filter((name) => /^[a-z0-9]+$/.test(name));
  } catch (e) {
    return [];
  }
}

/**
 * Delete a service's cached login material: the live jar *and* the snapshot, so
 * "sign this service out" really signs it out.
 */
async function clearService(serviceId) {
  const ses = sessionFor(serviceId);
  const domains = cookieDomainsFor(serviceId);
  let cleared = 0;

  for (const domain of domains) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const cookies = await ses.cookies.get({ domain });
      for (const cookie of cookies || []) {
        const scheme = cookie.secure ? 'https' : 'http';
        const host = String(cookie.domain || '').replace(/^\./, '');
        try {
          // eslint-disable-next-line no-await-in-loop
          await ses.cookies.remove(`${scheme}://${host}${cookie.path || '/'}`, cookie.name);
          cleared += 1;
        } catch (e) {
          /* already gone */
        }
      }
    } catch (error) {
      log.debug(`Cookie enumeration failed for ${domain}: ${error.message}`);
    }
  }

  try {
    if (typeof ses.clearStorageData === 'function' && partitionFor(serviceId)) {
      await ses.clearStorageData({
        storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      });
    }
  } catch (error) {
    log.debug(`Storage wipe skipped for ${serviceId}: ${error.message}`);
  }

  try {
    fs.rmSync(cookieFilePath(serviceId), { force: true });
    const index = readIndex();
    delete index[serviceId];
    writeIndex(index);
  } catch (error) {
    log.debug(`Unable to drop the snapshot for ${serviceId}: ${error.message}`);
  }

  return { serviceId, cleared };
}

/**
 * Refresh a session in the background: a same-origin GET with credentials makes
 * the service roll its own token forward, after which we re-pin + snapshot.
 *
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
async function touchService(serviceId, service) {
  const profile = profileFor(serviceId);
  const target = (profile && (profile.homeUrl || profile.loginUrl)) || (service && service.url);
  if (!isSafeHttpUrl(target)) return { ok: false, error: 'no-target' };

  const ses = sessionFor(serviceId);
  if (!ses || typeof ses.fetch !== 'function') return { ok: false, error: 'no-session-fetch' };

  try {
    const response = await ses.fetch(target, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
    });
    // Drain so the socket is released.
    try {
      await response.text();
    } catch (e) {
      /* body already consumed / aborted */
    }
    await snapshotService(serviceId, service);
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** Per-service sizes for the Sessions panel. */
async function getStats(serviceId, service) {
  const cookies = await readCookies(serviceId, service);
  const summary = cookieOps.summarise(cookies);
  const index = readIndex()[serviceId] || null;
  const ses = sessionFor(serviceId);

  let cacheSize = null;
  try {
    if (ses && typeof ses.getCacheSize === 'function') {
      cacheSize = await ses.getCacheSize();
    }
  } catch (e) {
    cacheSize = null;
  }

  return {
    serviceId,
    partition: partitionFor(serviceId) || 'default',
    isolated: Boolean(partitionFor(serviceId)),
    cookies: summary.count,
    authCookies: summary.auth,
    // The live jar has no idea which cookies we had to re-stamp; the snapshot
    // index does, and that is the number the UI should show.
    pinned: index && typeof index.pinned === 'number' ? index.pinned : summary.pinned,
    expiresAt: summary.expiresAt,
    lastSnapshotAt: index ? index.savedAt : null,
    snapshotCount: index ? index.count : 0,
    cacheSize,
    userDataPath: (() => {
      try {
        return app.getPath('userData');
      } catch (e) {
        return paths.userDataDir();
      }
    })()
  };
}

function hasSnapshot(serviceId) {
  try {
    return fs.existsSync(cookieFilePath(serviceId));
  } catch (e) {
    return false;
  }
}

/** Test helper. */
function _resetForTests() {
  profiles = new Map();
  defaultProfile = null;
  loaded = false;
}

module.exports = {
  loadProfiles,
  profileFor,
  partitionFor,
  sessionFor,
  cookieDomainsFor,
  readCookies,
  snapshotService,
  snapshotAll,
  restoreService,
  restoreAll,
  clearService,
  touchService,
  getStats,
  listSnapshots,
  hasSnapshot,
  cookieFilePath,
  sessionsDir,
  _resetForTests
};
