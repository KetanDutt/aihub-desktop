/**
 * Login detection: the classification rules behind "am I still signed in?".
 */

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

const loginstate = require('../src/loginstate');
const { STATE, classify, isSigninUrl, isChallengeUrl, shouldRelogin, needsKeepAlive, loginUrlFor, findSessionCookies, normalizeProfile } = loginstate;

const PROFILE = normalizeProfile(
  {
    loginUrl: 'https://chatgpt.com/auth/login',
    cookie_domains: ['chatgpt.com'],
    session_cookies: ['__Secure-next-auth.session-token', 'oai-client-info'],
    signed_out_paths: ['/auth/login'],
    loggedInSelector: '#user-menu-button',
    signedOutSelector: '[data-testid="login-button"]'
  },
  'chatgpt'
);

const sessionCookie = (name = '__Secure-next-auth.session-token', overrides = {}) => ({
  name,
  value: 'opaque-token',
  domain: 'chatgpt.com',
  path: '/',
  expirationDate: Math.floor(Date.now() / 1000) + 86400,
  ...overrides
});

describe('classify', () => {
  it('trusts a live session cookie', () => {
    const verdict = classify({
      url: 'https://chatgpt.com/c/abc',
      cookies: [sessionCookie()],
      profile: PROFILE
    });
    expect(verdict.state).toBe(STATE.LOGGED_IN);
    expect(verdict.reason).toBe('session-cookie');
    expect(verdict.confidence).toBeGreaterThan(0.8);
  });

  it('boosts confidence when the DOM agrees', () => {
    const verdict = classify({
      url: 'https://chatgpt.com/c/abc',
      cookies: [sessionCookie()],
      probe: { selectorFound: true, signedOutFound: false },
      profile: PROFILE
    });
    expect(verdict.reason).toBe('session-cookie+dom');
    expect(verdict.confidence).toBeGreaterThan(0.95);
  });

  it('falls back to the DOM probe when no cookie matches', () => {
    const verdict = classify({
      url: 'https://chatgpt.com/c/abc',
      cookies: [],
      probe: { selectorFound: true, signedOutFound: false },
      profile: PROFILE
    });
    expect(verdict.state).toBe(STATE.LOGGED_IN);
    expect(verdict.reason).toBe('dom');
  });

  it('reports logged-out when the sign-in prompt is on screen', () => {
    const verdict = classify({
      url: 'https://chatgpt.com/c/abc',
      cookies: [],
      probe: { selectorFound: false, signedOutFound: true },
      profile: PROFILE
    });
    expect(verdict.state).toBe(STATE.LOGGED_OUT);
    expect(verdict.reason).toBe('dom-signin-prompt');
  });

  it('treats an OAuth / account host as signed out even with leftovers', () => {
    expect(
      classify({ url: 'https://accounts.google.com/v3/signin/identifier', cookies: [], profile: PROFILE }).state
    ).toBe(STATE.LOGGED_OUT);

    // A cookie plus a sign-in bounce is ambiguous: report "unknown" and let the
    // caller debounce rather than declaring the user signed out.
    const ambiguous = classify({
      url: 'https://chatgpt.com/auth/login',
      cookies: [sessionCookie()],
      profile: PROFILE
    });
    expect(ambiguous.state).toBe(STATE.UNKNOWN);
    expect(ambiguous.confidence).toBeLessThan(0.5);
  });

  it('never calls a bot challenge a logout', () => {
    const verdict = classify({
      url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/ov0/abc',
      cookies: [],
      profile: PROFILE
    });
    expect(verdict.state).toBe(STATE.CHALLENGE);
  });

  it('treats an expired session cookie as signed out', () => {
    const expired = sessionCookie('__Secure-next-auth.session-token', {
      expirationDate: Math.floor(Date.now() / 1000) - 60
    });
    const verdict = classify({ url: 'https://chatgpt.com/', cookies: [expired], profile: PROFILE });
    expect(verdict.state).toBe(STATE.LOGGED_OUT);
    expect(verdict.reason).toBe('session-cookie-missing');
  });

  it('says "signed out" when the fingerprint cookie is simply absent', () => {
    const verdict = classify({ url: 'https://chatgpt.com/', cookies: [], profile: PROFILE });
    expect(verdict.state).toBe(STATE.LOGGED_OUT);
    expect(verdict.reason).toBe('session-cookie-missing');
  });

  it('is honest about having no signal when the service has no fingerprint', () => {
    const verdict = classify({ url: 'https://unknown.example/', cookies: [], profile: null });
    expect(verdict.state).toBe(STATE.UNKNOWN);
    expect(verdict.reason).toBe('no-signal');
    expect(verdict.confidence).toBeLessThan(0.5);
  });

  it('surfaces an expiry inside a day as expiringSoon', () => {
    const soon = sessionCookie('__Secure-next-auth.session-token', {
      expirationDate: Math.floor(Date.now() / 1000) + 600
    });
    const verdict = classify({ url: 'https://chatgpt.com/', cookies: [soon], profile: PROFILE });
    expect(verdict.state).toBe(STATE.LOGGED_IN);
    expect(verdict.expiringSoon).toBe(true);
  });

  it('tolerates being called with nothing', () => {
    expect(() => classify()).not.toThrow();
    expect(classify().state).toBe(STATE.UNKNOWN);
  });
});

