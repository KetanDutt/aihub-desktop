/**
 * Fingerprint profile derivation (pure).
 *
 * Electron leaks an unmistakable identity: the UA carries `Electron/41.0.0`,
 * `navigator.userAgentData` claims a brand nobody ships, Blink flips
 * `navigator.webdriver` on under automation, and the locale/timezone drift with
 * the machine. This module turns that into one small, *stable* profile object
 * that `src/stealth.js` applies to the session, the request headers and the
 * renderer.
 *
 * Stability matters as much as the mask: services flag accounts whose
 * fingerprint keeps changing, and a rotating fingerprint also breaks the cached
 * logins from `src/sessionstore.js`. The profile is therefore derived from a
 * persisted seed, not from `Math.random()` at every launch.
 */

const { STEALTH } = require('./constants');

// Brands a desktop Chrome advertises, in the order the header lists them.
const DEFAULT_BRAND_ORDER = ['Chromium', 'Google Chrome', 'Not_A Brand'];

const PLATFORM_LABELS = {
  win32: { name: 'Windows', ua: 'Windows NT 10.0; Win64; x64', navigatorPlatform: 'Win32' },
  darwin: { name: 'macOS', ua: 'Macintosh; Intel Mac OS X 10_15_7', navigatorPlatform: 'MacIntel' },
  linux: { name: 'Linux', ua: 'X11; Linux x86_64', navigatorPlatform: 'Linux x86_64' },
  freebsd: { name: 'Linux', ua: 'X11; FreeBSD amd64', navigatorPlatform: 'Linux x86_64' }
};

/** GPUs/CPUs that are common enough not to stand out; picked by the seed. */
const GPU_POOL = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' }
];

const SCREEN_POOL = [
  { width: 1920, height: 1080, availWidth: 1920, availHeight: 1032 },
  { width: 2560, height: 1440, availWidth: 2560, availHeight: 1392 },
  { width: 1536, height: 864, availWidth: 1536, availHeight: 816 },
  { width: 1440, height: 900, availWidth: 1440, availHeight: 850 }
];

/** FNV-1a: a tiny, dependency-free, *deterministic* hash. */
function hash32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic PRNG (mulberry32) so a seed always yields the same profile. */
function rngFromSeed(seed) {
  let state = (Number.isFinite(seed) ? seed : hash32(String(seed))) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `Europe/Kyiv`, `America/New_York`, `GMT`, `GMT+1`, `GMT-05:30` — and nothing
// with a dot, slash-dot or quote in it, because this string reaches
// `Emulation.setTimezoneOverride` and `Intl.DateTimeFormat`.
const IANA_TZ = /^[A-Za-z]{1,32}(?:[/_][A-Za-z0-9+_-]{1,64}){0,4}(?:[+-]\d{1,2}(?::\d{2})?)?$/;

/**
 * The `Sec-CH-UA` brand list. One source of truth for both the header and
 * `navigator.userAgentData`, because a mismatch between the two is precisely
 * what a detector looks for.
 */
function brandList(major) {
  return DEFAULT_BRAND_ORDER.map((brand, index) => `"${brand}";v="${index === DEFAULT_BRAND_ORDER.length - 1 ? '24' : major}"`).join(', ');
}

/** Validate a user supplied IANA timezone (`Europe/Berlin`, `GMT+1`). */
function validateTimezone(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 64) return '';
  return IANA_TZ.test(trimmed) ? trimmed : '';
}

/** `en-US,en;q=0.9` from a language list. */
function buildAcceptLanguage(languages) {
  const list = (Array.isArray(languages) ? languages : [])
    .filter((entry) => typeof entry === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(entry.trim()))
    .map((entry) => entry.trim());
  const unique = [...new Set(list.length > 0 ? list : ['en-US', 'en'])].slice(0, 8);
  return unique
    .map((code, index) => (index === 0 ? code : `${code};q=${(1 - index * 0.1).toFixed(1)}`))
    .join(',');
}

/** Primary subtag of the first language, e.g. `en-US` -> `en-US`. */
function primaryLanguage(languages) {
  const accept = buildAcceptLanguage(languages);
  return accept.split(',')[0].trim();
}

