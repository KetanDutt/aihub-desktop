/**
 * Anti-bot hardening: what actually gets rewritten, and what does not.
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

const mockDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-stealth-'));
process.env.AIHUB_DATA_DIR = mockDataDir;
process.env.AIHUB_BUNDLED_DIR = path.join(__dirname, '..', 'data');

const mockHandlers = {};
const mockSession = {
  id: 'default',
  setUserAgent: jest.fn(),
  getUserAgent: () =>
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aihub-desktop/1.3.0 Chrome/141.0.0.0 Electron/41.1.1 Safari/537.36',
  webRequest: {
    onBeforeSendHeaders: jest.fn((filter, handler) => {
      mockHandlers.beforeSend = handler;
    }),
    onBeforeRequest: jest.fn()
  },
  cookies: { get: jest.fn(async () => []), on: jest.fn() }
};

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => mockDataDir,
    getLocale: () => 'en-US',
    commandLine: { appendSwitch: jest.fn() }
  },
  session: { defaultSession: mockSession, fromPartition: jest.fn(() => mockSession) },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  dialog: {}
}), { virtual: true });

jest.mock('electron-store', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(function Store() {
    const state = {};
    return {
      get store() {
        return state;
      },
      get: jest.fn((key, fallback) => (key in state ? state[key] : fallback)),
      set: jest.fn((keyOrObject, value) => {
        if (keyOrObject && typeof keyOrObject === 'object') Object.assign(state, keyOrObject);
        else state[keyOrObject] = value;
      })
    };
  })
}), { virtual: true });

const config = require('../src/config');
const stealth = require('../src/stealth');
const fingerprint = require('../src/fingerprint');

beforeEach(() => {
  jest.useRealTimers();
  stealth.reset();
  mockSession.setUserAgent.mockClear();
  mockSession.webRequest.onBeforeSendHeaders.mockClear();
  delete mockHandlers.beforeSend;
});

afterEach(() => {
  // A half-finished fake-timer test must not leave the clock stopped.
  jest.useRealTimers();
});

/** Run the installed webRequest handler and return what it passed to `callback`. */
function runHeaderHandler(details) {
  let result = null;
  mockHandlers.beforeSend(details, (response) => {
    result = response;
  });
  expect(result).not.toBeNull();
  return result.requestHeaders;
}

describe('process flags', () => {
  it('adds the blink switch before any tab exists', () => {
    const { app } = require('electron');
    expect(stealth.applyCommandLineFlags()).toBe(true);
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-blink-features', 'AutomationControlled');
  });

  it('adds nothing once the user turns hardening off', () => {
    const { app } = require('electron');
    config.updateConfigItem('antiBotHardening', false);
    expect(stealth.applyCommandLineFlags()).toBe(false);
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    config.updateConfigItem('antiBotHardening', true);
  });
});

describe('session identity', () => {
  it('replaces the Electron UA with a matching Chrome one', () => {
    expect(stealth.applyToSession(mockSession)).toBe(true);
    const [ua, languages] = mockSession.setUserAgent.mock.calls[0];
    expect(ua).not.toMatch(/Electron|aihub-desktop/);
    expect(ua).toMatch(/Chrome\/141/);
    expect(languages).toEqual(['en-US', 'en']);
  });

  it('installs the header rewrite once per session', () => {
    stealth.applyToSession(mockSession);
    stealth.applyToSession(mockSession);
    expect(mockSession.webRequest.onBeforeSendHeaders).toHaveBeenCalledTimes(1);
    expect(typeof mockHandlers.beforeSend).toBe('function');
  });

  it('rewrites UA, Accept-Language and every client hint', () => {
    stealth.applyToSession(mockSession);
    const profile = stealth.getProfile();

    const requestHeaders = runHeaderHandler({
      url: 'https://chatgpt.com/backend-api/conversation',
      requestHeaders: {
        'User-Agent': 'Mozilla/5.0 Electron/41.1.1',
        'sec-ch-ua': '"Not:A-Brand";v="99"',
        'Sec-CH-UA-Mobile': '?1',
        'Accept-Language': 'de-DE',
        'electron-experimental': '1',
        cookie: 'sid=keepme'
      }
    });

    expect(requestHeaders['User-Agent']).toBe(profile.userAgent);
    expect(requestHeaders['user-agent']).toBeUndefined(); // one spelling only, never two.
    expect(requestHeaders['Accept-Language']).toBeUndefined();
    expect(requestHeaders['accept-language']).toBe(profile.acceptLanguage);
    expect(requestHeaders['sec-ch-ua']).not.toBe('"Not:A-Brand";v="99"');
    expect(requestHeaders['sec-ch-ua']).toContain('Chromium');
    expect(requestHeaders['sec-ch-ua-mobile']).toBe('?0');
    expect(requestHeaders['sec-ch-ua-platform']).toBe(`"${profile.platformName}"`);
    // A brand with a space must be quoted or the hint is malformed.
    expect(requestHeaders['sec-ch-ua']).toContain('"Google Chrome";v=');
    expect(requestHeaders['electron-experimental']).toBeUndefined();
    expect(requestHeaders.cookie).toBe('sid=keepme'); // page data is never touched
  });

  it('leaves loopback and unparseable requests alone', () => {
    stealth.applyToSession(mockSession);
    const original = { 'user-agent': 'raw' };

    expect(runHeaderHandler({ url: 'http://127.0.0.1:8788/v1/models', requestHeaders: original })).toBe(original);
    expect(runHeaderHandler({ url: 'http://localhost:3000/x', requestHeaders: original })).toBe(original);
    expect(runHeaderHandler({ url: 'not-a-url', requestHeaders: original })).toBe(original);
  });

  it('stops rewriting as soon as hardening is disabled', () => {
    stealth.applyToSession(mockSession);
    config.updateConfigItem('antiBotHardening', false);
    const original = { 'user-agent': 'raw' };
    expect(runHeaderHandler({ url: 'https://chatgpt.com/', requestHeaders: original })).toBe(original);
    config.updateConfigItem('antiBotHardening', true);
  });
});

