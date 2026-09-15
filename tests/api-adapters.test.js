/**
 * Adapter descriptors: hostile or stale data must be dropped, not partially
 * applied, and the shipped catalogue must stay consistent with the services it
 * claims to drive.
 */

jest.mock('electron', () => ({
  app: { getPath: () => require('os').tmpdir(), isPackaged: false },
  session: { defaultSession: { webRequest: { onBeforeRequest: jest.fn() } } }
}), { virtual: true });

const fs = require('fs');
const path = require('path');

const adapters = require('../src/api/adapters');
const { slugify } = require('../src/utils');

const DATA = path.join(__dirname, '..', 'data');

const VALID_DOM = {
  url: 'https://chatgpt.com/',
  composer: '#prompt-textarea',
  answer: '[data-message-author-role="assistant"]'
};

describe('normalizeDom', () => {
  it('keeps a sane descriptor and applies defaults', () => {
    const dom = adapters.normalizeDom(VALID_DOM);
    expect(dom).toMatchObject({ url: 'https://chatgpt.com/', submit: 'enter', idlePolls: 3, pollMs: 700 });
  });

  it('requires both a composer and an answer selector', () => {
    expect(adapters.normalizeDom({ url: 'https://a.com' })).toBeNull();
    expect(adapters.normalizeDom({ composer: 'textarea' })).toBeNull();
  });

  it('refuses non-https pages and junk urls', () => {
    expect(adapters.normalizeDom({ ...VALID_DOM, url: 'http://a.com' }).url).toBe('');
    expect(adapters.normalizeDom({ ...VALID_DOM, url: 'javascript:alert(1)' }).url).toBe('');
  });

  it('clamps polling knobs into sane ranges', () => {
    const dom = adapters.normalizeDom({ ...VALID_DOM, pollMs: 1, idlePolls: 9999, navigateTimeoutMs: 10 });
    expect(dom.pollMs).toBe(100);
    expect(dom.idlePolls).toBe(40);
    expect(dom.navigateTimeoutMs).toBe(2000);
  });
});

describe('selector safety', () => {
  it('refuses anything that is not a plain selector', () => {
    for (const bad of ['<img src=x>', 'a{position:fixed}', 'javascript:alert(1)', 'x'.repeat(500), 'expression(document)']) {
      expect(adapters.safeSelector(bad)).toBeNull();
    }
    expect(adapters.safeSelector('[data-testid="answer"], .prose')).toBe('[data-testid="answer"], .prose');
  });

  it('only accepts header names, not injected lines', () => {
    expect(adapters.safeHeaderName('X-Account-Id')).toBe('x-account-id');
    expect(adapters.safeHeaderName('Bad Header')).toBeNull();
    expect(adapters.safeHeaderName('x\r\ninjected')).toBeNull();
  });
});

describe('normalizeApi', () => {
  it('accepts a full descriptor', () => {
    const api = adapters.normalizeApi({
      method: 'post',
      url: 'https://chatgpt.com/backend-api/conversation',
      sse: true,
      deltaPath: 'messages.0.content.parts.0',
      headers: { 'Content-Type': 'application/json', 'x': 42, 'y\r\nz': 'v' },
      authHeaders: [{ header: 'chatgpt-account-id', from: 'localStorage', key: 'oai-client-info', jsonPath: 'accountId' }],
      urlParams: [{ name: 'organizationId', from: 'urlPattern', pattern: 'organizations/([A-Za-z0-9-]{8,64})' }],
      body: { action: 'next', model: '{model}' }
    });

    expect(api.method).toBe('POST');
    expect(api.headers['content-type']).toBe('application/json');
    expect(api.headers.x).toBeUndefined(); // non-string dropped
    expect(api.headers['y\r\nz']).toBeUndefined(); // invalid name dropped
    expect(api.authHeaders).toEqual([
      { name: 'chatgpt-account-id', from: 'localStorage', key: 'oai-client-info', pattern: null, jsonPath: 'accountId' }
    ]);
    expect(api.urlParams[0].from).toBe('urlPattern');
  });

  it('refuses dangerous methods, protocols and malformed source entries', () => {
    expect(adapters.normalizeApi({ url: 'https://a.com', method: 'DELETE' })).toBeNull();
    expect(adapters.normalizeApi({ url: 'file:///etc/passwd' })).toBeNull();

    const api = adapters.normalizeApi({
      url: 'https://a.com/x',
      urlParams: ['not-an-object', null, { name: 'p', from: 'urlPattern', pattern: 'x' }]
    });
    expect(api.urlParams).toHaveLength(1);
  });

  it('will not accept a pattern that could reach a constructor', () => {
    const api = adapters.normalizeApi({
      url: 'https://a.com/x',
      urlParams: [{ name: 'p', from: 'urlPattern', pattern: "'; require('child_process')//" }]
    });
    expect(api.urlParams).toEqual([]);
  });

  it('only resolves sources it knows', () => {
    const api = adapters.normalizeApi({
      url: 'https://a.com/x',
      authHeaders: [
        { header: 'a', from: 'eval', key: 'x' },
        { header: 'b', from: 'cookie', key: 'sid' },
        { header: 'c', from: 'localStorage', key: '' }
      ]
    });
    expect(api.authHeaders.map((entry) => entry.name)).toEqual(['b']);
  });
});

