/**
 * Normalisation of remote payloads: hostile or partial data must be dropped,
 * never crash the loader.
 */

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

jest.mock('electron-store', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    store: { enabledServices: [], blockingEnabled: true, lastUpdate: null }
  }))
}), { virtual: true });

const {
  normalizeService,
  normalizeServicesPayload,
  normalizeRulesPayload,
  isStale
} = require('../src/data');

describe('normalizeService', () => {
  it('accepts the legacy tuple shape', () => {
    const service = normalizeService(['ChatGPT', 'https://chatgpt.com/', 'AI', 'x', '10a37f']);
    expect(service).toMatchObject({ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' });
  });

  it('accepts the object shape', () => {
    const service = normalizeService({ name: 'Claude', url: 'https://claude.ai', color: 'zzzzzz' });
    expect(service.id).toBe('claude');
    expect(service.color).toBeNull(); // invalid colour rejected
  });

  it('rejects garbage', () => {
    expect(normalizeService(null)).toBeNull();
    expect(normalizeService(['OnlyName'])).toBeNull();
    expect(normalizeService({ name: 'X', url: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeService({ name: '', url: 'https://a.com' })).toBeNull();
  });
});

describe('normalizeServicesPayload', () => {
  it('deduplicates by id and drops invalid entries', () => {
    const payload = normalizeServicesPayload({
      ai_services: [
        ['ChatGPT', 'https://chatgpt.com'],
        ['Chat GPT', 'https://other.com'], // same slug -> dropped
        ['Broken', 'not-a-url'], // invalid url -> dropped
        ['Claude', 'https://claude.ai']
      ]
    });
    expect(payload.ai_services.map((s) => s.id)).toEqual(['chatgpt', 'claude']);
  });

  it('returns null for unusable payloads', () => {
    expect(normalizeServicesPayload(null)).toBeNull();
    expect(normalizeServicesPayload({ ai_services: [] })).toBeNull();
    expect(normalizeServicesPayload({ ai_services: [['x', 'nope']] })).toBeNull();
  });
});

describe('normalizeRulesPayload', () => {
  it('normalises domains and drops empty sets', () => {
    const rules = normalizeRulesPayload({
      service_domains: {
        ChatGPT: ['openai.com', 'CDN.OpenAI.com', '  ', ''],
        Empty: []
      },
      common_auth_domains: ['google.com', 'google.com']
    });
    expect(rules.service_domains.chatgpt).toEqual(['openai.com', 'cdn.openai.com']);
    expect(rules.service_domains.empty).toBeUndefined();
    expect(rules.common_auth_domains).toEqual(['google.com']);
  });

  it('rejects payloads without service_domains', () => {
    expect(normalizeRulesPayload({})).toBeNull();
    expect(normalizeRulesPayload({ service_domains: [] })).toBeNull();
  });
});

describe('isStale', () => {
  it('treats missing or unparsable timestamps as stale', () => {
    expect(isStale(null)).toBe(true);
    expect(isStale('garbage')).toBe(true);
  });

  it('respects the seven day window', () => {
    const fresh = new Date().toISOString();
    expect(isStale(fresh)).toBe(false);
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    expect(isStale(old)).toBe(true);
  });
});

describe('bundled fallback data', () => {
  it('the committed catalogue and rules are internally consistent', () => {
    const fs = require('fs');
    const path = require('path');
    const services = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'services.json'), 'utf8')
    );
    const rules = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'rules.json'), 'utf8')
    );

    const normalized = normalizeServicesPayload(services);
    expect(normalized).not.toBeNull();

    const ids = normalized.ai_services.map((s) => s.id);
    const ruleIds = Object.keys(rules.service_domains);
    for (const id of ids) expect(ruleIds).toContain(id);
  });
});
