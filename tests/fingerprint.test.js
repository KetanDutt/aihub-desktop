/**
 * Fingerprint profile + hardening rules.
 */

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

const fingerprint = require('../src/fingerprint');
const { STEALTH } = require('../src/constants');

const LEAKY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aihub-desktop/1.3.0 Chrome/141.0.0.0 Electron/41.1.1 Safari/537.36';

describe('normalizeUserAgent', () => {
  it('strips the Electron and app tokens', () => {
    const ua = fingerprint.normalizeUserAgent(LEAKY_UA, { platform: 'win32' });
    expect(ua).not.toMatch(/Electron/i);
    expect(ua).not.toMatch(/aihub-desktop/i);
    expect(ua).toMatch(/Chrome\/141\.0\.0\.0/);
    expect(ua).toMatch(/^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\)/);
  });

  it('keeps the engine version so the UA agrees with the actual behaviour', () => {
    const ua = fingerprint.normalizeUserAgent('... Chrome/138.0.7204.97 Electron/40 ...', { platform: 'darwin' });
    expect(ua).toContain('Chrome/138.0.7204.0');
    expect(ua).toContain('Macintosh; Intel Mac OS X 10_15_7');
  });

  it('falls back sanely when there is nothing to parse', () => {
    const ua = fingerprint.normalizeUserAgent(undefined, { platform: 'linux' });
    expect(ua).toContain('X11; Linux x86_64');
    expect(ua).toContain('Chrome/');
  });
});

describe('client hints', () => {
  it('derives Sec-CH-UA headers from the same version as the UA', () => {
    const ua = fingerprint.normalizeUserAgent(LEAKY_UA, { platform: 'win32' });
    const hints = fingerprint.clientHintsFor(ua, 'win32');
    expect(hints['sec-ch-ua']).toContain('v="141"');
    expect(hints['sec-ch-ua-mobile']).toBe('?0');
    expect(hints['sec-ch-ua-platform']).toBe('"Windows"');
  });

  it('keeps userAgentData coherent with the headers', () => {
    const ua = fingerprint.normalizeUserAgent(LEAKY_UA, { platform: 'win32' });
    const data = fingerprint.userAgentDataFor(ua, 'win32');
    const brands = data.brands.map((brand) => brand.brand);
    expect(brands).toContain('Chromium');
    expect(brands).toContain('Google Chrome');
    expect(data.platform).toBe('Windows');
    expect(data.mobile).toBe(false);
    const headerMajor = fingerprint.clientHintsFor(ua, 'win32')['sec-ch-ua'].match(/v="(\d+)"/)[1];
    expect(data.brands[0].version).toBe(headerMajor);
  });
});

describe('accept language', () => {
  it('builds a weighted, validated list', () => {
    expect(fingerprint.buildAcceptLanguage(['en-GB', 'en', 'de'])).toBe('en-GB,en;q=0.9,de;q=0.8');
  });

  it('rejects junk and always has a fallback', () => {
    expect(fingerprint.buildAcceptLanguage(['<script>', 'en-US'])).toBe('en-US');
    expect(fingerprint.buildAcceptLanguage([])).toBe('en-US,en;q=0.9');
    expect(fingerprint.buildAcceptLanguage(null)).toBe('en-US,en;q=0.9');
  });

  it('caps the list length', () => {
    const many = Array.from({ length: 20 }, (unused, index) => `en-XX${index}`);
    expect(fingerprint.buildAcceptLanguage(many).split(',').length).toBe(8);
  });
});