describe('normalizeAdapter', () => {
  it('downgrades an api strategy to dom when there is no api block', () => {
    const adapter = adapters.normalizeAdapter({ strategy: 'api', dom: VALID_DOM }, 'x');
    expect(adapter.strategy).toBe('dom');
    expect(adapters.normalizeAdapter({ strategy: 'api' }, 'x')).toBeNull();
    expect(adapters.normalizeAdapter({ strategy: 'dom' }, 'x')).toBeNull();
  });

  it('keeps model lists and defaults', () => {
    const adapter = adapters.normalizeAdapter(
      { strategy: 'auto', dom: VALID_DOM, models: ['gpt-4o', 'gpt-4o', 42], defaultModel: 'gpt-4o' },
      'chatgpt'
    );
    expect(adapter.models).toEqual(['gpt-4o']);
    expect(adapter.defaultModel).toBe('gpt-4o');
    expect(adapter.serviceId).toBe('chatgpt');
  });

  it('rejects junk', () => {
    for (const bad of [null, undefined, 'nope', 42, []]) {
      expect(adapters.normalizeAdapter(bad, 'x')).toBeNull();
    }
  });
});

describe('payload normalisation', () => {
  it('slugifies ids, drops unusable entries and merges the default', () => {
    const map = adapters.normalizeAdaptersPayload({
      default: { strategy: 'dom', dom: VALID_DOM },
      adapters: {
        'Chat GPT': { dom: { url: 'https://chatgpt.com/', composer: 'a', answer: 'b' } },
        broken: { strategy: 'api' },
        inherits: {}
      }
    });

    // `broken` asked for an API it does not describe, so it inherits the default
    // DOM driver rather than being dropped — a partial entry is still usable.
    expect([...map.keys()].sort()).toEqual(['broken', 'chatgpt', 'inherits']);
    // `inherits` had nothing of its own, so the default composer applies.
    expect(map.get('inherits').dom.composer).toBe('#prompt-textarea');
    // A partial `dom` override keeps the fields it did not mention.
    expect(map.get('chatgpt').dom.composer).toBe('a');
    expect(map.get('chatgpt').dom.url).toBe('https://chatgpt.com/');
    expect(map.get('chatgpt').dom.submit).toBe('enter');
  });

  it('merges a partial dom block with the default instead of replacing it', () => {
    const map = adapters.normalizeAdaptersPayload({
      default: { strategy: 'dom', dom: { ...VALID_DOM, submit: 'button', submitSelector: '#send' } },
      adapters: { onlyAnswer: { dom: { url: 'https://example.com/chat' } } }
    });

    const adapter = map.get('onlyanswer');
    expect(adapter).toBeDefined();
    expect(adapter.dom.url).toBe('https://example.com/chat');
    // inherited from the default entry
    expect(adapter.dom.composer).toBe('#prompt-textarea');
    expect(adapter.dom.answer).toBe(VALID_DOM.answer);
    expect(adapter.dom.submit).toBe('button');
  });

  it('returns null without an adapters map', () => {
    expect(adapters.normalizeAdaptersPayload({ default: {} })).toBeNull();
    expect(adapters.normalizeAdaptersPayload(null)).toBeNull();
  });
});

describe('bundled adapters.json', () => {
  const payload = JSON.parse(fs.readFileSync(path.join(DATA, 'adapters.json'), 'utf8'));
  const catalogue = JSON.parse(fs.readFileSync(path.join(DATA, 'services.json'), 'utf8'));
  const rules = JSON.parse(fs.readFileSync(path.join(DATA, 'rules.json'), 'utf8'));
  const serviceIds = catalogue.ai_services.map((tuple) => slugify(tuple[0]));

  it('only describes services that exist in the catalogue', () => {
    for (const id of Object.keys(payload.adapters)) {
      expect(serviceIds).toContain(id);
    }
  });

  it('has a usable adapter for every service', () => {
    const map = adapters.normalizeAdaptersPayload(payload);
    expect(map).not.toBeNull();
    for (const id of serviceIds) {
      const adapter = map.get(id);
      expect(adapter).toBeDefined();
      expect(['api', 'dom', 'auto']).toContain(adapter.strategy);
      expect(adapter.dom || adapter.api).toBeTruthy();
    }
  });

  it('never points an API endpoint outside the service allow-list', () => {
    // eslint-disable-next-line global-require
    const blocking = require('../src/blocking');
    for (const [id, entry] of Object.entries(payload.adapters)) {
      const api = adapters.normalizeApi(entry.api);
      if (!api) continue;
      const allowed = blocking.buildAllowList(id, rules);
      const host = new URL(api.url).hostname;
      expect(blocking.isDomainAllowed(host, allowed, true, [])).toBe(true);
    }
  });

  it('only references https targets', () => {
    for (const entry of Object.values(payload.adapters)) {
      if (entry.dom && entry.dom.url) expect(entry.dom.url.startsWith('https://')).toBe(true);
      if (entry.api) expect(entry.api.url.startsWith('https://')).toBe(true);
    }
  });
});