describe('profile persistence', () => {
  it('keeps one stable fingerprint across calls and persists the seed', () => {
    const first = stealth.getProfile({ force: true });
    const second = stealth.getProfile();
    expect(second.seed).toBe(first.seed);

    const file = path.join(mockDataDir, 'fingerprint.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).seed).toBe(first.seed);
  });

  it('reflects the user canvas-noise opt-in', () => {
    config.updateConfigItem('antiBotCanvasNoise', true);
    expect(stealth.getProfile({ force: true }).canvasNoise).toBe(true);
    config.updateConfigItem('antiBotCanvasNoise', false);
  });
});

describe('challenge handling', () => {
  it('waits it out with backoff and never exceeds the retry budget', async () => {
    jest.useFakeTimers();
    const retries = [];
    const contents = { id: 1, isDestroyed: () => false, reload: jest.fn() };

    const scheduled = await stealth.handleChallenge(contents, {
      url: 'https://a.com/challenge',
      onRetry: (info) => retries.push(info)
    });
    expect(scheduled).toBe(true);

    // Immediately again is refused: a challenge is waited out, not farmed.
    expect(await stealth.handleChallenge(contents, { url: 'https://a.com/challenge' })).toBe(false);

    jest.advanceTimersByTime(60000);
    expect(contents.reload).toHaveBeenCalledTimes(1);
    expect(retries).toHaveLength(1);
    expect(retries[0].delay).toBeGreaterThan(0);

    // The budget is finite: after CHALLENGE_MAX_RETRIES automated reloads the
    // page is left alone for the user to solve.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await stealth.handleChallenge(contents, { url: 'https://a.com/challenge' });
      // eslint-disable-next-line no-await-in-loop
      jest.advanceTimersByTime(600000);
    }
    expect(contents.reload.mock.calls.length).toBe(3);
  });

  it('resets the budget once the challenge is cleared', async () => {
    jest.useFakeTimers();
    const contents = { id: 2, isDestroyed: () => false, reload: jest.fn() };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await stealth.handleChallenge(contents, { url: 'https://a.com/challenge' });
      // eslint-disable-next-line no-await-in-loop
      jest.advanceTimersByTime(600000);
    }
    const exhausted = contents.reload.mock.calls.length;
    expect(exhausted).toBe(3);

    stealth.noteChallengeCleared(contents);
    // eslint-disable-next-line no-await-in-loop
    await stealth.handleChallenge(contents, { url: 'https://a.com/challenge' });
    // eslint-disable-next-line no-await-in-loop
    jest.advanceTimersByTime(600000);
    expect(contents.reload.mock.calls.length).toBe(exhausted + 1);
  });

  it('uses a growing, jittered delay', () => {
    const first = fingerprint.challengeDelay(0, () => 0);
    const second = fingerprint.challengeDelay(1, () => 0);
    expect(second).toBe(first * 2);
    expect(fingerprint.challengeDelay(2, () => 1)).toBeGreaterThan(fingerprint.challengeDelay(2, () => 0));
  });
});

