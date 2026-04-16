// renderer.js - Frontend Logic

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const elements = {
    tabsList: document.getElementById('tabs-list'),
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
                          lastUpdate: document.getElementById('last-update'),
                          btnSaveSettings: document.getElementById('btn-save-settings'),
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
  let currentTabId = null;

  // --- Utility Functions ---
  const showStatus = (message, type = 'info') => {
    const statusText = document.getElementById('status-text');
    if (statusText) statusText.textContent = message;

    // elements.statusMessage could be the container now
    const container = document.getElementById('status-message');
    if (container) container.className = `status-message ${type}`;

    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
      if (type === 'loading') {
        loadingIndicator.classList.remove('hidden');
      } else {
        loadingIndicator.classList.add('hidden');
      }
    }

    setTimeout(() => {
      if (statusText) statusText.textContent = 'Ready';
      if (container) container.className = 'status-message';
      if (loadingIndicator) loadingIndicator.classList.add('hidden');
    }, 3000);
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleString('en-US');
  };

  const generateId = (name) => {
    return name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  };

  // --- Core Logic ---

  const loadConfig = async () => {
    try {
      config = await window.electronAPI.getConfig();
      console.log('Config loaded:', config);

      elements.toggleBlocking.checked = config.blockingEnabled;
      elements.maxServicesInput.value = config.maxActiveServices;
      elements.toggleDarkMode.checked = config.darkMode;
      elements.lastUpdate.textContent = formatDate(config.lastUpdate);

      updateBlockingUI(config.blockingEnabled);
      applyDarkMode(config.darkMode);

      // Render enabled services in sidebar
      renderEnabledServices();

      // Render all services in settings
      renderAllServicesInSettings();
    } catch (error) {
      console.error('Error loading config:', error);
      showStatus('Error loading configuration', 'error');
    }
  };

  const loadServices = async () => {
    try {
      const data = await window.electronAPI.getServices();
      if (data && data.ai_services) {
        allServices = data.ai_services;
        renderEnabledServices();
        renderAllServicesInSettings();
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

  // --- Render Functions ---

  // Render only enabled services in sidebar
  const renderEnabledServices = () => {
    elements.servicesList.innerHTML = '';

    if (!config.enabledServices || config.enabledServices.length === 0) {
      elements.servicesList.innerHTML = '<div class="info-message">No services enabled. Go to Settings to enable services.</div>';
      return;
    }

    // Filter only enabled services
    const enabledServices = allServices.filter(service => {
      const serviceId = generateId(service[0]);
      return config.enabledServices.includes(serviceId);
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

      card.innerHTML = `
      <div class="service-header" style="background-color: ${bgColor}">
      <h3 class="service-name">${activeIndicator}${name}</h3>
      </div>
      <div class="service-body">
      <p class="service-type">${type || 'AI Service'}</p>
      <p class="service-description">${privacy || ''}</p>
      </div>
      `;

      card.addEventListener('click', () => {
        createTab(id, url, name);
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

    allServices.forEach(service => {
      const [name, url, type, privacy, color] = service;
      const id = generateId(name);
      const bgColor = color ? `#${color}` : '#4285f4';
      const isEnabled = config.enabledServices.includes(id);

      const item = document.createElement('div');
      item.className = 'service-item';
      item.dataset.id = id;

      item.innerHTML = `
      <div class="service-item-color" style="background-color: ${bgColor}"></div>
      <div class="service-item-info">
      <h4 class="service-item-name">${name}</h4>
      <p class="service-item-type">${type || 'AI Service'}</p>
      </div>
      <div class="service-item-toggle">
      <label class="toggle-switch">
      <input type="checkbox" ${isEnabled ? 'checked' : ''} data-service-id="${id}">
      <span class="toggle-slider"></span>
      </label>
      </div>
      `;

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

  const createTab = async (serviceId, url, title) => {
    if (activeTabs.length >= config.maxActiveServices) {
      showStatus(`Memory limit reached (${config.maxActiveServices} services). Close a tab first.`, 'warning');
      return;
    }

    // Check if tab already exists
    const existingTab = activeTabs.find(t => t.id === serviceId);
    if (existingTab) {
      switchToTab(serviceId);
      return;
    }

    // Create tab element
    const tab = document.createElement('div');
    tab.className = 'tab-item active';
    tab.dataset.id = serviceId;
    tab.innerHTML = `
    <span class="tab-title">${title}</span>
    <button class="btn-close-tab">✕</button>
    `;

    // Add event listeners
    tab.addEventListener('click', (e) => {
      if (!e.target.classList.contains('btn-close-tab')) {
        switchToTab(serviceId);
      }
    });

    tab.querySelector('.btn-close-tab').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(serviceId);
    });

    tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // A minimal context menu simulation
        if (confirm(`Close all OTHER tabs?`)) {
            const tabsToClose = activeTabs.filter(t => t.id !== serviceId).map(t => t.id);
            tabsToClose.forEach(id => closeTab(id));
        }
    });

    // Add to DOM
    elements.tabsList.appendChild(tab);

    // Instead of <webview>, invoke main process WebContentsView
    try {
        const result = await window.electronAPI.createTab(serviceId, url, '');
        if (result && result.success === false) {
             showStatus(`Cannot create tab: ${result.error}`, 'error');
             tab.remove();
             return;
        }

        // Update state
        activeTabs.push({ id: serviceId, url, title });
        switchToTab(serviceId);

        // Ensure bounds are correct after a new tab is initialized
        updateViewBounds();

        // Hide welcome screen
        elements.welcomeScreen.style.display = 'none';

        // Set active service for blocking
        window.electronAPI.setActiveService(serviceId);
    } catch(err) {
        showStatus(`Error creating tab: ${err}`, 'error');
        tab.remove();
    }
  };

  const switchToTab = (id) => {
    // Update tabs UI
    document.querySelectorAll('.tab-item').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.id === id);
    });

    currentTabId = id;

    // Ask main process to show specific WebContentsView
    window.electronAPI.switchTab(id);
    updateViewBounds();

    // Update active service for blocking
    window.electronAPI.setActiveService(id);
  };

  const closeTab = (id) => {
    // Remove from DOM
    const tab = document.querySelector(`.tab-item[data-id="${id}"]`);
    if (tab) tab.remove();

    // Remove from state
    const index = activeTabs.findIndex(t => t.id === id);
    if (index !== -1) {
      activeTabs.splice(index, 1);
    }

    // Ask main process to destroy WebContentsView
    window.electronAPI.closeTab(id);

    // Switch to another tab or show welcome
    if (activeTabs.length > 0) {
      const newIndex = Math.min(index, activeTabs.length - 1);
      switchToTab(activeTabs[newIndex].id);
    } else {
      elements.welcomeScreen.style.display = 'flex';
      currentTabId = null;
    }
  };

  // Keep views in sync when window resizes
  window.addEventListener('resize', updateViewBounds);

  // --- Settings Management ---

  const saveSettings = async () => {
    const newConfig = {
      blockingEnabled: elements.toggleBlocking.checked,
      maxActiveServices: parseInt(elements.maxServicesInput.value) || 3,
                          darkMode: elements.toggleDarkMode.checked
    };

    try {
      config = await window.electronAPI.saveConfig(newConfig);
      showStatus('Settings saved', 'success');
      updateBlockingUI(config.blockingEnabled);
      applyDarkMode(config.darkMode);
    } catch (error) {
      showStatus('Error saving settings', 'error');
    }
  };

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
    renderAllServicesInSettings();
  });

  // Close settings
  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });

  // Save settings
  elements.btnSaveSettings.addEventListener('click', saveSettings);

  // Update services
  elements.btnUpdate.addEventListener('click', async () => {
    showStatus('Updating services...', 'info');

    try {
      const result = await window.electronAPI.updateRemoteData();
      if (result.success) {
        await loadServices();
        elements.lastUpdate.textContent = formatDate(config.lastUpdate);
        showStatus('Update successful', 'success');
      } else {
        showStatus('Update failed: ' + result.error, 'error');
      }
    } catch (error) {
      showStatus('Update failed', 'error');
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
    // Close sidebar with Escape
    if (e.key === 'Escape') {
      elements.sidebar.classList.add('hidden');
      elements.settingsPanel.classList.add('hidden');
    }
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
        for (const savedTab of config.openTabs) {
          // Find matching service metadata to get the title
          const serviceMeta = allServices.find(s => generateId(s[0]) === savedTab.id);
          const title = serviceMeta ? serviceMeta[0] : savedTab.id;
          await createTab(savedTab.id, savedTab.url, title);
        }

        // Restore active tab
        if (config.activeTabId && config.openTabs.find(t => t.id === config.activeTabId)) {
          switchToTab(config.activeTabId);
        } else {
          // Switch to the first tab if the last active was closed
          switchToTab(config.openTabs[0].id);
        }
      }
    }
  };

  init();
});