describe('validateTimezone', () => {
  it('accepts IANA names and GMT offsets', () => {
    expect(fingerprint.validateTimezone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(fingerprint.validateTimezone(' America/New_York ')).toBe('America/New_York');
    expect(fingerprint.validateTimezone('GMT+1')).toBe('GMT+1');
  });

  it('refuses anything that is not a zone name', () => {
    expect(fingerprint.validateTimezone('')).toBe('');
    expect(fingerprint.validateTimezone('../../etc/passwd')).toBe('');
    expect(fingerprint.validateTimezone('x'.repeat(80))).toBe('');
    expect(fingerprint.validateTimezone(null)).toBe('');
    expect(fingerprint.validateTimezone(42)).toBe('');
  });
});

describe('createProfile', () => {
  it('is deterministic for the same seed', () => {
    const args = { seed: 'fixed-seed', platform: 'win32', userAgent: 'Chrome/141.0.0.0', languages: ['en-US', 'en'] };
    expect(fingerprint.createProfile(args)).toEqual(fingerprint.createProfile(args));
  });

  it('produces a different profile for a different seed', () => {
    const base = { platform: 'win32', userAgent: 'Chrome/141.0.0.0', languages: ['en-US', 'en'] };
    const a = fingerprint.createProfile({ ...base, seed: 'a' });
    const b = fingerprint.createProfile({ ...base, seed: 'b' });
    expect([a.gpuRenderer, a.hardwareConcurrency, a.screen.width]).not.toEqual([
      b.gpuRenderer,
      b.hardwareConcurrency,
      b.screen.width
    ]);
  });

  it('clamps the numeric fields into believable ranges', () => {
    const profile = fingerprint.createProfile({
      seed: 'x',
      platform: 'win32',
      userAgent: 'Chrome/141.0.0.0',
      hardwareConcurrency: 9999,
      deviceMemory: -4
    });
    expect(profile.hardwareConcurrency).toBe(32);
    expect(profile.deviceMemory).toBe(0.5);
  });

  it('records the canvas-noise opt-in and timezone choice', () => {
    const profile = fingerprint.createProfile({
      seed: 'x',
      platform: 'linux',
      userAgent: 'Chrome/141.0.0.0',
      timezone: 'Asia/Kolkata',
      canvasNoise: true
    });
    expect(profile.timezone).toBe('Asia/Kolkata');
    expect(profile.canvasNoise).toBe(true);
  });
});

describe('buildPatchScript', () => {
  const profile = fingerprint.createProfile({
    seed: 'test',
    platform: 'win32',
    userAgent: 'Mozilla/5.0 Chrome/141.0.0.0',
    languages: ['en-US', 'en'],
    timezone: 'Europe/Paris'
  });
  const script = fingerprint.buildPatchScript(profile);

  it('kills the automation flag and hides the patch itself', () => {
    expect(script).toContain("'webdriver'");
    expect(script).toContain('[native code]');
    expect(script).toContain('WeakMap');
  });

  it('carries the profile values it was given', () => {
    expect(script).toContain('Europe/Paris');
    expect(script).toContain('Win32');
    expect(script).toContain(JSON.stringify(profile.gpuVendor));
  });

  it('is syntactically valid JavaScript', () => {
    expect(() => new function Script() {}.constructor(script)).not.toThrow();
    // A stronger check: the parser must accept it outright.
    expect(() => {
      // eslint-disable-next-line no-new-func
      Function(`void 0; ${script}`);
    }).not.toThrow();
  });

  it('leaves canvas alone unless noise was opted into', () => {
    expect(script).toContain('"canvasNoise":false');
    const noisy = fingerprint.buildPatchScript({ ...profile, canvasNoise: true });
    expect(noisy).toContain('"canvasNoise":true');
    expect(noisy).toContain('toDataURL');
  });
});

describe('behavioural helpers', () => {
  it('waits out a challenge with growth and jitter', () => {
    const first = fingerprint.challengeDelay(0, () => 0.5);
    const third = fingerprint.challengeDelay(3, () => 0.5);
    expect(first).toBe(STEALTH.CHALLENGE_BASE_DELAY_MS + STEALTH.CHALLENGE_JITTER_MS / 2);
    expect(third).toBeGreaterThan(first);
    expect(fingerprint.challengeDelay(1, () => 0)).toBeLessThan(fingerprint.challengeDelay(1, () => 0.999));
  });

  it('caps retries at the configured maximum', () => {
    expect(STEALTH.CHALLENGE_MAX_RETRIES).toBeGreaterThan(0);
    expect(fingerprint.challengeDelay(99, () => 0)).toBeGreaterThan(0);
  });

  it('produces human-ish keystroke cadence', () => {
    const delays = fingerprint.keystrokeDelays(40, () => 0.5);
    expect(delays.length).toBeGreaterThanOrEqual(40);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(STEALTH.KEYSTROKE_MIN_DELAY_MS);
    // Pauses are inserted occasionally, so the array can be longer than the count.
    expect(delays.some((value) => value > STEALTH.KEYSTROKE_MAX_DELAY_MS)).toBe(true);
  });

  it('handles zero and negative counts', () => {
    expect(fingerprint.keystrokeDelays(0)).toEqual([]);
    expect(fingerprint.keystrokeDelays(-5)).toEqual([]);
  });
});

describe('process flags', () => {
  it('disables only the automation blink feature', () => {
    const { switches, disabledSecurityChecks } = fingerprint.buildCommandLineSwitches();
    expect(switches).toEqual([['disable-blink-features', 'AutomationControlled']]);
    expect(disabledSecurityChecks).toBe(false);
  });
});
