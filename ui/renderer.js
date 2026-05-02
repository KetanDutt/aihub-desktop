// renderer.js - Frontend Logic

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const elements = {
    tabsList: document.getElementById('tabs-list'),
                          btnNavBack: document.getElementById('btn-nav-back'),
                          btnNavForward: document.getElementById('btn-nav-forward'),
                          btnNavReload: document.getElementById('btn-nav-reload'),
                          addTabBtn: document.getElementById('btn-add-tab'),
                          sidebar: document.getElementById('sidebar'),
                          closeSidebarBtn: document.getElementById('btn-close-sidebar'),
                          servicesList: document.getElementById('services-list'),
                          webviewsContainer: document.getElementById('webviews-container'),
                          welcomeScreen: document.getElementById('welcome-screen'),
                          settingsPanel: document.getElementById('settings-panel'),
                          btnSettings: document.getElementById('btn-settings'),
                          btnUpdate: document.getElementById('btn-update'),
                          toggleBlocking: document.getElementById('toggle-blocking'),
                          maxServicesInput: document.getElementById('max-services'),
                          toggleDarkMode: document.getElementById('toggle-dark-mode'),
                          toggleProxy: document.getElementById('toggle-proxy'),
                          proxyUrlInput: document.getElementById('proxy-url'),
                          btnClearSession: document.getElementById('btn-clear-session'),


                          lastUpdate: document.getElementById('last-update'),

                          btnCloseSettings: document.getElementById('btn-close-settings'),
                          statusMessage: document.getElementById('status-message'),
                          blockingIndicator: document.getElementById('blocking-indicator'),
                          blockingText: document.getElementById('blocking-text'),
                          allServicesList: document.getElementById('all-services-list'),
                          settingsTabs: document.querySelectorAll('.settings-tab'),
                          settingsTabContents: document.querySelectorAll('.settings-tab-content')
  };

  // --- State ---
  let config = {
    enabledServices: [],
    blockingEnabled: true,
    maxActiveServices: 3,
    darkMode: true
  };
  let allServices = []; // All available services
  let activeTabs = [];
  window.currentTabId = null;

  // --- Utility Functions ---




  window.elements = elements;
  window.config = config;
  window.allServices = allServices;
  window.activeTabs = activeTabs;

  // --- Core Logic ---

  const loadConfig = async () => {
    try {
      window.config = config = await window.electronAPI.getConfig();

      elements.toggleBlocking.checked = config.blockingEnabled;
      elements.maxServicesInput.value = config.maxActiveServices;
      elements.toggleDarkMode.checked = config.darkMode;
      elements.lastUpdate.textContent = window.formatDate(config.lastUpdate);

      window.updateBlockingUI(config.blockingEnabled);
      window.applyDarkMode(config.darkMode);
      window.elements.toggleProxy.checked = window.config.useProxy || false;
      window.elements.proxyUrlInput.value = window.config.proxyUrl || 'https://eu.proxysite.com/includes/process.php?action=update';


      // Render enabled services in sidebar
      window.renderEnabledServices();

      // Render all services in settings
      window.renderAllServicesInSettings();
    } catch (error) {
      console.error('Error loading config:', error);
      window.showStatus('Error loading configuration', 'error');
    }
  };

  const loadServices = async () => {
    try {
      const data = await window.electronAPI.getServices();
      if (data && data.ai_services) {
        window.allServices = allServices = data.ai_services;
        window.renderEnabledServices();
        window.renderAllServicesInSettings();
      } else {
        elements.servicesList.innerHTML = '<div class="error-message">No services found. Click Update.</div>';
      }
    } catch (error) {
      console.error('Error loading services:', error);
      elements.servicesList.innerHTML = '<div class="error-message">Error loading services.</div>';
    }
  };

  const updateBlockingUI = (enabled) => {
    elements.blockingIndicator.className = enabled ? 'indicator active' : 'indicator inactive';
    elements.blockingText.textContent = enabled ? 'Blocking Active' : 'Blocking Disabled';
  };

  const applyDarkMode = (enabled) => {
    if (enabled) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
  };

  // --- Render Functions (Moved to ui/services.js) ---
  // --- Render Functions ---

  // Render only enabled services in sidebar
  const renderEnabledServices = () => {
    elements.servicesList.innerHTML = '';

    if (!config.enabledServices || config.enabledServices.length === 0) {
      elements.servicesList.innerHTML = '<div class="info-message">No services enabled. Go to Settings to enable services.</div>';
      return;
    }

    // Filter only enabled services
    const enabledSet = new Set(config.enabledServices);
    const enabledServices = allServices.filter(service => {
      const serviceId = generateId(service[0]);
      return enabledSet.has(serviceId);
    });

    if (enabledServices.length === 0) {
      elements.servicesList.innerHTML = '<div class="info-message">No services enabled. Go to Settings to enable services.</div>';
      return;
    }

    enabledServices.forEach(service => {
      const [name, url, type, privacy, color] = service;
      const id = generateId(name);
      const bgColor = color ? `#${color}` : '#4285f4';

      const card = document.createElement('div');
      card.className = 'service-card';

      const isActive = activeTabs.find(t => t.id === id);
      const activeIndicator = isActive ? '🟢 ' : '';

      const header = document.createElement('div');
      header.className = 'service-header';
      header.style.backgroundColor = bgColor;

      const nameEl = document.createElement('h3');
      nameEl.className = 'service-name';
      nameEl.textContent = `${activeIndicator}${name}`;

      header.appendChild(nameEl);

      const body = document.createElement('div');
      body.className = 'service-body';

      const typeEl = document.createElement('p');
      typeEl.className = 'service-type';
      typeEl.textContent = type || 'AI Service';

      const descEl = document.createElement('p');
      descEl.className = 'service-description';
      descEl.textContent = privacy || '';

      body.appendChild(typeEl);
      body.appendChild(descEl);

      card.appendChild(header);
      card.appendChild(body);

      card.addEventListener('click', () => {
        window.createTab(id, url, name);
        elements.sidebar.classList.add('hidden');
        renderEnabledServices(); // re-render to update the active indicator
      });

      elements.servicesList.appendChild(card);
    });
  };

  // Render all services in settings with toggle
  const renderAllServicesInSettings = () => {
    elements.allServicesList.innerHTML = '';

    if (allServices.length === 0) {
      elements.allServicesList.innerHTML = '<div class="info-message">No services loaded. Click Update button.</div>';
      return;
    }

    const enabledSet = new Set(config.enabledServices);
    allServices.forEach(service => {
      const [name, url, type, privacy, color] = service;
      const id = generateId(name);
      const bgColor = color ? `#${color}` : '#4285f4';
      const isEnabled = enabledSet.has(id);

      const item = document.createElement('div');
      item.className = 'service-item';
      item.dataset.id = id;

      const colorIndicator = document.createElement('div');
      colorIndicator.className = 'service-item-color';
      colorIndicator.style.backgroundColor = bgColor;

      const info = document.createElement('div');
      info.className = 'service-item-info';

      const nameEl = document.createElement('h4');
      nameEl.className = 'service-item-name';
      nameEl.textContent = name;

      const typeEl = document.createElement('p');
      typeEl.className = 'service-item-type';
      typeEl.textContent = type || 'AI Service';

      info.appendChild(nameEl);
      info.appendChild(typeEl);

      const toggleContainer = document.createElement('div');
      toggleContainer.className = 'service-item-toggle';

      const label = document.createElement('label');
      label.className = 'toggle-switch';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = isEnabled;
      input.dataset.serviceId = id;

      const slider = document.createElement('span');
      slider.className = 'toggle-slider';

      label.appendChild(input);
      label.appendChild(slider);
      toggleContainer.appendChild(label);

      item.appendChild(colorIndicator);
      item.appendChild(info);
      item.appendChild(toggleContainer);

      // Add toggle event
      const toggle = item.querySelector('input[type="checkbox"]');
      toggle.addEventListener('change', async (e) => {
        const serviceId = e.target.dataset.serviceId;
        try {
          const result = await window.electronAPI.toggleService(serviceId);
          config.enabledServices = result;
          renderEnabledServices();
          showStatus(`Service ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
          console.error('Error toggling service:', error);
          showStatus('Error updating service', 'error');
          // Revert toggle
          e.target.checked = !e.target.checked;
        }
      });

      elements.allServicesList.appendChild(item);
    });
  };

  // --- Tab Management ---

  const updateViewBounds = () => {
      const containerBounds = elements.webviewsContainer.getBoundingClientRect();
      window.electronAPI.setViewBounds({
          x: Math.round(containerBounds.x),
          y: Math.round(containerBounds.y),
          width: Math.round(containerBounds.width),
          height: Math.round(containerBounds.height)
      });
  };

  // Keep views in sync when window resizes
  window.addEventListener('resize', updateViewBounds);

// --- Tab Management (Moved to ui/tabs.js) ---

// --- Settings Management (Moved to ui/settings.js) ---

// --- Event Listeners ---

  // Open sidebar
  elements.addTabBtn.addEventListener('click', () => {
    elements.sidebar.classList.remove('hidden');
  });

  // Close sidebar
  elements.closeSidebarBtn.addEventListener('click', () => {
    elements.sidebar.classList.add('hidden');
  });

  // Open settings
  elements.btnSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.remove('hidden');
    window.renderAllServicesInSettings();
  });

  // Close settings
  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });

  // Auto-save settings

  elements.toggleBlocking.addEventListener('change', window.debouncedSaveSettings);
  elements.maxServicesInput.addEventListener('input', window.debouncedSaveSettings);
  elements.toggleDarkMode.addEventListener('change', window.debouncedSaveSettings);
  elements.toggleProxy.addEventListener('change', window.debouncedSaveSettings);
  elements.proxyUrlInput.addEventListener('input', window.debouncedSaveSettings);



    if (elements.btnClearSession) {
      elements.btnClearSession.addEventListener('click', async () => {
          if (confirm('Are you sure you want to clear all session data? This will log you out of all AI services.')) {
              try {
                  const success = await window.electronAPI.clearSessionData();
                  if (success) {
                      window.showStatus('Session data cleared successfully', 'success');
                      // Reload current tab to reflect cleared state
                      if (window.currentTabId) {
                          window.electronAPI.navReload(window.currentTabId);
                      }
                  } else {
                      window.showStatus('Failed to clear session data', 'error');
                  }
              } catch (err) {
                  console.error(err);
                  window.showStatus('Error clearing session data', 'error');
              }
          }
      });
  }
  // Update services
  elements.btnUpdate.addEventListener('click', async () => {
    elements.btnUpdate.disabled = true;
    const icon = elements.btnUpdate.querySelector('span');
    if (icon) icon.classList.add('spin');
    window.showStatus('Updating services...', 'loading');

    try {
      const result = await window.electronAPI.updateRemoteData();
      if (result.success) {
        await loadServices();
        elements.lastUpdate.textContent = window.formatDate(config.lastUpdate);
        window.showStatus('Update successful', 'success');
      } else {
        window.showStatus('Update failed: ' + result.error, 'error');
      }
    } catch (error) {
      window.showStatus('Update failed', 'error');
    } finally {
      elements.btnUpdate.disabled = false;
      if (icon) icon.classList.remove('spin');
    }
  });

  // Settings tabs
  elements.settingsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update tab buttons
      elements.settingsTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update tab content
      const tabName = tab.dataset.tab;
      elements.settingsTabContents.forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
      });
    });
  });

    // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Tab switching
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      window.switchToNextTab(e.shiftKey ? -1 : 1);
      return;
    }

    // Close current tab
    if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (window.currentTabId) window.closeTab(window.currentTabId);
      return;
    }

    // Open sidebar
    if (e.ctrlKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      elements.sidebar.classList.remove('hidden');
      return;
    }

    // Close sidebar with Escape
    if (e.key === 'Escape') {
      elements.sidebar.classList.add('hidden');
      elements.settingsPanel.classList.add('hidden');
    }
  });


  elements.btnNavBack.addEventListener('click', () => {
    if (window.currentTabId) try { window.electronAPI.navGoBack(window.currentTabId); } catch(e){}
  });
  elements.btnNavForward.addEventListener('click', () => {
    if (window.currentTabId) try { window.electronAPI.navGoForward(window.currentTabId); } catch(e){}
  });
  elements.btnNavReload.addEventListener('click', () => {
    if (window.currentTabId) try { window.electronAPI.navReload(window.currentTabId); } catch(e){}
  });

  // --- Initialization ---
  const init = async () => {
    await loadConfig();
    await loadServices();

    // Show welcome message if no enabled services
    if (!config.enabledServices || config.enabledServices.length === 0) {
      const heading = elements.welcomeScreen.querySelector('h2');
      if (heading) heading.textContent = 'Welcome to AI Hub Desktop (No services enabled)';
    } else {
      // Restore Session Tabs
      if (config.openTabs && config.openTabs.length > 0) {
        let validTabs = [];
        for (const savedTab of config.openTabs) {
          // Find matching service metadata to get the title
          const serviceId = savedTab.serviceId || savedTab.id; // Fallback for old configs
          const serviceMeta = allServices.find(s => window.generateId(s[0]) === serviceId);
          if (serviceMeta) {
              const title = serviceMeta[0];
              await window.createTab(serviceId, savedTab.url, title, savedTab.id);
              validTabs.push(savedTab);
          } else {
              console.warn(`Skipping invalid saved tab: ${savedTab.id}`);
              window.showStatus(`Skipped deprecated service: ${savedTab.id}`, 'warning');
          }
        }

        // Restore active tab
        if (config.activeTabId && validTabs.find(t => t.id === config.activeTabId)) {
          window.switchToTab(config.activeTabId);
        } else if (validTabs.length > 0) {
          // Switch to the first valid tab if the last active was closed
          window.switchToTab(validTabs[0].id);
        }
      }
    }
  };

    // Deep link handling
  if (window.electronAPI.onDeepLinkOpen) {
      window.electronAPI.onDeepLinkOpen((serviceId) => {
          const service = allServices.find(s => window.generateId(s[0]) === serviceId);
          if (service) {
              const [name, url] = service;
              window.createTab(serviceId, url, name);
          } else {
              window.showStatus(`Service ${serviceId} not found`, 'warning');
          }
      });
  }

  init();
});
