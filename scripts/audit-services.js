#!/usr/bin/env node
/**
 * Service audit: "run" every catalogue entry once and cache what the menus need.
 *
 *   node scripts/audit-services.js              # offline-safe, regenerates icons
 *   node scripts/audit-services.js --online     # also probe each service over HTTPS
 *   node scripts/audit-services.js --check      # fail when catalog.json is stale
 *
 * The result is `data/catalog.json`: one merged, menu-ready record per service
 * (exact homepage, login URL, whether an account is required, auth domains,
 * privacy note, colour, cached icon path). Icons land in `assets/icons/<id>.*`
 * so the tab strip and the service picker paint instantly, offline, on a first
 * launch — no network round trip and no remote image load (the shell CSP only
 * allows `self` and `data:`).
 *
 * Offline is the default because a build box, CI or an air-gapped machine must
 * still be able to regenerate the catalogue: without `--online` every field is
 * derived from the data already in the repo and every icon is a generated
 * monogram in the service's brand colour. `--online` upgrades that with the
 * real favicon and the real post-redirect homepage.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const iconDir = path.join(root, 'assets', 'icons');
const catalogFile = path.join(dataDir, 'catalog.json');

const { slugify } = require(path.join(root, 'src', 'utils.js'));

const ONLINE = process.argv.includes('--online');
const CHECK = process.argv.includes('--check');
const TIMEOUT_MS = 10000;
const MAX_ICON_BYTES = 128 * 1024;
const MAX_REDIRECTS = 5;

const ICON_EXTENSIONS = ['.svg', '.png', '.ico', '.jpg', '.jpeg', '.gif', '.webp'];
const EXT_BY_MIME = {
  'image/svg+xml': '.svg',
  'image/png': '.png',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

function log(level, message) {
  const colours = { step: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m', reset: '\x1b[0m' };
  const tags = { step: 'audit', ok: ' ok ', warn: 'warn', fail: 'FAIL' };
  const colour = colours[level] || colours.reset;
  // eslint-disable-next-line no-console
  console.log(`${colour}[${tags[level] || level}]${colours.reset} ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** Readable text colour for a brand background. */
function contrastInk(hex) {
  const value = /^[0-9a-f]{6}$/i.test(hex || '') ? hex : '444444';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // Rec. 709 luma: light brands get dark ink, dark brands get light ink.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#141414' : '#ffffff';
}

/** Up to two initials, the same rule the renderer uses for its fallback. */
function initialsOf(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Deterministic monogram used offline and whenever a real favicon is missing. */
function monogramSvg(service) {
  const colour = service.color || '444444';
  const ink = contrastInk(colour);
  const text = initialsOf(service.name).replace(/[<>&"]/g, '');
  const size = text.length > 1 ? 26 : 34;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" ',
    `aria-label="${service.name.replace(/[<>&"]/g, '')}">`,
    `<rect width="64" height="64" rx="14" fill="#${colour}"/>`,
    `<text x="32" y="33" fill="${ink}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" `,
    `font-size="${size}" font-weight="600" text-anchor="middle" dominant-baseline="central">${text}</text>`,
    '</svg>',
    ''
  ].join('');
}

function existingIcon(id) {
  for (const ext of ICON_EXTENSIONS) {
    const file = path.join(iconDir, `${id}${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function removeIcons(id) {
  for (const ext of ICON_EXTENSIONS) {
    const file = path.join(iconDir, `${id}${ext}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

// ---------------------------------------------------------------------------
// Network probing (only with --online)
// ---------------------------------------------------------------------------

function request(url, { method = 'GET', maxBytes = 512 * 1024, redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch (e) {
      resolve({ ok: false, error: 'invalid-url' });
      return;
    }
    if (target.protocol !== 'https:') {
      resolve({ ok: false, error: 'not-https' });
      return;
    }

    const req = https.request(
      target,
      {
        method,
        timeout: TIMEOUT_MS,
        headers: {
          // A plain desktop UA: several services 403 an obviously scripted client.
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
          'accept-language': 'en-US,en;q=0.9'
        }
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            resolve({ ok: false, error: 'too-many-redirects', finalUrl: target.toString() });
            return;
          }
          const next = new URL(location, target).toString();
          request(next, { method, maxBytes, redirectsLeft: redirectsLeft - 1 }).then((result) =>
            resolve({ ...result, redirected: true })
          );
          return;
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            ok: status >= 200 && status < 400,
            status,
            headers: res.headers,
            finalUrl: target.toString(),
            body: Buffer.concat(chunks)
          })
        );
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', finalUrl: target.toString() });
    });
    req.on('error', (error) => resolve({ ok: false, error: error.code || error.message, finalUrl: target.toString() }));
    req.end();
  });
}

