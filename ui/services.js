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
    body.appendChild(typeEl);

    const descEl = document.createElement('p');
    descEl.className = 'service-description';
    descEl.textContent = privacy || '';
    body.appendChild(descEl);

    card.appendChild(header);
    card.appendChild(body);

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
          const [name, url, , , color] = service;
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
    const [name, , type, , color] = service;
    const id = window.generateId(name);
    const bgColor = color ? `#${color}` : '#4285f4';
    const isEnabled = window.config.enabledServices.includes(id);

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
    const toggle = input;
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
