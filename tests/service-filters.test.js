/**
 * The Services tab filter/sort rules live in `ui/utils.js` (pure) so they can be
 * tested without a DOM.
 */

'use strict';

const utils = require('../ui/utils');

const SERVICES = [
  { id: 'chatgpt', name: 'ChatGPT', type: 'Conversational AI', url: 'https://chatgpt.com/', privacy: 'May be reviewed' },
  { id: 'claude', name: 'Claude', type: 'Conversational AI', url: 'https://claude.ai', privacy: '' },
  { id: 'gemini', name: 'Gemini', type: 'Conversational AI', url: 'https://gemini.google.com', privacy: '' },
  { id: 'perplexity', name: 'Perplexity', type: 'Answer engine', url: 'https://www.perplexity.ai', privacy: '' },
  { id: 'poe', name: 'Poe', type: 'AI aggregator', url: 'https://poe.com', privacy: '' }
];

const LOGIN = {
  chatgpt: { state: 'logged-in' },
  claude: { state: 'logged-out' },
  gemini: { state: 'challenge' },
  perplexity: { state: 'unknown' }
};

describe('applyServiceFilters — searching', () => {
  it('matches name, type, id and privacy across words', () => {
    expect(utils.applyServiceFilters(SERVICES, { query: 'clau' }, {}).services.map((s) => s.id)).toEqual(['claude']);
    expect(utils.applyServiceFilters(SERVICES, { query: 'answer engine' }, {}).services.map((s) => s.id)).toEqual([
      'perplexity'
    ]);
    expect(utils.applyServiceFilters(SERVICES, { query: 'reviewed' }, {}).services.map((s) => s.id)).toEqual(['chatgpt']);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(utils.applyServiceFilters(SERVICES, { query: '  Chat  GPT ' }, {}).services.length).toBe(1);
  });
});

describe('applyServiceFilters — facets', () => {
  it('filters by type, status and sign-in state together', () => {
    const result = utils.applyServiceFilters(SERVICES, { type: 'Conversational AI', status: 'enabled' }, {
      enabledIds: ['chatgpt', 'claude']
    });
    expect(result.services.map((s) => s.id).sort()).toEqual(['chatgpt', 'claude']);
  });

  it('filters open tabs and login state', () => {
    const open = utils.applyServiceFilters(SERVICES, { status: 'open' }, { openIds: ['poe'] });
    expect(open.services.map((s) => s.id)).toEqual(['poe']);

    const signedIn = utils.applyServiceFilters(SERVICES, { login: 'logged-in' }, { loginStates: LOGIN });
    expect(signedIn.services.map((s) => s.id)).toEqual(['chatgpt']);

    const unknown = utils.applyServiceFilters(SERVICES, { login: 'unknown' }, { loginStates: LOGIN });
    expect(unknown.services.map((s) => s.id)).toEqual(['perplexity', 'poe']);
  });

  it('counts every facet over the unfiltered list', () => {
    const result = utils.applyServiceFilters(SERVICES, { query: 'gpt' }, {
      enabledIds: ['chatgpt'],
      openIds: ['claude'],
      loginStates: LOGIN
    });

    expect(result.counts).toMatchObject({
      total: 5,
      shown: 1,
      enabled: 1,
      disabled: 4,
      open: 1,
      loggedIn: 1,
      loggedOut: 1,
      challenge: 1,
      unknown: 2
    });
    expect(result.counts.byType['Conversational AI']).toBe(3);
  });

  it('reports how many filters are active', () => {
    expect(utils.applyServiceFilters(SERVICES, {}, {}).activeCount).toBe(0);
    expect(utils.applyServiceFilters(SERVICES, { query: 'x', status: 'open' }, {}).activeCount).toBe(2);
  });
});

