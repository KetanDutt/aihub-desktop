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
  'sessions.js',
  'apipanel.js',
  'tabs.js',
  'findbar.js',
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
  color: '10a37f',
  homepage: 'https://chatgpt.com/',
  loginUrl: 'https://chatgpt.com/auth/login',
  requiresLogin: true,
  icon: 'data:image/svg+xml;base64,PHN2Zy8+',
  hasApiAdapter: true
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
  activeTabId: null,
  sessionPersistence: true,
  autoRelogin: true,
  isolateSessions: false,
  keepAliveSessions: true,
  keepAliveMinutes: 45,
  antiBotHardening: true,
  antiBotHumanize: true,
  antiBotCanvasNoise: false,
  apiEnabled: false,
  apiPort: 8788,
  apiExposeAllServices: true,
  apiServices: [],
  serviceUsage: { chatgpt: Date.now() },
  logins: { chatgpt: { state: 'logged-in' } }
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
    getServiceDetails: jest.fn().mockResolvedValue(null),
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
    navReloadHard: jest.fn(),
    navStop: jest.fn(),
    navHome: jest.fn(),
    setZoom: jest.fn().mockResolvedValue(1),
    setMuted: jest.fn().mockResolvedValue(true),
    findInPage: jest.fn().mockResolvedValue({ requestId: 1 }),
    stopFindInPage: jest.fn().mockResolvedValue(true),
    openDevTools: jest.fn().mockResolvedValue(false),
    clearSessionData: jest.fn().mockResolvedValue({ success: true }),
    openExternal: jest.fn().mockResolvedValue(true),
    getBlockingStats: jest.fn().mockResolvedValue({ enabled: true, blocked: 0, allowed: 0 }),
    getLoginStates: jest.fn().mockResolvedValue({ chatgpt: { state: 'logged-in', reason: 'session-cookie', expiresAt: Date.now() + 86400000 } }),
    getSessionStats: jest.fn().mockResolvedValue({
      logins: { chatgpt: { state: 'logged-in', reason: 'session-cookie', hasSnapshot: true } },
      perService: { chatgpt: { serviceId: 'chatgpt', cookies: 7, authCookies: 3, pinned: 2, isolated: false, cacheSize: 2048 } },
      hardening: { enabled: true, attachedTabs: 1, chromeMajor: '141', languages: ['en-US'], humanize: true, canvasNoise: false },
      isolation: false,
      persistence: true,
      keepAlive: { enabled: true, minutes: 45 },
      snapshots: 1,
      usage: { chatgpt: Date.now() }
    }),
    reloginService: jest.fn().mockResolvedValue({ ok: true }),
    clearServiceData: jest.fn().mockResolvedValue({ success: true, cleared: 4 }),
    touchSession: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
    getApiStatus: jest.fn().mockResolvedValue({
      enabled: false,
      listening: false,
      baseUrl: 'http://127.0.0.1:8788/v1',
      port: 8788,
      key: 'aihub-test',
      keyMasked: 'aihub-…test',
      models: [{ id: 'aihub/chatgpt', login: 'logged-in', strategy: 'api' }],
      modelCount: 1,
      ready: 1,
      exposeAll: true,
      counters: { requests: 2, completed: 2, failed: 0, cancelled: 0, streaming: 1 },
      queue: { active: 0, queued: 0, limit: 2 },
      recent: [{ route: '/v1/chat/completions', model: 'aihub/chatgpt', status: 200, ms: 812, stream: true }]
    }),
    rotateApiToken: jest.fn().mockResolvedValue({ ok: true, key: 'aihub-rotated', keyMasked: 'aihub-…ated' }),
    apiPing: jest.fn().mockResolvedValue({ ok: true, status: 200, body: '{"ok":true}' }),
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
    onTabFindResult: noopSubscribe,
    onBlockingState: noopSubscribe,
    onUpdateState: noopSubscribe,
    onLoginState: noopSubscribe,
    onSessionState: noopSubscribe,
    onApiState: noopSubscribe
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

  it('normalises tab-state payloads (tabId -> id) and opens the find bar', async () => {
    installElectronApiStub();
    loadShell();
    await flush();

    const tab = await window.AiHub.createTab({ serviceId: 'chatgpt', url: SERVICE.url, title: 'ChatGPT' });
    expect(tab).toBeTruthy();

    // Main process sends `tabId`, not `id` — upsert must not create a ghost entry.
    window.AiHub.applyTabState({
      tabId: tab.id,
      title: 'ChatGPT — updated',
      url: SERVICE.url,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      hibernated: false,
      active: true,
      zoomFactor: 1.25,
      muted: false
    });
    expect(window.AiHub.state.tabs.length).toBe(1);
    expect(window.AiHub.getTab(tab.id).title).toBe('ChatGPT — updated');
    expect(window.AiHub.getTab(tab.id).zoomFactor).toBe(1.25);

    window.AiHub.openFindBar();
    expect(window.AiHub.isFindBarOpen()).toBe(true);
    expect(document.getElementById('find-bar')).toBeTruthy();

    window.AiHub.closeFindBar();
    expect(window.AiHub.isFindBarOpen()).toBe(false);
  });

  it('drives the per-tab browser controls and swaps reload for stop while loading', async () => {
    const api = installElectronApiStub();
    loadShell();
    await flush();

    const tab = await window.AiHub.createTab({ serviceId: 'chatgpt', url: SERVICE.url, title: 'ChatGPT' });
    window.AiHub.applyTabState({
      tabId: tab.id,
      loading: false,
      canGoBack: true,
      canGoForward: false,
      active: true
    });

    const back = document.getElementById('btn-nav-back');
    const forward = document.getElementById('btn-nav-forward');
    const reload = document.getElementById('btn-nav-reload');
    const stop = document.getElementById('btn-nav-stop');
    const home = document.getElementById('btn-nav-home');

    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);
    expect(home.disabled).toBe(false);
    expect(stop.classList.contains('hidden')).toBe(true);

    back.click();
    expect(api.navGoBack).toHaveBeenCalledWith(tab.id);

    reload.click();
    expect(api.navReload).toHaveBeenCalledWith(tab.id);

    // Shift-click is the "ignore the cache" gesture.
    reload.dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(api.navReloadHard).toHaveBeenCalledWith(tab.id);

    home.click();
    expect(api.navHome).toHaveBeenCalledWith(tab.id);

    // While loading, Stop replaces Reload.
    window.AiHub.applyTabState({ tabId: tab.id, loading: true, active: true });
    expect(reload.classList.contains('hidden')).toBe(true);
    expect(stop.classList.contains('hidden')).toBe(false);

    stop.click();
    expect(api.navStop).toHaveBeenCalledWith(tab.id);

    window.AiHub.applyTabState({ tabId: tab.id, loading: false, active: true });
    expect(stop.classList.contains('hidden')).toBe(true);
    expect(reload.classList.contains('hidden')).toBe(false);
  });

  it('offers per-tab navigation actions in the tab context menu', async () => {
    const api = installElectronApiStub();
    loadShell();
    await flush();

    const tab = await window.AiHub.createTab({ serviceId: 'chatgpt', url: SERVICE.url, title: 'ChatGPT' });
    // Settle the tab so the menu offers Reload rather than Stop.
    window.AiHub.applyTabState({ tabId: tab.id, loading: false, active: true });

    const node = document.querySelector(`.tab-item[data-id="${tab.id}"]`);
    node.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));

    const labels = Array.from(document.querySelectorAll('.context-menu .context-item')).map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Back', 'Forward', 'Reload', 'Reload, ignoring the cache', 'Home']));

    const homeItem = Array.from(document.querySelectorAll('.context-menu .context-item')).find(
      (el) => el.textContent === 'Home'
    );
    homeItem.click();
    expect(api.navHome).toHaveBeenCalledWith(tab.id);
  });

  it('shows audited service details in the service context menu', async () => {
    const api = installElectronApiStub();
    loadShell();
    await flush();

    const card = document.querySelector('.service-card');
    card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));

    const menu = document.querySelector('.context-menu');
    const headers = Array.from(menu.querySelectorAll('.context-header')).map((el) => el.textContent);
    // Homepage, sign-in requirement and adapter availability come from the catalogue.
    expect(headers).toEqual(expect.arrayContaining(['ChatGPT', 'https://chatgpt.com/']));
    expect(headers.some((text) => text.startsWith('Sign-in required'))).toBe(true);
    expect(headers).toContain('Local API can drive this service');

    // The stub reports an active session, so the entry reads "Open the sign-in page".
    const signIn = Array.from(menu.querySelectorAll('.context-item')).find(
      (el) => el.textContent === 'Open the sign-in page' || el.textContent === 'Sign in…'
    );
    expect(signIn).toBeTruthy();
    signIn.click();
    expect(api.createTab).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://chatgpt.com/auth/login', serviceId: 'chatgpt' })
    );
  });

  it('reopens the last closed tab with its url, zoom and mute state', async () => {
    const api = installElectronApiStub();
    loadShell();
    await flush();

    const tab = await window.AiHub.createTab({ serviceId: 'chatgpt', url: SERVICE.url, title: 'ChatGPT' });
    window.AiHub.applyTabState({ tabId: tab.id, url: 'https://chatgpt.com/c/42', zoomFactor: 1.25, muted: true, active: true });

    await window.AiHub.closeTab(tab.id);
    expect(window.AiHub.state.tabs.length).toBe(0);
    expect(window.AiHub.closedTabCount()).toBe(1);

    api.createTab.mockClear();
    const reopened = await window.AiHub.reopenClosedTab();
    expect(reopened).toBeTruthy();
    expect(api.createTab).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://chatgpt.com/c/42', zoomFactor: 1.25, muted: true })
    );
    // The stack is consumed, so a second attempt has nothing left.
    expect(window.AiHub.closedTabCount()).toBe(0);
  });

  it('uses the catalogue icon for tabs instead of fetching a favicon', async () => {
    const api = installElectronApiStub();
    loadShell();
    await flush();

    await window.AiHub.createTab({ serviceId: 'chatgpt', url: SERVICE.url, title: 'ChatGPT' });
    await flush(50);

    expect(api.getFavicon).not.toHaveBeenCalled();
    const img = document.querySelector('.tab-item .tab-favicon img');
    expect(img.src).toBe(SERVICE.icon);
  });
});
