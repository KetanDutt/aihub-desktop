window.App = window.App || {};

window.renderEnabledServices = () => {
  if (!window.elements || !window.elements.servicesList) return;

  window.elements.servicesList.innerHTML = '';

  if (!window.config.enabledServices || window.config.enabledServices.length === 0) {
    window.elements.servicesList.innerHTML = '<div class="info-message">No services enabled. Go to Settings to enable services.</div>';
    return;
  }

  // Filter only enabled services
  const enabledServices = window.allServices.filter(service => {
    const serviceId = window.generateId(service[0]);
    return window.config.enabledServices.includes(serviceId);
  });

  if (enabledServices.length === 0) {
    window.elements.servicesList.innerHTML = '<div class="info-message">No services enabled. Go to Settings to enable services.</div>';
    return;
  }

  const activeTabIds = new Set(window.activeTabs.map(t => t.id));

  enabledServices.forEach(service => {
    const [name, url, type, privacy, color] = service;
    const id = window.generateId(name);
    const bgColor = color ? `#${color}` : '#4285f4';

    const card = document.createElement('div');
    card.className = 'service-card';

    const isActive = activeTabIds.has(id);
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
      window.createTab(id, url, name);
      window.elements.sidebar.classList.add('hidden');
      window.renderEnabledServices(); // re-render to update the active indicator
    });

    window.elements.servicesList.appendChild(card);
  });

  // Populate quick start grid on welcome screen
  const quickStartGrid = document.getElementById('quick-start-services');
  if (quickStartGrid) {
      quickStartGrid.innerHTML = '';
      enabledServices.forEach(service => {
          const [name, url, type, privacy, color] = service;
          const id = window.generateId(name);
          const item = document.createElement('div');
          item.className = 'quick-start-item';
          item.textContent = name;
          item.style.borderLeft = `4px solid ${color ? '#' + color : '#4285f4'}`;
          item.addEventListener('click', () => {
              window.createTab(id, url, name);
          });
          quickStartGrid.appendChild(item);
      });
  }
};

window.renderAllServicesInSettings = () => {
  if (!window.elements || !window.elements.allServicesList) return;

  window.elements.allServicesList.innerHTML = '';

  if (window.allServices.length === 0) {
    window.elements.allServicesList.innerHTML = '<div class="info-message">No services loaded. Click Update button.</div>';
    return;
  }

  window.allServices.forEach(service => {
    const [name, url, type, privacy, color] = service;
    const id = window.generateId(name);
    const bgColor = color ? `#${color}` : '#4285f4';
    const isEnabled = window.config.enabledServices.includes(id);

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

        // Only re-render if the set actually changed lengths or elements
        const changed = result.length !== window.config.enabledServices.length ||
                        !result.every(val => window.config.enabledServices.includes(val));

        window.config.enabledServices = result;

        if (changed) {
            window.renderEnabledServices();
        }

        window.showStatus(`Service ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
      } catch (error) {
        console.error('Error toggling service:', error);
        window.showStatus('Error updating service', 'error');
        // Revert toggle
        e.target.checked = !e.target.checked;
      }
    });

    window.elements.allServicesList.appendChild(item);
  });
};
