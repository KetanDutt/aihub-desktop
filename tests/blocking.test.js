// Create mock for electron dependencies which are not available in jest unit test out-of-the-box.
jest.mock('electron', () => ({
  session: {
    defaultSession: {
      webRequest: {
        onBeforeRequest: jest.fn(),
      },
    },
  },
  app: {
    getPath: jest.fn().mockReturnValue('mockDataPath'),
  },
}), { virtual: true });

jest.mock('../src/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    blockingEnabled: true,
    lastActiveService: 'chatgpt'
  }),
  updateConfigItem: jest.fn(),
}));

jest.mock('../src/data', () => ({
  getRulesCache: jest.fn().mockReturnValue({
    service_domains: {
      chatgpt: ['openai.com', 'chat.openai.com']
    }
  }),
  loadRules: jest.fn(),
  getCommonAuthDomains: jest.fn().mockReturnValue(new Set(['google.com']))
}));

jest.mock('electron-log', () => ({
  info: jest.fn(),
  error: jest.fn(),
}), { virtual: true });

const {
  isDomainAllowed,
  updateTabDomains,
  removeTabDomains,
  setupWebRequestBlocking,
  updateBlockingState
} = require('../src/blocking');

describe('Domain Blocking Logic', () => {

  it('should block domains without dot prefix incorrectly matching', () => {
    const serviceDomains = new Set(['openai.com']);
    expect(isDomainAllowed('notopenai.com', serviceDomains, true, new Set())).toBe(false);
  });

  it('should allow exact subdomains matching', () => {
    const serviceDomains = new Set(['openai.com']);
    expect(isDomainAllowed('api.openai.com', serviceDomains, true, new Set())).toBe(true);
  });

  it('should allow domains when blocking is disabled', () => {
    expect(isDomainAllowed('evil.com', new Set(), false, new Set())).toBe(true);
  });

  it('should allow common auth domains', () => {
    const commonAuthDomains = new Set(['google.com', 'accounts.google.com']);
    expect(isDomainAllowed('google.com', new Set(), true, commonAuthDomains)).toBe(true);
    expect(isDomainAllowed('accounts.google.com', new Set(), true, commonAuthDomains)).toBe(true);
    expect(isDomainAllowed('some.other.accounts.google.com', new Set(), true, commonAuthDomains)).toBe(true);
  });

  it('should allow whitelisted service domains', () => {
    const serviceDomains = new Set(['openai.com']);
    expect(isDomainAllowed('openai.com', serviceDomains, true, new Set())).toBe(true);
    expect(isDomainAllowed('chat.openai.com', serviceDomains, true, new Set())).toBe(true);
  });

  it('should block non-whitelisted domains', () => {
    const serviceDomains = new Set(['openai.com']);
    expect(isDomainAllowed('evil.com', serviceDomains, true, new Set())).toBe(false);
    expect(isDomainAllowed('notopenai.com', serviceDomains, true, new Set())).toBe(false);
  });
});

describe('Tab-Specific Blocking Logic', () => {
  let blockerCallback;
  const { session } = require('electron');

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset blocking state to default for tests
    updateBlockingState({ blockingEnabled: true }, { common_auth_domains: [] });
    setupWebRequestBlocking();
    // Capture the callback passed to onBeforeRequest
    blockerCallback = session.defaultSession.webRequest.onBeforeRequest.mock.calls[0][1];
  });

  it('should allow domains specifically for a webContentsId', () => {
    const webContentsId = 1;
    const rules = {
      service_domains: {
        chatgpt: ['openai.com']
      }
    };

    updateTabDomains(webContentsId, 'chatgpt', rules);

    const callback = jest.fn();
    blockerCallback({ url: 'https://openai.com/path', webContentsId }, callback);

    expect(callback).toHaveBeenCalledWith({});
  });

  it('should block domains not in the tab-specific whitelist', () => {
    const webContentsId = 2;
    const rules = {
      service_domains: {
        chatgpt: ['openai.com']
      }
    };

    updateTabDomains(webContentsId, 'chatgpt', rules);

    const callback = jest.fn();
    blockerCallback({ url: 'https://evil.com/path', webContentsId }, callback);

    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });

  it('should handle missing rules or serviceId gracefully', () => {
    const webContentsId = 3;

    // No rules provided
    updateTabDomains(webContentsId, 'chatgpt', null);

    const callback = jest.fn();
    blockerCallback({ url: 'https://openai.com/path', webContentsId }, callback);

    // Should block because no domains were whitelisted for this tab
    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });

  it('should remove tab domains correctly', () => {
    const webContentsId = 4;
    const rules = {
      service_domains: {
        chatgpt: ['openai.com']
      }
    };

    updateTabDomains(webContentsId, 'chatgpt', rules);
    removeTabDomains(webContentsId);

    const callback = jest.fn();
    blockerCallback({ url: 'https://openai.com/path', webContentsId }, callback);

    // Should block because domains were removed
    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });

  it('should update blocking state correctly', () => {
    const config = { blockingEnabled: false };
    const rules = { common_auth_domains: ['auth.com'] };

    updateBlockingState(config, rules);

    const callback = jest.fn();
    // Use a new webContentsId that has no specific rules
    blockerCallback({ url: 'https://any-domain.com', webContentsId: 99 }, callback);

    // Should allow because blocking is disabled
    expect(callback).toHaveBeenCalledWith({});
  });

  it('should handle serviceId not in rules gracefully', () => {
    const webContentsId = 5;
    const rules = {
      service_domains: {
        other: ['other.com']
      }
    };

    updateTabDomains(webContentsId, 'chatgpt', rules);

    const callback = jest.fn();
    blockerCallback({ url: 'https://openai.com/path', webContentsId }, callback);

    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });

  it('should update common auth domains in blocking state', () => {
    const config = { blockingEnabled: true };
    const rules = { common_auth_domains: ['new-auth.com'] };

    updateBlockingState(config, rules);

    const callback = jest.fn();
    blockerCallback({ url: 'https://new-auth.com/login', webContentsId: 100 }, callback);

    expect(callback).toHaveBeenCalledWith({});
  });
});
