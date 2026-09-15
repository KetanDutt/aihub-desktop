/**
 * Services tab rendering (jsdom): free sites are shown apart from the ones that
 * want a sign-in — a chip on the row, a filter, and section headings.
 *
 * @jest-environment jsdom
 */

'use strict';

const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'ui');
const SCRIPTS = [
  'utils.js',
  'state.js',
  'motion.js',
  'overlays.js',
  'services.js',
  'sessions.js',
  'apipanel.js',
  'tabs.js',
  'findbar.js',
  'settings.js',
  'shortcuts.js',
  'renderer.js'
];

const SERVICES = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    type: 'Conversational AI',
    privacy: '',
    color: '10a37f',
    requiresLogin: true
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    type: 'Answer engine',
    privacy: '',
    color: '20808d',
    requiresLogin: false
  }
];

const BASE_CONFIG = {
  enabledServices: ['chatgpt', 'perplexity'],
  blockingEnabled: true,
  strictBlocking: false,
  maxActiveServices: 3,
  hibernateTabs: true,
  hibernateAfterMinutes: 15,
  darkMode: true,
  minimizeToTray: true,
  launchAtLogin: false,
  useProxy: false,
  proxyUrl: '',
  globalShortcut: 'CommandOrControl+Shift+A',
  autoUpdateServices: true,
  lastUpdate: null,
  openTabs: [],
  activeTabId: null,
  sessionPersistence: true,
  autoRelogin: true,
  isolateSessions: false,
  keepAliveSessions: true,
  keepAliveMinutes: 45,
  antiBotHardening: true,
  antiBotHumanize: true,
  antiBotCanvasNoise: false,
  apiEnabled: true,
  apiPort: 8788,
  apiExposeAllServices: true,
  apiServices: [],
  serviceUsage: {},
  logins: { chatgpt: { state: 'logged-out' }, perplexity: { state: 'unknown' } }
};

/**
 * A forgiving `electronAPI`: known calls return realistic payloads, unknown
 * ones resolve harmlessly, and `on*` channels are no-op subscriptions.
 */
function installElectronApiStub() {
  const known = {
    platform: 'linux',
    versions: { electron: '0', chrome: '0', node: '0' },
    getConfig: jest.fn().mockResolvedValue({ ...BASE_CONFIG }),
    saveConfig: jest.fn().mockImplementation(async (patch) => ({ success: true, config: { ...BASE_CONFIG, ...patch } })),
    getAppInfo: jest.fn().mockResolvedValue({
      name: 'AI Hub Desktop',
      version: '1.5.0',
      electron: '41',
      chrome: '130',
      node: '22',
      platform: 'linux',
      arch: 'x64',
      packaged: false,
      userDataPath: '/tmp',
      dataPath: '/tmp',
      logPath: '/tmp/main.log',
      data: { servicesSource: 'bundled', rulesSource: 'bundled', serviceCount: 2, ruleCount: 1, lastUpdate: null, isStale: false },
      blocking: { enabled: true, blocked: 0, allowed: 0, tabs: 0 },
      tabs: [],
      update: { status: 'idle', currentVersion: '1.5.0' },
      shortcut: 'CommandOrControl+Shift+A'
    }),
    getServices: jest.fn().mockResolvedValue({ schemaVersion: 1, ai_services: SERVICES, serviceCount: 2 }),
    getRules: jest.fn().mockResolvedValue({ service_domains: { chatgpt: ['openai.com'], perplexity: ['perplexity.ai'] } }),
    getFavicon: jest.fn().mockResolvedValue({ dataUrl: null }),
    getLimits: jest.fn().mockResolvedValue({ maxTabs: 0, limit: 3, minTabs: 1, hardMax: 20 }),
    getTabStates: jest.fn().mockResolvedValue([]),
    getLoginStates: jest.fn().mockResolvedValue({
      chatgpt: { state: 'logged-out', reason: 'no-session' },
      perplexity: { state: 'unknown' }
    }),
    getSessionStats: jest.fn().mockResolvedValue({ logins: {}, perService: {}, hardening: {}, snapshots: 0 }),
    getApiStatus: jest.fn().mockResolvedValue({
      enabled: true,
      listening: true,
      baseUrl: 'http://127.0.0.1:8788/v1',
      port: 8788,
      key: 'aihub-test',
      keyMasked: 'aihub-…test',
      models: [
        {
          id: 'aihub/chatgpt',
          login: 'logged-out',
          strategy: 'auto',
          requiresLogin: true,
          description: 'ChatGPT (default: gpt-5) · direct API · sign in required'
        },
        {
          id: 'aihub/perplexity',
          login: 'unknown',
          strategy: 'dom',
          requiresLogin: false,
          description: 'Perplexity (default: sonar) · browser driver · free, no sign-in needed'
        }
      ],
      modelCount: 2,
      readyModelCount: 1,
      freeModelCount: 1,
      exposeAll: true,
      counters: { requests: 0, completed: 0, failed: 0, cancelled: 0, streaming: 0 },
      queue: { active: 0, queued: 0, limit: 2 },
      recent: []
    })
  };

  window.electronAPI = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
      return jest.fn().mockResolvedValue({ success: true });
    }
  });

  return window.electronAPI;
}