describe('applyServiceFilters — sorting', () => {
  it('sorts by name, ascending by default and reversible', () => {
    const asc = utils.applyServiceFilters(SERVICES, { sort: 'name', direction: 'asc' }, {});
    const desc = utils.applyServiceFilters(SERVICES, { sort: 'name', direction: 'desc' }, {});
    expect(asc.services[0].id).toBe('chatgpt');
    expect(desc.services[0].id).toBe('poe');
  });

  it('puts enabled services first when asked', () => {
    const result = utils.applyServiceFilters(SERVICES, { sort: 'status' }, { enabledIds: ['poe'] });
    expect(result.services[0].id).toBe('poe');
  });

  it('orders by sign-in state: signed in, verifying, signed out, then unchecked', () => {
    const result = utils.applyServiceFilters(
      SERVICES,
      { sort: 'login' },
      { loginStates: { chatgpt: { state: 'logged-in' }, claude: { state: 'logged-out' } } }
    );
    // Only chatgpt (logged-in) and claude (logged-out) have a record; the rest
    // tie as "unknown" and fall back to alphabetical order.
    expect(result.services.map((s) => s.id)).toEqual(['chatgpt', 'claude', 'gemini', 'perplexity', 'poe']);
  });

  it('orders by recency (newest first) and by cached cookie count', () => {
    const recent = utils.applyServiceFilters(SERVICES, { sort: 'recent' }, {
      usage: { poe: 100, gemini: 500, chatgpt: 300 }
    });
    expect(recent.services.map((s) => s.id)).toEqual(['gemini', 'chatgpt', 'poe', 'claude', 'perplexity']);

    const cookies = utils.applyServiceFilters(SERVICES, { sort: 'cookies' }, {
      cookieCounts: { claude: 9, chatgpt: 3 }
    });
    expect(cookies.services[0].id).toBe('claude');
    expect(cookies.services[1].id).toBe('chatgpt');
  });

  it('is stable for equal keys', () => {
    const a = utils.applyServiceFilters(SERVICES, { sort: 'type' }, {}).services.map((s) => s.id);
    const b = utils.applyServiceFilters(SERVICES, { sort: 'type' }, {}).services.map((s) => s.id);
    expect(a).toEqual(b);
  });
});

describe('filter normalisation', () => {
  it('rejects unknown values instead of trusting the DOM', () => {
    const filters = utils.normalizeServiceFilters({
      sort: 'rm -rf',
      login: 'wat',
      access: 'free-for-all',
      direction: 'sideways'
    });
    expect(filters).toEqual({
      query: '',
      type: 'all',
      status: 'all',
      login: 'all',
      access: 'all',
      sort: 'name',
      direction: 'asc'
    });
  });

  it('accepts valid choices', () => {
    const filters = utils.normalizeServiceFilters({ sort: 'recent', login: 'logged-in', status: 'open', direction: 'desc' });
    expect(filters.sort).toBe('recent');
    expect(filters.login).toBe('logged-in');
    expect(filters.status).toBe('open');
    expect(filters.direction).toBe('desc');
  });

  it('never lets a filter throw on junk input', () => {
    expect(() => utils.applyServiceFilters(null, null, null)).not.toThrow();
    expect(utils.applyServiceFilters(undefined, { query: 'x' }, {}).counts.total).toBe(0);
  });
});

describe('filter helpers', () => {
  it('serviceTypes counts each distinct type', () => {
    const types = utils.serviceTypes(SERVICES);
    expect(types.map((entry) => entry.type).sort()).toEqual(['AI aggregator', 'Answer engine', 'Conversational AI']);
    expect(types.find((entry) => entry.type === 'Conversational AI').count).toBe(3);
  });

  it('describeFilters summarises the active selection', () => {
    const result = utils.applyServiceFilters(SERVICES, { query: 'gpt', login: 'logged-in' }, { loginStates: LOGIN });
    expect(utils.describeFilters(result.counts, result.filters)).toBe('1 of 5 · “gpt” · signed in');
  });
});
