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
}));

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
}));

const { isDomainAllowed } = require('../src/blocking');

describe('Domain Blocking Logic', () => {
  it('should allow domains when blocking is disabled', () => {
    expect(isDomainAllowed('evil.com', [], false, new Set())).toBe(true);
  });

  it('should allow common auth domains', () => {
    const commonAuthDomains = new Set(['google.com', 'accounts.google.com']);
    expect(isDomainAllowed('google.com', [], true, commonAuthDomains)).toBe(true);
    expect(isDomainAllowed('accounts.google.com', [], true, commonAuthDomains)).toBe(true);
    expect(isDomainAllowed('some.other.accounts.google.com', [], true, commonAuthDomains)).toBe(true);
  });

  it('should allow whitelisted service domains', () => {
    const serviceDomains = ['openai.com'];
    expect(isDomainAllowed('openai.com', serviceDomains, true, new Set())).toBe(true);
    expect(isDomainAllowed('chat.openai.com', serviceDomains, true, new Set())).toBe(true);
  });

  it('should block non-whitelisted domains', () => {
    const serviceDomains = ['openai.com'];
    expect(isDomainAllowed('evil.com', serviceDomains, true, new Set())).toBe(false);
    expect(isDomainAllowed('notopenai.com', serviceDomains, true, new Set())).toBe(false);
  });
});