/**
 * Strip the Electron/app identity from a Chromium UA.
 *
 * @param {string} rawUserAgent e.g. `… Chrome/141.0.0.0 Electron/41.1.1 Safari/537.36`
 * @param {object} [options]
 * @param {string} [options.chromeVersion] override (major version)
 * @param {string} [options.platform] `process.platform` value
 * @returns {string} a plausible desktop Chrome UA
 */
function normalizeUserAgent(rawUserAgent, { chromeVersion, platform } = {}) {
  const raw = typeof rawUserAgent === 'string' ? rawUserAgent : '';
  const platformInfo = PLATFORM_LABELS[platform] || PLATFORM_LABELS.linux;

  // Keep Chromium's own major version when we can read it: a UA that disagrees
  // with the engine's behaviour is a detection gift, not a mask.
  const match = raw.match(/Chrome\/(\d+)(?:\.0)?(?:\.(\d+))?/);
  const major = chromeVersion || (match ? match[1] : '141');
  const build = match && match[2] ? match[2] : '0';

  return `Mozilla/5.0 (${platformInfo.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.0 Safari/537.36`;
}

/**
 * Sec-CH-UA client hints that must accompany the UA, otherwise the request is
 * *more* suspicious than an unmasked one.
 */
function clientHintsFor(userAgent, platform) {
  const match = String(userAgent).match(/Chrome\/(\d+)/);
  const major = match ? match[1] : '141';
  const platformLabel = (PLATFORM_LABELS[platform] || PLATFORM_LABELS.linux).name;

  // Every brand containing a space must be quoted, or the header is invalid —
  // and an invalid client hint is a louder tell than a missing one.
  return {
    'sec-ch-ua': brandList(major),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${platformLabel}"`,
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform-version': '"14.0.0"'
  };
}

/** `navigator.userAgentData` shape (kept in sync with the headers above). */
function userAgentDataFor(userAgent, platform, mobileHint = false) {
  const match = String(userAgent).match(/Chrome\/(\d+)/);
  const major = match ? match[1] : '141';
  const platformInfo = PLATFORM_LABELS[platform] || PLATFORM_LABELS.linux;

  return {
    brands: DEFAULT_BRAND_ORDER.map((brand, index) => ({
      brand,
      version: index === DEFAULT_BRAND_ORDER.length - 1 ? '24' : major
    })),
    mobile: Boolean(mobileHint),
    platform: platformInfo.name
  };
}

/**
 * Build the stable profile that everything else keys off.
 *
 * @param {{seed?: string, platform?: string, userAgent?: string, languages?: string[],
 *           timezone?: string, hardwareConcurrency?: number, deviceMemory?: number,
 *           canvasNoise?: boolean}} input
 */
function createProfile(input = {}) {
  const platformKey = PLATFORM_LABELS[input.platform] ? input.platform : 'linux';
  const platformInfo = PLATFORM_LABELS[platformKey];

  const seed = typeof input.seed === 'string' && input.seed ? input.seed : 'aihub-default';
  const rng = rngFromSeed(hash32(seed));
  const gpu = GPU_POOL[Math.floor(rng() * GPU_POOL.length) % GPU_POOL.length];
  const screen = SCREEN_POOL[Math.floor(rng() * SCREEN_POOL.length) % SCREEN_POOL.length];

  const languages = Array.isArray(input.languages) && input.languages.length > 0 ? input.languages : ['en-US', 'en'];
  const userAgent = input.userAgent || '';
  const chromeMatch = String(userAgent).match(/Chrome\/(\d+)/);

  return {
    seed,
    platformKey,
    navigatorPlatform: platformInfo.navigatorPlatform,
    platformName: platformInfo.name,
    userAgent,
    chromeMajor: chromeMatch ? chromeMatch[1] : '141',
    userAgentData: userAgentDataFor(userAgent, platformKey, false),
    acceptLanguage: buildAcceptLanguage(languages),
    languages,
    language: primaryLanguage(languages),
    timezone: validateTimezone(input.timezone || ''),
    hardwareConcurrency: Number.isFinite(input.hardwareConcurrency)
      ? Math.max(2, Math.min(32, Math.round(input.hardwareConcurrency)))
      : [4, 8, 8, 12, 16][Math.floor(rng() * 5)],
    deviceMemory: Number.isFinite(input.deviceMemory)
      ? Math.max(0.5, Math.min(32, input.deviceMemory))
      : [4, 8, 8, 16][Math.floor(rng() * 4)],
    maxTouchPoints: 0,
    gpuVendor: gpu.vendor,
    gpuRenderer: gpu.renderer,
    screen: { ...screen, colorDepth: 24, pixelDepth: 24 },
    canvasNoise: Boolean(input.canvasNoise),
    // Capabilities a headless/automated renderer is usually missing.
    supports: { webgl2: true, webgpu: false, webrtc: true, notifications: true }
  };
}