/** Icon URLs declared by the page, best (largest / most specific) first. */
function iconLinksFromHtml(html, baseUrl) {
  const links = [];
  const re = /<link\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!/\b(?:shortcut\s+)?icon\b|apple-touch-icon/i.test(rel)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || href.startsWith('data:')) continue;
    const sizes = (tag.match(/\bsizes\s*=\s*["'](\d+)x\d+["']/i) || [])[1];
    try {
      links.push({ url: new URL(href, baseUrl).toString(), size: Number(sizes) || 0 });
    } catch (e) {
      /* skip unparseable href */
    }
  }
  return links.sort((a, b) => b.size - a.size).map((entry) => entry.url);
}

/** Does the fetched page look like a sign-in wall? */
function looksSignedOut(finalUrl, html, profile) {
  const paths = (profile && profile.signed_out_paths) || [];
  try {
    const { pathname } = new URL(finalUrl);
    if (paths.some((p) => pathname.startsWith(p))) return true;
  } catch (e) {
    /* ignore */
  }
  return /sign in to continue|log in to continue|create an account to continue/i.test(html.slice(0, 20000));
}

async function probe(service, profile) {
  const homeCandidate = (profile && profile.homeUrl) || service.url;
  const page = await request(homeCandidate);

  const result = {
    checkedAt: new Date().toISOString(),
    reachable: Boolean(page.ok),
    status: page.status || null,
    error: page.error || null,
    finalUrl: page.finalUrl || homeCandidate,
    signedOutWall: null,
    iconSource: null
  };

  if (!page.ok || !page.body) return { probe: result, icon: null };

  const html = page.body.toString('utf8');
  result.signedOutWall = looksSignedOut(result.finalUrl, html, profile);

  const candidates = [...iconLinksFromHtml(html, result.finalUrl), new URL('/favicon.ico', result.finalUrl).toString()];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(candidate, { maxBytes: MAX_ICON_BYTES });
    const type = String((res.headers && res.headers['content-type']) || '').split(';')[0].trim();
    if (!res.ok || !res.body || res.body.length === 0) continue;
    if (type && !type.startsWith('image/')) continue;
    const ext = EXT_BY_MIME[type] || path.extname(new URL(candidate).pathname).toLowerCase();
    if (!ICON_EXTENSIONS.includes(ext)) continue;
    result.iconSource = candidate;
    return { probe: result, icon: { ext, buffer: res.body } };
  }

  return { probe: result, icon: null };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Domains a service is allowed to reach, from rules.json + the login profile. */
function authDomainsFor(id, rules, profile) {
  const domains = new Set();
  const serviceDomains = (rules.service_domains || {})[id] || [];
  for (const domain of serviceDomains) domains.add(domain);
  for (const domain of (profile && profile.cookie_domains) || []) domains.add(domain);
  return [...domains].sort();
}

async function build() {
  const services = readJson(path.join(dataDir, 'services.json')).ai_services || [];
  const rules = readJson(path.join(dataDir, 'rules.json'));
  const logins = readJson(path.join(dataDir, 'logins.json'));
  const adapters = readJson(path.join(dataDir, 'adapters.json'));

  const adapterIds = new Set(Object.keys(adapters.adapters || adapters.profiles || {}));
  fs.mkdirSync(iconDir, { recursive: true });

  const entries = [];
  for (const raw of services) {
    const [name, url, type, privacy, color, requiresLogin] = Array.isArray(raw)
      ? raw
      : [raw.name, raw.url, raw.type, raw.privacy, raw.color, raw.requiresLogin];
    const id = slugify(name);
    const profile = (logins.profiles || {})[id] || null;

    const entry = {
      id,
      name,
      // `homepage` is where a tab actually opens: the login profile's homeUrl
      // wins because it is the post-redirect landing page (e.g. /new, /app).
      homepage: (profile && profile.homeUrl) || url,
      catalogUrl: url,
      loginUrl: (profile && profile.loginUrl) || null,
      requiresLogin: requiresLogin !== false,
      type: type || 'AI Service',
      privacy: privacy || '',
      color: /^[0-9a-f]{6}$/i.test(color || '') ? String(color).toLowerCase() : null,
      authDomains: authDomainsFor(id, rules, profile),
      hasLoginProfile: Boolean(profile),
      hasApiAdapter: adapterIds.has(id),
      icon: null,
      iconSource: 'monogram',
      probe: null
    };

    let iconWritten = false;
    if (ONLINE) {
      log('step', `probing ${name}…`);
      // eslint-disable-next-line no-await-in-loop
      const { probe: probeResult, icon } = await probe({ ...entry, url: entry.homepage }, profile);
      entry.probe = probeResult;
      if (probeResult.finalUrl && probeResult.reachable) entry.homepage = probeResult.finalUrl;
      if (icon) {
        removeIcons(id);
        fs.writeFileSync(path.join(iconDir, `${id}${icon.ext}`), icon.buffer);
        entry.icon = `assets/icons/${id}${icon.ext}`;
        entry.iconSource = 'favicon';
        iconWritten = true;
        log('ok', `${name}: cached ${icon.buffer.length} B favicon`);
      } else {
        log('warn', `${name}: no favicon (${probeResult.error || probeResult.status || 'no icon link'})`);
      }
    }

    if (!iconWritten) {
      const cached = existingIcon(id);
      // Keep a previously downloaded real favicon; only (re)generate a monogram
      // when nothing is cached or the cached file is itself a monogram.
      if (cached && path.extname(cached) !== '.svg') {
        entry.icon = `assets/icons/${path.basename(cached)}`;
        entry.iconSource = 'favicon';
      } else {
        fs.writeFileSync(path.join(iconDir, `${id}.svg`), monogramSvg(entry), 'utf8');
        entry.icon = `assets/icons/${id}.svg`;
        entry.iconSource = 'monogram';
      }
    }

    entries.push(entry);
  }

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/audit-services.js',
    mode: ONLINE ? 'online' : 'offline',
    comment:
      'Generated menu catalogue: one record per service with the exact homepage, ' +
      'login URL, sign-in requirement, allowed auth domains and a cached icon. ' +
      'Regenerate with `npm run services:audit` (add --online to refresh from the live sites).',
    serviceCount: entries.length,
    services: entries
  };
}