describe('URL heuristics', () => {
  it('recognises sign-in destinations', () => {
    expect(isSigninUrl('https://claude.ai/login')).toBe(true);
    expect(isSigninUrl('https://accounts.google.com/ServiceLogin')).toBe(true);
    expect(isSigninUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true);
    expect(isSigninUrl('https://chatgpt.com/c/abc')).toBe(false);
    expect(isSigninUrl('not a url')).toBe(false);
  });

  it('recognises challenge interstitials', () => {
    expect(isChallengeUrl('https://www.perplexity.ai/cdn-cgi/challenge-platform/x')).toBe(true);
    expect(isChallengeUrl('https://challenges.cloudflare.com/x')).toBe(true);
    expect(isChallengeUrl('https://chatgpt.com/')).toBe(false);
  });
});

describe('findSessionCookies', () => {
  it('only counts cookies on a matching domain', () => {
    const cookie = { name: '__Secure-next-auth.session-token', value: 'x', domain: 'evil.example', expirationDate: Math.floor(Date.now() / 1000) + 60 };
    expect(findSessionCookies([cookie], PROFILE).found).toBe(false);
  });

  it('reports the earliest expiry among the matches', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = findSessionCookies(
      [
        { name: '__Secure-next-auth.session-token', value: 'a', domain: 'chatgpt.com', expirationDate: now + 100000 },
        { name: 'oai-client-info', value: 'b', domain: 'chatgpt.com', expirationDate: now + 50 }
      ],
      PROFILE
    );
    expect(result.found).toBe(true);
    expect(result.expiresAt).toBe((now + 50) * 1000);
  });
});

describe('shouldRelogin', () => {
  it('only fires for a session that was previously good', () => {
    expect(shouldRelogin({ previous: STATE.LOGGED_IN, current: STATE.LOGGED_OUT })).toBe(true);
    expect(shouldRelogin({ previous: STATE.UNKNOWN, current: STATE.LOGGED_OUT })).toBe(false);
    expect(shouldRelogin({ previous: null, current: STATE.LOGGED_OUT })).toBe(false);
    expect(shouldRelogin({ previous: STATE.LOGGED_IN, current: STATE.LOGGED_IN })).toBe(false);
  });

  it('never relogins over a challenge or a missing signal', () => {
    expect(shouldRelogin({ previous: STATE.LOGGED_IN, current: STATE.CHALLENGE })).toBe(false);
    expect(shouldRelogin({ previous: STATE.LOGGED_IN, current: STATE.UNKNOWN, currentReason: 'no-signal' })).toBe(false);
  });

  it('respects the retry grace window', () => {
    const now = Date.now();
    expect(shouldRelogin({ previous: STATE.LOGGED_IN, current: STATE.LOGGED_OUT, now, lastAttemptAt: now - 1000 }, 60000)).toBe(false);
    expect(shouldRelogin({ previous: STATE.LOGGED_IN, current: STATE.LOGGED_OUT, now, lastAttemptAt: now - 120000 }, 60000)).toBe(true);
  });
});

describe('loginUrlFor / needsKeepAlive', () => {
  it('prefers the profile URL and only accepts https', () => {
    expect(loginUrlFor(PROFILE, { url: 'https://chatgpt.com/' })).toBe('https://chatgpt.com/auth/login');
    expect(loginUrlFor({ loginUrl: 'javascript:alert(1)' }, { url: 'https://a.com' })).toBe('https://a.com');
    expect(loginUrlFor(null, null)).toBeNull();
  });

  it('asks for a refresh only for a warm session nearing expiry', () => {
    const now = Date.now();
    expect(needsKeepAlive({ state: STATE.LOGGED_IN, expiresAt: now + 3600000 }, now)).toBe(true);
    expect(needsKeepAlive({ state: STATE.LOGGED_IN, expiresAt: now + 200 * 86400000 }, now)).toBe(false);
    expect(needsKeepAlive({ state: STATE.LOGGED_OUT, expiresAt: now }, now)).toBe(false);
    expect(needsKeepAlive(null, now)).toBe(false);
  });
});

describe('normalizeProfile', () => {
  it('drops selectors that could carry markup', () => {
    const profile = normalizeProfile(
      { loggedInSelector: '<img src=x onerror=alert(1)>', signedOutSelector: '[data-ok]' },
      'demo'
    );
    expect(profile.loggedInSelector).toBeNull();
    expect(profile.signedOutSelector).toBe('[data-ok]');
  });

  it('returns null for non-objects', () => {
    expect(normalizeProfile(null)).toBeNull();
    expect(normalizeProfile('nope')).toBeNull();
    expect(normalizeProfile([])).toBeNull();
  });
});