/**
 * Backoff for a bot-challenge interstitial: exponential, with deterministic
 * jitter so retries never look like a metronome.
 */
function challengeDelay(attempt, rand = Math.random) {
  const base = STEALTH.CHALLENGE_BASE_DELAY_MS * 2 ** Math.max(0, attempt);
  const jitter = Math.floor(rand() * STEALTH.CHALLENGE_JITTER_MS);
  return base + jitter;
}

/** Humanised per-keystroke delays (ms) for anything we type for the user. */
function keystrokeDelays(count, rand = Math.random) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const delays = [];
  for (let i = 0; i < total; i += 1) {
    const jitter = rand();
    // Longer pauses before spaces and punctuation read as thinking time.
    const isBreakpoint = i > 0 && i % 9 === 0;
    delays.push(
      Math.round(
        STEALTH.KEYSTROKE_MIN_DELAY_MS +
          jitter * (STEALTH.KEYSTROKE_MAX_DELAY_MS - STEALTH.KEYSTROKE_MIN_DELAY_MS) +
          (isBreakpoint ? 90 + rand() * 120 : 0)
      )
    );
    if (rand() > 0.965) delays.push(Math.round(220 + rand() * 480));
  }
  return delays;
}

/**
 * The main-world patch source.
 *
 * Injected with CDP `Page.addScriptToEvaluateOnNewDocument`, so it lands
 * before any page script runs — the only ordering that actually matters for
 * `navigator.webdriver` style checks. Everything is wrapped in `try/catch` and
 * the original `Function.prototype.toString` is kept for the patched members,
 * because a detectable patch is worse than none.
 */