function loadShell() {
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  document.body.innerHTML = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
  for (const script of SCRIPTS) {
    window.eval(fs.readFileSync(path.join(UI_DIR, script), 'utf8'));
  }
}

const flush = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

describe('services tab — free vs sign-in', () => {
  beforeEach(async () => {
    installElectronApiStub();
    loadShell();
    await flush();
  });

  it('renders both services and marks only the free one', () => {
    window.AiHub.renderAllServices();
    const rows = document.querySelectorAll('#all-services-list .service-item');
    expect(rows.length).toBe(2);

    const chips = document.querySelectorAll('#all-services-list .free-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toBe('No sign-in');
    expect(rows[1].querySelector('.free-chip')).toBeTruthy(); // perplexity, sorted after ChatGPT
  });

  it('offers no “Sign in” button for a service that needs no account', () => {
    window.AiHub.renderAllServices();
    const buttons = [...document.querySelectorAll('#all-services-list .service-item')].map((row) =>
      [...row.querySelectorAll('button')].map((b) => b.textContent)
    );
    const byId = new Map(
      [...document.querySelectorAll('#all-services-list .service-item')].map((row) => [row.dataset.id, row])
    );
    expect(byId.get('chatgpt').textContent).toContain('Sign in');
    expect(byId.get('perplexity').textContent).toContain('No sign-in needed');
    expect(byId.get('perplexity').querySelectorAll('button').length).toBe(0);
    void buttons;
  });

  it('separates the two groups under headings when sorting “Free first”', () => {
    document.getElementById('sort-services').value = 'access';
    window.AiHub.renderAllServices();

    const headers = [...document.querySelectorAll('#all-services-list .service-group-header')];
    expect(headers.map((h) => h.textContent)).toEqual(['No sign-in needed1', 'Sign-in required1']);

    const order = [...document.querySelectorAll('#all-services-list .service-item')].map((r) => r.dataset.id);
    expect(order).toEqual(['perplexity', 'chatgpt']);
  });

  it('filters to the free services through the access dropdown', () => {
    document.getElementById('filter-access').value = 'free';
    window.AiHub.renderAllServices();

    const rows = [...document.querySelectorAll('#all-services-list .service-item')].map((r) => r.dataset.id);
    expect(rows).toEqual(['perplexity']);

    document.getElementById('filter-access').value = 'signin';
    window.AiHub.renderAllServices();
    expect([...document.querySelectorAll('#all-services-list .service-item')].map((r) => r.dataset.id)).toEqual([
      'chatgpt'
    ]);
  });

  it('keeps the access choice in the persisted filter state', () => {
    const select = document.getElementById('filter-access');
    select.value = 'free';
    select.dispatchEvent(new window.Event('change'));
    expect(window.AiHub.state.serviceFilters.access).toBe('free');
  });

  it('marks free models in the local API panel', async () => {
    await window.AiHub.refreshApi();
    const badges = [...document.querySelectorAll('#api-model-list .login-chip')].map((b) => b.textContent);
    expect(badges).toEqual(['sign in', 'free']);
    expect(document.querySelectorAll('#api-model-list .api-model-description').length).toBe(2);
  });
});
