/**
 * Renderer bootstrap: load config + catalogue, restore the session, wire the
 * shell UI to the main process.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const utils = window.AiHubUtils;
  const pendingDeepLinks = [];

  // -- Sidebar ---------------------------------------------------------------

  app.openSidebar = function openSidebar() {
    if (!app.elements.sidebar) return;
    app.elements.sidebar.classList.remove('hidden');
    app.renderEnabledServices();
    if (app.elements.serviceSearch) app.elements.serviceSearch.focus();
  };

  app.closeSidebar = function closeSidebar() {
    if (app.elements.sidebar) app.elements.sidebar.classList.add('hidden');
  };

  app.toggleSidebar = function toggleSidebar() {
    if (!app.elements.sidebar) return;
    if (app.elements.sidebar.classList.contains('hidden')) app.openSidebar();
    else app.closeSidebar();
  };

  // -- Data loading ----------------------------------------------------------

  app.loadConfig = async function loadConfig() {
    try {
      const config = await window.electronAPI.getConfig();
      app.state.config = config;
      app.state.limit = config.maxActiveServices || 3;
      app.state.blocking.enabled = config.blockingEnabled !== false;
      app.loadSettingsIntoUI();
    } catch (error) {
      console.error('Unable to load configuration:', error);
      utils.showStatus('Unable to load configuration', 'error');
    }
  };

  app.loadServices = async function loadServices() {
    try {
      const data = await window.electronAPI.getServices();
      const services = (data && data.ai_services) || [];

      app.state.services = services;
      app.state.servicesById = new Map(services.map((service) => [service.id, service]));

      if (services.length === 0) {
        app.toast('Service catalogue is empty. Open Settings and run an update.', 'warning');
      }

      app.renderEnabledServices();
      app.renderAllServices();
      return services;
    } catch (error) {
      console.error('Unable to load services:', error);
      app.toast('Unable to load the service catalogue', 'error');
      return [];
    }
  };

  // -- Session restore -------------------------------------------------------

  async function restoreSession() {
    const { openTabs, activeTabId } = app.state.config;
    if (!Array.isArray(openTabs) || openTabs.length === 0) {
      app.showWelcome();
      return;
    }

    const restored = [];
    for (const saved of openTabs) {
      const serviceId = saved.serviceId || saved.id;
      const service = app.serviceById(serviceId);
      if (!service) {
        app.toast(`Skipped ${saved.id || serviceId}: no longer in the catalogue`, 'warning');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const tab = await app.createTab({
        serviceId,
        url: saved.url || service.url,
        title: saved.title || service.name,
        tabId: saved.id
      });
      if (tab) restored.push(tab);
    }

    if (restored.length === 0) {
      app.showWelcome();
      return;
    }

    const active = restored.find((tab) => tab.id === activeTabId) || restored[0];
    app.switchToTab(active.id);
    app.hideWelcome();
  }

  // -- View bounds -----------------------------------------------------------

  function initViewBounds() {
    const container = app.elements.webviewsContainer;
    if (!container) return;

    const report = utils.rafThrottle(() => {
      const rect = container.getBoundingClientRect();
      window.electronAPI.setViewBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    });

    window.addEventListener('resize', report);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(report).observe(container);
    }
    document.fonts && document.fonts.ready && document.fonts.ready.then(report);
    // Give the layout a frame to settle before the first report.
    requestAnimationFrame(report);
    setTimeout(report, 250);
  }

  // -- Deep links ------------------------------------------------------------

  function openServiceFromDeepLink(serviceId) {
    const service = app.serviceById(serviceId);
    if (!service) {
      app.toast(`Unknown service: ${serviceId}`, 'warning');
      return;
    }
    app.createTab({ serviceId: service.id, url: service.url, title: service.name });
  }

  function initDeepLinks() {
    if (!window.electronAPI.onDeepLinkOpen) return;
    window.electronAPI.onDeepLinkOpen((serviceId) => {
      if (!app.state.ready) {
        pendingDeepLinks.push(serviceId);
        return;
      }
      openServiceFromDeepLink(serviceId);
    });
  }

  // -- Misc listeners --------------------------------------------------------

  function initGlobalListeners() {
    if (window.electronAPI.onBlockingState) {
      window.electronAPI.onBlockingState((snapshot) => {
        app.state.blocking = { ...app.state.blocking, ...snapshot };
        utils.updateBlockingUI(app.state.blocking);
      });
    }

    if (window.electronAPI.onUpdateState) {
      window.electronAPI.onUpdateState((status) => app.renderUpdateStatus(status));
    }

    const addTabBtn = app.elements.btnAddTab;
    if (addTabBtn) {
      addTabBtn.addEventListener('click', () => app.openSidebar());
      addTabBtn.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          app.openSidebar();
        }
      });
    }

    const closeSidebarBtn = app.elements.btnCloseSidebar;
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => app.closeSidebar());

    const settingsBtn = app.elements.btnSettings;
    if (settingsBtn) settingsBtn.addEventListener('click', () => app.openSettings());

    const back = app.elements.btnNavBack;
    const forward = app.elements.btnNavForward;
    const reload = app.elements.btnNavReload;
    if (back) back.addEventListener('click', () => app.state.currentTabId && window.electronAPI.navGoBack(app.state.currentTabId));
    if (forward) forward.addEventListener('click', () => app.state.currentTabId && window.electronAPI.navGoForward(app.state.currentTabId));
    if (reload) reload.addEventListener('click', () => app.state.currentTabId && window.electronAPI.navReload(app.state.currentTabId));

    // A click anywhere dismisses an open context menu.
    document.addEventListener('click', () => app.closeContextMenu());
  }

  function updateWelcomeCopy() {
    const heading = document.querySelector('#welcome-screen h2');
    if (!heading) return;
    const enabled = app.state.config.enabledServices || [];
    heading.textContent =
      enabled.length === 0 ? 'Welcome to AI Hub Desktop' : 'Which assistant are we opening today?';
  }

  // -- Boot ------------------------------------------------------------------

  async function init() {
    app.cacheElements();
    if (app.initMotion) app.initMotion();
    initGlobalListeners();
    app.initTabListeners();
    app.initSettings();
    app.initShortcuts();
    initDeepLinks();
    initViewBounds();

    await app.loadConfig();
    await app.loadServices();
    updateWelcomeCopy();

    await restoreSession();

    app.state.ready = true;
    while (pendingDeepLinks.length > 0) {
      openServiceFromDeepLink(pendingDeepLinks.shift());
    }

    app.updateTabCount();
    app.refreshPrivacyInfo();
    utils.showStatus('Ready', 'info');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => {
        console.error('Startup failed:', error);
        utils.showStatus('Startup failed, see the log file', 'error');
      });
    });
  } else {
    init().catch((error) => {
      console.error('Startup failed:', error);
    });
  }
})(window.AiHub);