function buildPatchScript(profile) {
  const safe = {
    languages: profile.languages,
    language: profile.language,
    platform: profile.navigatorPlatform,
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    maxTouchPoints: profile.maxTouchPoints,
    userAgent: profile.userAgent,
    userAgentData: profile.userAgentData,
    timezone: profile.timezone || null,
    gpuVendor: profile.gpuVendor,
    gpuRenderer: profile.gpuRenderer,
    screen: profile.screen,
    canvasNoise: Boolean(profile.canvasNoise)
  };

  // Static source, single `%s` hole for a JSON-serialised profile. The page only
  // ever *reads* these values; nothing is exposed back to us.
  return `(function () {
  'use strict';
  var P = ${JSON.stringify(safe)};
  var nativeToString = Function.prototype.toString;
  var patched = new WeakMap();

  function define(obj, prop, descriptor) {
    try { Object.defineProperty(obj, prop, descriptor); } catch (e) { /* frozen host object */ }
  }

  function hide(fn, name) {
    try {
      patched.set(fn, 'function ' + name + '() { [native code] }');
    } catch (e) { /* non extensible */ }
    return fn;
  }

  try {
    Function.prototype.toString = hide(function toString() {
      var s = patched.get(this);
      return s || nativeToString.call(this);
    }, 'toString');
  } catch (e) { /* toString is not configurable here */ }

  var nav = Navigator.prototype;

  // 1. Automation flags.
  define(nav, 'webdriver', { get: function () { return false; }, configurable: true });
  try {
    delete Object.getPrototypeOf(window).cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete Object.getPrototypeOf(window).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete Object.getPrototypeOf(window).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  } catch (e) { /* nothing to delete */ }

  // 2. Locale / platform coherence.
  define(nav, 'languages', { get: function () { return P.languages.slice(); }, configurable: true });
  define(nav, 'language', { get: function () { return P.language; }, configurable: true });
  define(nav, 'platform', { get: function () { return P.platform; }, configurable: true });
  define(nav, 'hardwareConcurrency', { get: function () { return P.hardwareConcurrency; }, configurable: true });
  define(nav, 'deviceMemory', { get: function () { return P.deviceMemory; }, configurable: true });
  define(nav, 'maxTouchPoints', { get: function () { return P.maxTouchPoints; }, configurable: true });
  define(nav, 'doNotTrack', { get: function () { return null; }, configurable: true });

  // 3. Client hints, kept identical to the request headers we send.
  define(nav, 'userAgent', { get: function () { return P.userAgent; }, configurable: true });
  define(nav, 'userAgentData', {
    get: function () {
      var data = P.userAgentData;
      return {
        brands: data.brands.slice(),
        mobile: data.mobile,
        platform: data.platform,
        getHighEntropyValues: hide(function getHighEntropyValues(hints) {
          var wanted = Array.isArray(hints) ? hints : [];
          var out = { brands: data.brands.slice(), mobile: data.mobile, platform: data.platform };
          if (wanted.indexOf('platformVersion') !== -1) out.platformVersion = '14.0.0';
          if (wanted.indexOf('architecture') !== -1) out.architecture = 'x86';
          if (wanted.indexOf('bitness') !== -1) out.bitness = '64';
          if (wanted.indexOf('model') !== -1) out.model = '';
          if (wanted.indexOf('uaFullVersion') !== -1) out.uaFullVersion = data.brands[1].version + '.0.0.0';
          if (wanted.indexOf('fullVersionList') !== -1) out.fullVersionList = data.brands.map(function (b) {
            return { brand: b.brand, version: b.brand === 'Not_A Brand' ? '24.0.0.0' : b.version + '.0.0.0' };
          });
          return Promise.resolve(out);
        }, 'getHighEntropyValues')
      };
    },
    configurable: true
  });

  // 4. A real Chrome ships the PDF plugin + window.chrome.
  define(nav, 'plugins', {
    get: function () {
      var pdf = { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 0 };
      var array = [pdf];
      array.item = function (i) { return array[i] || null; };
      array.namedItem = function (name) {
        for (var i = 0; i < array.length; i += 1) { if (array[i].name === name) return array[i]; }
        return null;
      };
      array.refresh = hide(function refresh() {}, 'refresh');
      return array;
    },
    configurable: true
  });
  define(nav, 'mimeTypes', {
    get: function () {
      var pdf = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' };
      var array = [pdf];
      array.item = function (i) { return array[i] || null; };
      array.namedItem = function (type) {
        for (var i = 0; i < array.length; i += 1) { if (array[i].type === type) return array[i]; }
        return null;
      };
      return array;
    },
    configurable: true
  });

  if (typeof window.chrome === 'undefined') {
    try {
      window.chrome = {
        runtime: { onConnect: { addListener: function () {} }, onMessage: { addListener: function () {} } },
        loadTimes: hide(function loadTimes() { return {}; }, 'loadTimes'),
        csi: hide(function csi() { return {}; }, 'csi')
      };
    } catch (e) { /* sealed window */ }
  }

  // 5. Notifications: a browser without a permission prompt looks scripted.
  try {
    var originalQuery = nav.permissions && nav.permissions.query ? nav.permissions.query.bind(nav.permissions) : null;
    if (originalQuery) {
      permissions.query = hide(function query(parameters) {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, name: 'notifications', onchange: null });
        }
        return originalQuery(parameters);
      }, 'query');
    }
  } catch (e) { /* permissions unavailable */ }

  // 6. WebGL vendor strings (asked by every serious fingerprinter).
  function patchGl(proto) {
    if (!proto || !proto.getParameter) return;
    var original = proto.getParameter;
    proto.getParameter = hide(function getParameter(pname) {
      if (pname === 37445) return P.gpuVendor;
      if (pname === 37446) return P.gpuRenderer;
      if (pname === 7936) return 'WebKit';
      if (pname === 7937) return 'WebKit WebGL';
      return original.apply(this, arguments);
    }, 'getParameter');
  }
  patchGl(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
  patchGl(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);

  // 7. Screen metrics (only the read-only getters; never resize the window).
  try {
    var screenProto = Object.getPrototypeOf(window.screen);
    define(screenProto, 'width', { get: function () { return P.screen.width; }, configurable: true });
    define(screenProto, 'height', { get: function () { return P.screen.height; }, configurable: true });
    define(screenProto, 'availWidth', { get: function () { return P.screen.availWidth; }, configurable: true });
    define(screenProto, 'availHeight', { get: function () { return P.screen.availHeight; }, configurable: true });
    define(screenProto, 'colorDepth', { get: function () { return P.screen.colorDepth; }, configurable: true });
    define(screenProto, 'pixelDepth', { get: function () { return P.screen.pixelDepth; }, configurable: true });
  } catch (e) { /* screen is locked down */ }

  // 8. Optional: timezone coherence. Off unless the user picked a zone.
  if (P.timezone) {
    try {
      var tzDate = Date;
      var offsetFor = function () {
        try {
          var fmt = new Intl.DateTimeFormat('en-US', { timeZone: P.timezone, timeZoneName: 'shortOffset' });
          var parts = fmt.formatToParts(new Date()).filter(function (p) { return p.type === 'timeZoneName'; });
          var label = parts.length ? parts[0].value.replace('GMT', '') : '';
          if (!label || label === '+00:00' || label === '-00:00') return 0;
          var m = label.match(/^([+-])(\\d{1,2})(?::(\\d{2}))?$/);
          if (!m) return 0;
          var mins = (parseInt(m[2], 10) * 60) + (m[3] ? parseInt(m[3], 10) : 0);
          return (m[1] === '-' ? -1 : 1) * mins;
        } catch (e) { return 0; }
      };
      var baseOffset = tzDate.prototype.getTimezoneOffset();
      var targetOffset = -offsetFor();
      if (targetOffset !== baseOffset) {
        define(tzDate.prototype, 'getTimezoneOffset', {
          get: undefined,
          value: hide(function getTimezoneOffset() { return targetOffset; }, 'getTimezoneOffset'),
          configurable: true
        });
        var originalResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = hide(function resolvedOptions() {
          var options = originalResolved.apply(this, arguments);
          options.timeZone = P.timezone;
          return options;
        }, 'resolvedOptions');
      }
    } catch (e) { /* leave the real timezone alone */ }
  }

  // 9. Optional: canvas read-back noise. Deliberately off by default — a noisy
  //    canvas also breaks fingerprint-based *login* stability, which the app
  //    relies on. Opt in from Settings > Sessions.
  if (P.canvasNoise) {
    try {
      var toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = hide(function toDataURLPatched() {
        if (this.width > 32 && this.height > 32) {
          try {
            var ctx = this.getContext('2d');
            if (ctx) {
              var img = ctx.getImageData(0, 0, 1, 1);
              img.data[0] = (img.data[0] + 1) % 256;
              ctx.putImageData(img, 0, 0);
            }
          } catch (e) { /* tainted or unsupported */ }
        }
        return toDataURL.apply(this, arguments);
      }, 'toDataURL');
    } catch (e) { /* canvas is sealed */ }
  }
})();`;
}

/** Request headers a tab should send, derived from the profile. */
function buildRequestHeaders(profile) {
  const headers = {
    'accept-language': profile.acceptLanguage,
    ...clientHintsFor(profile.userAgent, profile.platformKey)
  };
  return headers;
}

/** Command-line switches that must be applied *before* app is ready. */
function buildCommandLineSwitches() {
  return {
    // Kills `navigator.webdriver = true` at the Blink level — the single most
    // common automation check. Applied process-wide, before any tab exists.
    switches: [['disable-blink-features', STEALTH.DISABLED_BLINK_FEATURES.join(',')]],
    // Nothing that weakens a security boundary is worth a marginal fingerprint
    // gain, so this list is intentionally short.
    disabledSecurityChecks: false
  };
}

module.exports = {
  PLATFORM_LABELS,
  GPU_POOL,
  SCREEN_POOL,
  hash32,
  rngFromSeed,
  validateTimezone,
  buildAcceptLanguage,
  primaryLanguage,
  normalizeUserAgent,
  brandList,
  clientHintsFor,
  userAgentDataFor,
  createProfile,
  challengeDelay,
  keystrokeDelays,
  buildPatchScript,
  buildRequestHeaders,
  buildCommandLineSwitches
};
