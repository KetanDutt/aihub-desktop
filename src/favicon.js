/**
 * Favicon resolver.
 *
 * The shell UI cannot load remote images (its CSP is locked to `self`), so
 * favicons are fetched in the main process and handed to the renderer as data
 * URLs. Results are cached in memory and on disk so a tab strip renders
 * instantly after a restart.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const log = require('electron-log');
const paths = require('./paths');
const { LIMITS, STALE_DATA_MS } = require('./constants');

const memoryCache = new Map(); // origin -> dataUrl
const inflight = new Map(); // origin -> Promise<dataUrl|null>

const MIME_BY_EXT = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function guessMime(url, contentType) {
  if (contentType && contentType.startsWith('image/')) return contentType.split(';')[0].trim();
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return MIME_BY_EXT[ext] || 'image/x-icon';
}

function cacheKey(origin) {
  return `${crypto.createHash('sha1').update(origin).digest('hex')}.img`;
}

function evictIfNeeded() {
  while (memoryCache.size > LIMITS.FAVICON_CACHE_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
}

/** GET a small binary with a hard size/time cap. Resolves to a Buffer or null. */
function fetchBinary(url) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch (e) {
      resolve(null);
      return;
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      resolve(null);
      return;
    }

    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.get(
      target,
      { timeout: LIMITS.FAVICON_TIMEOUT_MS, headers: { accept: 'image/*,*/*;q=0.8' } },
      (response) => {
        const status = response.statusCode || 0;
        if (status !== 200) {
          response.resume();
          resolve(null);
          return;
        }

        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > LIMITS.FAVICON_MAX_BYTES) {
            request.destroy();
            resolve(null);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: response.headers['content-type'] || ''
          })
        );
      }
    );

    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

function originOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch (e) {
    return null;
  }
}

async function readDiskCache(origin) {
  try {
    const dir = paths.faviconCacheDir();
    const file = path.join(dir, cacheKey(origin));
    if (!fs.existsSync(file)) return null;
    const stat = await fsp.stat(file);
    if (Date.now() - stat.mtimeMs > STALE_DATA_MS) return null;
    const buffer = await fsp.readFile(file);
    const mimeFile = `${file}.mime`;
    const contentType = fs.existsSync(mimeFile) ? await fsp.readFile(mimeFile, 'utf8') : 'image/x-icon';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

async function writeDiskCache(origin, dataUrl) {
  try {
    const dir = paths.faviconCacheDir();
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, cacheKey(origin));
    const [meta, base64] = dataUrl.split(',');
    const mime = meta.replace('data:', '').replace(';base64', '');
    await fsp.writeFile(file, Buffer.from(base64, 'base64'));
    await fsp.writeFile(`${file}.mime`, mime, 'utf8');
  } catch (e) {
    log.debug('Favicon cache write failed:', e.message);
  }
}

async function resolveFavicon(url) {
  const origin = originOf(url);
  if (!origin) return null;

  if (memoryCache.has(origin)) {
    // Refresh LRU position.
    const cached = memoryCache.get(origin);
    memoryCache.delete(origin);
    memoryCache.set(origin, cached);
    return cached;
  }

  if (inflight.has(origin)) return inflight.get(origin);

  const task = (async () => {
    const fromDisk = await readDiskCache(origin);
    if (fromDisk) {
      memoryCache.set(origin, fromDisk);
      evictIfNeeded();
      return fromDisk;
    }

    const candidates = [`${origin}/favicon.ico`, `${origin}/favicon.png`];
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const result = await fetchBinary(candidate);
      if (result && result.buffer && result.buffer.length > 0) {
        const dataUrl = `data:${guessMime(candidate, result.contentType)};base64,${result.buffer.toString('base64')}`;
        memoryCache.set(origin, dataUrl);
        evictIfNeeded();
        writeDiskCache(origin, dataUrl).catch(() => {});
        return dataUrl;
      }
    }

    // Negative caching: remember the miss so we do not retry on every render.
    memoryCache.set(origin, null);
    evictIfNeeded();
    return null;
  })();

  inflight.set(origin, task);
  try {
    return await task;
  } finally {
    inflight.delete(origin);
  }
}

/** IPC-friendly wrapper: never throws. */
async function getFavicon(url) {
  try {
    return { dataUrl: await resolveFavicon(url) };
  } catch (e) {
    log.debug('Favicon lookup failed:', e.message);
    return { dataUrl: null };
  }
}

/** Drop every cached favicon (used by "Clear session data"). */
async function clearCache() {
  memoryCache.clear();
  try {
    const dir = paths.faviconCacheDir();
    if (fs.existsSync(dir)) {
      for (const file of await fsp.readdir(dir)) {
        await fsp.unlink(path.join(dir, file)).catch(() => {});
      }
    }
  } catch (e) {
    log.debug('Favicon cache clear failed:', e.message);
  }
}

/** Test helper. */
function _resetForTests() {
  memoryCache.clear();
  inflight.clear();
}

module.exports = {
  getFavicon,
  resolveFavicon,
  clearCache,
  originOf,
  _resetForTests
};
