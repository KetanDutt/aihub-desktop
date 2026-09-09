/**
 * Service catalogue rendering: the sidebar, the welcome screen quick start and
 * the Services tab in Settings.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const PLUS_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  function avatarFor(service, size = 'sm') {
    const wrap = document.createElement('span');
    wrap.className = `service-avatar ${size}`;
    if (service.color) wrap.style.backgroundColor = `#${service.color}`;

    const img = document.createElement('img');
    img.alt = '';
    const cached = app.getFavicon(service.id);
    if (cached) img.src = cached;
    else img.classList.add('hidden');

    const initials = document.createElement('span');
    initials.className = 'service-avatar-initials';
    initials.textContent = window.AiHubUtils.initials(service.name);
    if (cached) initials.classList.add('hidden');

    img.addEventListener('load', () => {
      img.classList.remove('hidden');
      initials.classList.add('hidden');
    });

    wrap.append(img, initials);
    return wrap;
  }

  function openService(service) {
    app.createTab({ serviceId: service.id, url: service.url, title: service.name });
    if (app.elements.sidebar) app.elements.sidebar.classList.add('hidden');
    app.renderEnabledServices();
  }

  function emptyState(message, actionLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const text = document.createElement('p');
    text.textContent = message;
    wrap.appendChild(text);

    if (actionLabel) {
      const button = document.createElement('button');
      button.className = 'btn btn-secondary btn-small';
      button.textContent = actionLabel;
      button.addEventListener('click', () => app.openSettings('services'));
      wrap.appendChild(button);
    }

    return wrap;
  }

  // -- Sidebar ---------------------------------------------------------------

  app.renderEnabledServices = function renderEnabledServices() {
    const list = app.elements && app.elements.servicesList;
    if (!list) return;

    const query = app.elements.serviceSearch ? app.elements.serviceSearch.value : '';
    const services = app.filterServices(app.enabledServices(), query);

    list.innerHTML = '';

    if (app.state.services.length === 0) {
      list.appendChild(emptyState('No services loaded yet. Update the catalogue to get started.', 'Open Settings'));
      app.updateServicesCount(0, 0);
      return;
    }

    if (app.enabledServices().length === 0) {
      list.appendChild(emptyState('No services enabled yet. Turn a few on in Settings.', 'Manage services'));
      app.updateServicesCount(0, 0);
      return;
    }

    if (services.length === 0) {
      list.appendChild(emptyState(`No service matches “${query}”.`));
      app.updateServicesCount(0, app.enabledServices().length);
      return;
    }

    const openIds = app.openServiceIds();

    for (const service of services) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'service-card';
      if (openIds.has(service.id)) card.classList.add('is-open');

      const header = document.createElement('div');
      header.className = 'service-card-header';

      header.appendChild(avatarFor(service, 'md'));

      const heading = document.createElement('span');
      heading.className = 'service-card-title';
      heading.textContent = service.name;
      header.appendChild(heading);

      if (openIds.has(service.id)) {
        const dot = document.createElement('span');
        dot.className = 'service-open-dot';
        dot.title = 'Already open';
        header.appendChild(dot);
      }

      const add = document.createElement('span');
      add.className = 'service-card-add';
      add.innerHTML = PLUS_SVG;
      header.appendChild(add);

      const body = document.createElement('div');
      body.className = 'service-card-body';

      const type = document.createElement('span');
      type.className = 'service-card-type';
      type.textContent = service.type || 'AI Service';
      body.appendChild(type);

      if (service.privacy) {
        const privacy = document.createElement('p');
        privacy.className = 'service-card-privacy';
        privacy.textContent = service.privacy;
        body.appendChild(privacy);
      }

      card.append(header, body);
      card.addEventListener('click', () => openService(service));
      list.appendChild(card);
    }

    app.updateServicesCount(services.length, app.enabledServices().length);
    app.renderQuickStart();
  };

  app.updateServicesCount = function updateServicesCount(shown, total) {
    const el = app.elements && app.elements.servicesCount;
    if (el) el.textContent = `${shown} of ${total} enabled`;
  };

  // -- Welcome screen --------------------------------------------------------

  app.renderQuickStart = function renderQuickStart() {
    const grid = app.elements && app.elements.quickStartServices;
    if (!grid) return;

    grid.innerHTML = '';
    const services = app.enabledServices().slice(0, 8);

    if (services.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'Enable services in Settings to pin them here.';
      grid.appendChild(hint);
      return;
    }

    for (const service of services) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'quick-start-item';
      if (service.color) item.style.setProperty('--accent', `#${service.color}`);

      item.appendChild(avatarFor(service, 'sm'));

      const label = document.createElement('span');
      label.textContent = service.name;
      item.appendChild(label);

      item.addEventListener('click', () => openService(service));
      grid.appendChild(item);
    }
  };

  // -- Settings: manage services --------------------------------------------

  app.renderAllServices = function renderAllServices() {
    const list = app.elements && app.elements.allServicesList;
    if (!list) return;

    const query = app.elements.allServicesSearch ? app.elements.allServicesSearch.value : '';
    const services = app.filterServices(app.state.services, query);
    const enabled = new Set(app.state.config.enabledServices || []);

    list.innerHTML = '';

    if (app.state.services.length === 0) {
      list.appendChild(emptyState('The catalogue is empty. Use the update button to download it.'));
      return;
    }

    if (services.length === 0) {
      list.appendChild(emptyState(`No service matches “${query}”.`));
      return;
    }

    for (const service of services) {
      const row = document.createElement('div');
      row.className = 'service-item';
      row.dataset.id = service.id;

      row.appendChild(avatarFor(service, 'sm'));

      const info = document.createElement('div');
      info.className = 'service-item-info';

      const name = document.createElement('h4');
      name.className = 'service-item-name';
      name.textContent = service.name;

      const type = document.createElement('p');
      type.className = 'service-item-type';
      type.textContent = service.type || 'AI Service';

      info.append(name, type);
      row.appendChild(info);

      const toggle = document.createElement('label');
      toggle.className = 'toggle-switch';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = enabled.has(service.id);
      input.setAttribute('aria-label', `Enable ${service.name}`);

      const slider = document.createElement('span');
      slider.className = 'toggle-slider';

      toggle.append(input, slider);
      row.appendChild(toggle);

      input.addEventListener('change', async (event) => {
        const target = event.target;
        try {
          const result = await window.electronAPI.toggleService(service.id);
          app.state.config.enabledServices = result;
          app.renderEnabledServices();
          app.toast(`${service.name} ${target.checked ? 'enabled' : 'disabled'}`, 'success');
        } catch (error) {
          target.checked = !target.checked;
          app.toast('Unable to update this service', 'error');
        }
      });

      list.appendChild(row);
    }
  };
})(window.AiHub);
