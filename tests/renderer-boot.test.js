/**
 * Renderer boot/integration test.
 *
 * Loads the *real* `ui/index.html` markup and executes every shell script in
 * order under jsdom, with a stubbed `electronAPI`. This proves the redesigned
 * shell (including `motion.js` gliding indicators, overlays and the settings
 * drawer) boots and drives its core flows without runtime errors.
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
  'tabs.js',
  'settings.js',
  'shortcuts.js',
  'renderer.js'
];

const SERVICE = {
  id: 'chatgpt',
  name: 'ChatGPT',
  url: 'https://chatgpt.com/',
  type: 'Conversational AI',
  privacy: 'Test',
  color: '10a37f'
};

const BASE_CONFIG = {
  enabledServices: ['chatgpt'],
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
  activeTabId: null
};

function installElectronApiStub() {
  const noopSubscribe = () => () => {};
  const api = {
    platform: 'linux',
    versions: { electron: '0', chrome: '0', node: '0' },
    getConfig: jest.fn().mockResolvedValue({ ...BASE_CONFIG }),
    saveConfig: jest.fn().mockImplementation(async (patch) => ({
      success: true,
      config: { ...BASE_CONFIG, ...patch }
    })),
    getAppInfo: jest.fn().mockResolvedValue({
      name: 'AI Hub Desktop',
      version: '1.2.0',
      electron: '41',
      chrome: '130',
      node: '22',
      platform: 'linux',
      arch: 'x64',
      packaged: false,
      userDataPath: '/tmp',
      dataPath: '/tmp',
      logPath: '/tmp/main.log',
      data: { servicesSource: 'bundled', rulesSource: 'bundled', serviceCount: 1, ruleCount: 1, lastUpdate: null, isStale: true },
      blocking: { enabled: true, blocked: 0, allowed: 0, tabs: 0 },
      tabs: [],
      update: { status: 'idle', currentVersion: '1.2.0' },
      shortcut: 'CommandOrControl+Shift+A'
    }),
    getServices: jest.fn().mockResolvedValue({ schemaVersion: 1, ai_services: [SERVICE], serviceCount: 1 }),
    getRules: jest.fn().mockResolvedValue({ service_domains: { chatgpt: ['openai.com'] } }),
    updateRemoteData: jest.fn().mockResolvedValue({ success: true, services: 1, rules: 1 }),
    toggleService: jest.fn().mockResolvedValue(['chatgpt']),
    getFavicon: jest.fn().mockResolvedValue({ dataUrl: null }),
    createTab: jest.fn().mockResolvedValue({ success: true, tabId: 'chatgpt-1' }),
    closeTab: jest.fn(),
    closeOtherTabs: jest.fn(),
    switchTab: jest.fn(),
    reorderTabs: jest.fn(),
    getTabStates: jest.fn().mockResolvedValue([]),
    hibernateTabs: jest.fn().mockResolvedValue({ hibernated: [] }),
    getLimits: jest.fn().mockResolvedValue({ maxTabs: 0, limit: 3, minTabs: 1, hardMax: 20 }),
    setActiveService: jest.fn(),
    setViewBounds: jest.fn(),
    navGoBack: jest.fn(),
    navGoForward: jest.fn(),
    navReload: jest.fn(),
    setZoom: jest.fn().mockResolvedValue(1),
    openDevTools: jest.fn().mockResolvedValue(false),
    clearSessionData: jest.fn().mockResolvedValue({ success: true }),
    openExternal: jest.fn().mockResolvedValue(true),
    getBlockingStats: jest.fn().mockResolvedValue({ enabled: true, blocked: 0, allowed: 0 }),
    checkForUpdates: jest.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: '1.2.0' }),
    getUpdateStatus: jest.fn().mockResolvedValue({ status: 'idle', currentVersion: '1.2.0' }),
    quitAndInstall: jest.fn().mockResolvedValue(false),
    minimize: jest.fn(),
    toggleMaximize: jest.fn(),
    close: jest.fn(),
    quit: jest.fn(),
    onDeepLinkOpen: noopSubscribe,
    onTabState: noopSubscribe,
    onTabCreated: noopSubscribe,
    onTabClosed: noopSubscribe,
    onTabsEmptied: noopSubscribe,
    onTabBlocked: noopSubscribe,
    onBlockingState: noopSubscribe,
    onUpdateState: noopSubscribe
  };
  window.electronAPI = api;
  return api;
}

function loadShell() {
  // Put the real markup (without <script> tags) into the document.
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  document.body.innerHTML = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');

  for (const script of SCRIPTS) {
    const code = fs.readFileSync(path.join(UI_DIR, script), 'utf8');
    // Evaluate inside the jsdom realm so window/document/CSS/rAF resolve.
    window.eval(code);
  }
}

const flush = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));

describe('shell renderer', () => {
  it('boots, loads config + services and shows the welcome screen', async () => {
    installElectronApiStub();
    loadShell();
    await flush();

    expect(window.AiHub.state.ready).toBe(true);
    expect(window.AiHub.state.services.map((s) => s.id)).toEqual(['chatgpt']);
    expect(window.AiHub.elements.tabsList).toBeTruthy();

    // Sidebar renders the enabled service card.
    expect(document.querySelectorAll('.service-card').length).toBe(1);
    // Welcome quick-start shows the pinned service.
    expect(document.querySelectorAll('.quick-start-item').length).toBe(1);
  });

  it('opens a tab, glides the indicator, then closes back to the welcome screen', async () => {
    installElectronApiStub();
    loadShell();
    await flush();

    const tab = await window.AiHub.createTab({ serviceId: 'chatgpt', url: SERVICE.url, title: 'ChatGPT' });
    expect(tab).toBeTruthy();
    expect(window.AiHub.state.tabs.length).toBe(1);
    expect(document.querySelectorAll('.tab-item').length).toBe(1);

    // The gliding glass indicator exists and is tracking the active tab.
    const glide = document.querySelector('.tab-glide');
    expect(glide).toBeTruthy();
    expect(glide.classList.contains('glide-hidden')).toBe(false);

    // Settings drawer slides its own indicator.
    window.AiHub.openSettings('services');
    await flush(50);
    const settingsGlide = document.querySelector('.settings-glide');
    expect(settingsGlide).toBeTruthy();

    // Closing the only tab returns to the welcome screen.
    await window.AiHub.closeTab(tab.id);
    expect(window.AiHub.state.tabs.length).toBe(0);
    expect(document.querySelectorAll('.tab-item').length).toBe(0);
    expect(window.AiHub.elements.welcomeScreen.classList.contains('hidden')).toBe(false);
  });

  it('shows a toast and a confirm dialog without throwing', async () => {
    installElectronApiStub();
    loadShell();
    await flush();

    window.AiHub.toast('Hello', 'success');
    expect(document.querySelectorAll('.toast').length).toBe(1);

    const pending = window.AiHub.confirm({ title: 'T', message: 'M' });
    expect(document.querySelectorAll('.modal-backdrop').length).toBeGreaterThan(0);
    document.querySelector('#overlay-root .modal-actions .btn-primary').click();
    await expect(pending).resolves.toBe(true);
  });
});
