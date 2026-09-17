/**
 * Regression: the local API's hidden windows must be known to the request
 * filter.
 *
 * They compute their allow-list directly (`buildAllowList`) instead of going
 * through `updateTabDomains`, so before `registerTabDomains` existed they were
 * an *unattributed* webContents. With `strictBlocking` enabled — which is
 * fail-closed for unattributed requests — every request the hidden window made
 * was rejected, silently breaking the whole OpenAI-compatible endpoint.
 */

jest.mock('electron', () => ({ session: { defaultSession: null } }), { virtual: true });
jest.mock(
  'electron-log',
  () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  { virtual: true }
);

const blocking = require('../src/blocking');

const RULES = {
  service_domains: { chatgpt: ['chatgpt.com', 'openai.com'] },
  common_auth_domains: ['accounts.google.com'],
  always_allowed_domains: []
};

const HIDDEN_WINDOW_ID = 4242;

describe('hidden API windows under strict blocking', () => {
  beforeEach(() => {
    blocking._resetForTests();
    blocking.updateBlockingState({ blockingEnabled: true, strictBlocking: true }, RULES);
  });

  it('blocks an unregistered webContents (the bug)', () => {
    const verdict = blocking.evaluateRequest({
      url: 'https://chatgpt.com/backend-api/conversation',
      webContentsId: HIDDEN_WINDOW_ID
    });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toBe('unknown-webcontents');
  });

  it('allows the service once the hidden window registers its allow-list', () => {
    const allowed = blocking.buildAllowList('chatgpt', RULES);
    blocking.registerTabDomains(HIDDEN_WINDOW_ID, allowed);

    const verdict = blocking.evaluateRequest({
      url: 'https://chatgpt.com/backend-api/conversation',
      webContentsId: HIDDEN_WINDOW_ID
    });
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toBe('allowed');
  });

  it('still confines a registered hidden window to its own service', () => {
    blocking.registerTabDomains(HIDDEN_WINDOW_ID, blocking.buildAllowList('chatgpt', RULES));

    // Registering must not turn the window into a trusted, unfiltered context.
    expect(
      blocking.evaluateRequest({ url: 'https://evil.test/steal', webContentsId: HIDDEN_WINDOW_ID }).allow
    ).toBe(false);
    // Shared auth domains stay reachable so sign-in flows still work.
    expect(
      blocking.evaluateRequest({
        url: 'https://accounts.google.com/signin',
        webContentsId: HIDDEN_WINDOW_ID
      }).allow
    ).toBe(true);
  });

  it('accepts an array of domains and normalises them', () => {
    blocking.registerTabDomains(HIDDEN_WINDOW_ID, ['ChatGPT.com', 'https://openai.com/']);
    expect(
      blocking.evaluateRequest({ url: 'https://cdn.chatgpt.com/a.js', webContentsId: HIDDEN_WINDOW_ID }).allow
    ).toBe(true);
  });

  it('forgets the allow-list when the window is destroyed', () => {
    blocking.registerTabDomains(HIDDEN_WINDOW_ID, blocking.buildAllowList('chatgpt', RULES));
    blocking.removeTabDomains(HIDDEN_WINDOW_ID);

    expect(
      blocking.evaluateRequest({ url: 'https://chatgpt.com/', webContentsId: HIDDEN_WINDOW_ID }).reason
    ).toBe('unknown-webcontents');
  });
});
