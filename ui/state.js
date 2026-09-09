/**
 * Shared renderer state.
 *
 * A single plain object plus small helpers, so every module reads and writes
 * the same source of truth instead of scattering globals.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const DEFAULT_CONFIG = {
    enabledServices: ['chatgpt', 'claude', 'gemini'],
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

  app.state = {
    config: { ...DEFAULT_CONFIG },
    services: [],
    servicesById: new Map(),
    tabs: [], // ordered, mirrors the tab strip
    currentTabId: null,
    limit: DEFAULT_CONFIG.maxActiveServices,
    blocking: { enabled: true, blocked: 0, allowed: 0 },
    update: null,
    appInfo: null,
    ready: false
  };

  const ELEMENT_IDS = [
    'tabs-list',
    'btn-nav-back',
    'btn-nav-forward',
    'btn-nav-reload',
    'btn-add-tab',
    'sidebar',
    'btn-close-sidebar',
    'service-search',
    'services-list',
    'services-count',
    'webviews-container',
    'welcome-screen',
    'quick-start-services',
    'settings-panel',
    'btn-settings',
    'btn-close-settings',
    'btn-update',
    'btn-update-privacy',
    'btn-clear-session',
    'btn-hibernate',
    'btn-open-log',
    'btn-check-updates',
    'btn-shortcuts',
    'toggle-blocking',
    'toggle-strict-blocking',
    'toggle-dark-mode',
    'toggle-proxy',
    'toggle-minimize-tray',
    'toggle-launch-login',
    'toggle-hibernate',
    'toggle-auto-update',
    'max-services',
    'hibernate-minutes',
    'global-shortcut',
    'proxy-url',
    'last-update',
    'data-source',
    'blocking-stats',
    'status-message',
    'status-text',
    'loading-indicator',
    'blocking-indicator',
    'blocking-text',
    'tab-count',
    'all-services-list',
    'all-services-search',
    'about-version',
    'about-details',
    'update-status',
    'overlay-root',
    'toast-root',
    'shortcuts-modal',
    'btn-close-shortcuts'
  ];

  /** Cache every element the UI touches (call once after DOMContentLoaded). */
  app.cacheElements = function cacheElements() {
    const elements = {};
    for (const id of ELEMENT_IDS) {
      const idCamel = id.replace(/-([a-z])/g, (m, letter) => letter.toUpperCase());
      elements[idCamel] = document.getElementById(id);
    }
    elements.settingsTabs = Array.from(document.querySelectorAll('.settings-tab'));
    elements.settingsTabContents = Array.from(document.querySelectorAll('.settings-tab-content'));
    app.elements = elements;
    return elements;
  };

  // -- Tabs ------------------------------------------------------------------

  app.getTab = function getTab(id) {
    return app.state.tabs.find((tab) => tab.id === id) || null;
  };

  app.getActiveTab = function getActiveTab() {
    return app.getTab(app.state.currentTabId);
  };

  app.upsertTab = function upsertTab(tab) {
    const index = app.state.tabs.findIndex((existing) => existing.id === tab.id);
    if (index === -1) {
      app.state.tabs.push(tab);
      return tab;
    }
    app.state.tabs[index] = { ...app.state.tabs[index], ...tab };
    return app.state.tabs[index];
  };

  app.removeTab = function removeTab(id) {
    const index = app.state.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return null;
    const [removed] = app.state.tabs.splice(index, 1);
    return removed;
  };

  app.serviceById = function serviceById(serviceId) {
    return app.state.servicesById.get(serviceId) || null;
  };

  app.openServiceIds = function openServiceIds() {
    return new Set(app.state.tabs.map((tab) => tab.serviceId));
  };

  app.enabledServices = function enabledServices() {
    const enabled = new Set(app.state.config.enabledServices || []);
    return app.state.services.filter((service) => enabled.has(service.id));
  };

  /** Services matching a free-text query (name or type). */
  app.filterServices = function filterServices(services, query) {
    const term = (query || '').trim().toLowerCase();
    if (!term) return services;
    return services.filter(
      (service) =>
        service.name.toLowerCase().includes(term) ||
        (service.type || '').toLowerCase().includes(term) ||
        service.id.includes(term)
    );
  };
})(window.AiHub);