describe('humanised input', () => {
  function fakeContents(sink) {
    return {
      id: 3,
      isDestroyed: () => false,
      executeJavaScript: jest.fn(async (script) => {
        sink.push(script);
        return true;
      })
    };
  }

  it('types in chunks with pauses when humanising', async () => {
    jest.useFakeTimers();
    const scripts = [];
    const contents = fakeContents(scripts);

    const pending = stealth.typeInto(contents, 'textarea', 'hello world, please answer');
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(result.mode).toBe('humanized');
    expect(result.chunks).toBeGreaterThan(1);
    expect(scripts[0]).toContain('el.textContent = '); // focus + clear first
    expect(scripts.length).toBeGreaterThan(2); // never one paste
    expect(scripts.some((script) => script.includes('insertText'))).toBe(true);
  });

  it('pastes in one go when the user turns pacing off', async () => {
    config.updateConfigItem('antiBotHumanize', false);
    const scripts = [];
    const contents = fakeContents(scripts);

    const result = await stealth.typeInto(contents, 'textarea', 'a'.repeat(500));
    expect(result.mode).toBe('instant');
    expect(scripts.length).toBe(2);
    config.updateConfigItem('antiBotHumanize', true);
  });

  it('is a no-op without a live view', async () => {
    await expect(stealth.typeInto(null, 'textarea', 'hi')).resolves.toEqual({ ok: false, error: 'no-contents' });
    await expect(stealth.typeInto({ isDestroyed: () => true }, 'textarea', 'hi')).resolves.toEqual({
      ok: false,
      error: 'no-contents'
    });
  });

  it('quotes selectors and text as JSON literals, never as raw source', async () => {
    const scripts = [];
    await stealth.typeInto(fakeContents(scripts), 'textarea[data-x="1"]', 'hi');
    const joined = scripts.join('\n');
    // Both the selector and the text are JSON-encoded, so a quote can never end
    // the string literal and turn page content into injected code.
    expect(joined).toContain('document.querySelector("textarea[data-x=\\"1\\"]")');
    expect(joined).toContain('"hi"');
  });
});

describe('CDP attach', () => {
  it('skips cleanly when the debugger is busy', async () => {
    const contents = {
      id: 9,
      isDestroyed: () => false,
      on: jest.fn(),
      debugger: {
        attach: jest.fn(() => {
          throw new Error('Another debugger is already attached');
        }),
        isAttached: () => false,
        sendCommand: jest.fn()
      }
    };

    const result = await stealth.applyToWebContents(contents);
    expect(result).toEqual({ ok: false, skipped: 'debugger-busy' });
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled();
  });

  it('installs the script, UA override and hints when it can attach', async () => {
    const commands = [];
    const contents = {
      id: 10,
      isDestroyed: () => false,
      on: jest.fn(),
      session: mockSession,
      debugger: {
        attach: jest.fn(),
        isAttached: () => true,
        detach: jest.fn(),
        sendCommand: jest.fn(async (method, params) => {
          commands.push([method, params]);
          return {};
        })
      }
    };

    const result = await stealth.applyToWebContents(contents);
    expect(result.ok).toBe(true);

    const methods = commands.map(([method]) => method);
    expect(methods).toEqual(
      expect.arrayContaining([
        'Page.enable',
        'Page.addScriptToEvaluateOnNewDocument',
        'Network.enable',
        'Network.setUserAgentOverride'
      ])
    );

    const script = commands.find(([method]) => method === 'Page.addScriptToEvaluateOnNewDocument')[1].source;
    expect(script).toContain("'webdriver'");
    expect(script).toContain('userAgentData');

    const uaOverride = commands.find(([method]) => method === 'Network.setUserAgentOverride')[1];
    expect(uaOverride.userAgent).not.toMatch(/Electron/);
    expect(uaOverride.userAgentMetadata.brands.length).toBeGreaterThan(0);
  });

  it('is inert while hardening is off', async () => {
    config.updateConfigItem('antiBotHardening', false);
    stealth.reset();
    const contents = { id: 11, isDestroyed: () => false, on: jest.fn() };
    expect(await stealth.applyToWebContents(contents)).toEqual({ ok: false, skipped: 'disabled' });
    config.updateConfigItem('antiBotHardening', true);
  });
});