/** Compare two catalogues ignoring volatile fields (timestamps, probe output). */
function stableShape(catalog) {
  return JSON.stringify(
    (catalog.services || []).map((entry) => ({ ...entry, probe: undefined })),
    null,
    2
  );
}

async function main() {
  const catalog = await build();

  if (CHECK) {
    if (!fs.existsSync(catalogFile)) {
      log('fail', 'data/catalog.json is missing — run `npm run services:audit`');
      process.exit(1);
    }
    const current = readJson(catalogFile);
    if (stableShape(current) !== stableShape(catalog)) {
      log('fail', 'data/catalog.json is stale — run `npm run services:audit`');
      process.exit(1);
    }
    log('ok', `catalogue is up to date (${catalog.serviceCount} services)`);
    return;
  }

  // Preserve the previous probe data when running offline, so an offline
  // regeneration never throws away what an earlier --online run learned.
  if (!ONLINE && fs.existsSync(catalogFile)) {
    const previous = readJson(catalogFile);
    const byId = new Map((previous.services || []).map((entry) => [entry.id, entry]));
    for (const entry of catalog.services) {
      const old = byId.get(entry.id);
      if (old && old.probe) entry.probe = old.probe;
    }
  }

  catalog.generatedAt = new Date().toISOString();
  fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  const needLogin = catalog.services.filter((entry) => entry.requiresLogin).length;
  log('ok', `wrote data/catalog.json — ${catalog.serviceCount} services, ${needLogin} require a sign-in`);
  log('ok', `icons cached in assets/icons (${ONLINE ? 'live favicons where reachable' : 'offline monograms'})`);
  if (!ONLINE) log('step', 'run with --online to refresh real favicons and homepages');
}

main().catch((error) => {
  log('fail', error.stack || error.message);
  process.exit(1);
});
