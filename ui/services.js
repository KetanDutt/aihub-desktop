/**
 * Service catalogue rendering: the sidebar, the welcome screen quick start and
 * the Services tab in Settings (filters + sorting live here).
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const LOGIN_LABELS = {
    'logged-in': 'Signed in',
    'logged-out': 'Signed out',
    challenge: 'Verifying',
    unknown: 'Not checked'
  };

  function avatarFor(service, size = 'sm') {
    const wrap = document.createElement('span');
    wrap.className = `service-avatar ${size}`;
    if (service.color) wrap.style.backgroundColor = `#${service.color}`;

    const img = document.createElement('img');
    img.alt = '';
    // Catalogue icon first (already a data URL, no fetch), then the runtime cache.
    const cached = (app.catalogIcon && app.catalogIcon(service.id)) || app.getFavicon(service.id);
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

  /** Small status dot shown on cards and rows. */
  function loginDot(serviceId) {
    const record = app.loginStateOf(serviceId);
    const dot = document.createElement('span');
    dot.className = `login-dot login-${record.state}`;
    const expires =
      record.expiresAt && typeof record.expiresAt === 'number'
        ? ` · expires ${window.AiHubUtils.formatDate(new Date(record.expiresAt).toISOString())}`
        : '';
    dot.title = `${LOGIN_LABELS[record.state] || record.state}${record.reason ? ` (${record.reason})` : ''}${expires}`;
    dot.setAttribute('aria-label', LOGIN_LABELS[record.state] || record.state);
    return dot;
  }

  /**
   * "No sign-in" chip for services the catalogue marks as usable without an
   * account — the quickest way to spot what the local API can drive right now.
   */
  function freeChip(service) {
    if (!service || window.AiHubUtils.requiresLogin(service)) return null;
    const chip = document.createElement('span');
    chip.className = 'free-chip';
    chip.textContent = 'No sign-in';
    chip.title = `${service.name} answers without an account, so the local API can call it straight away.`;
    return chip;
  }

  function openService(service, { url } = {}) {
    // The audited homepage is the post-redirect landing page (e.g. /new, /app),
    // so a tab opens straight on the chat surface instead of bouncing.
    const target = url || service.homepage || service.url;
    app.createTab({ serviceId: service.id, url: target, title: service.name });
    if (app.elements.sidebar) app.elements.sidebar.classList.add('hidden');
    app.renderEnabledServices();
  }

  /** Enable/disable a service and repaint every list that shows it. */
  app.toggleService = async function toggleService(serviceId) {
    const service = app.serviceById(serviceId);
    if (!service) return;
    try {
      const enabled = await window.electronAPI.toggleService(serviceId);
      app.state.config.enabledServices = enabled;
      app.renderEnabledServices();
      app.renderAllServices();
      app.toast(`${service.name} ${enabled.includes(serviceId) ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) {
      app.toast('Unable to update this service', 'error');
    }
  };

  /**
   * Details menu for a catalogue entry: what the audit knows about this
   * service — exact homepage, sign-in requirement, login page, API adapter —
   * plus the actions that follow from it.
   */
  app.serviceDetailsMenu = function serviceDetailsMenu(x, y, serviceId) {
    const service = app.serviceById(serviceId);
    if (!service) return;

    const record = app.loginStateOf(service.id);
    const needsLogin = window.AiHubUtils.requiresLogin(service);
    const homepage = service.homepage || service.url;
    const openIds = app.openServiceIds();

    const items = [
      { type: 'header', label: service.name },
      { type: 'header', label: service.type || 'AI Service' },
      { type: 'header', label: homepage },
      {
        type: 'header',
        label: needsLogin ? `Sign-in required · ${LOGIN_LABELS[record.state] || record.state}` : 'Works without an account'
      }
    ];

    if (service.hasApiAdapter) items.push({ type: 'header', label: 'Local API can drive this service' });

    items.push(
      { type: 'separator' },
      { label: openIds.has(service.id) ? 'Open another tab' : 'Open', onClick: () => openService(service) }
    );

    if (needsLogin && service.loginUrl) {
      items.push({
        label: record.state === 'logged-in' ? 'Open the sign-in page' : 'Sign in…',
        onClick: () => openService(service, { url: service.loginUrl })
      });
    }

    items.push(
      { label: 'Open in browser', onClick: () => window.electronAPI.openExternal(homepage) },
      {
        label: 'Copy homepage URL',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(homepage);
            window.AiHubUtils.showStatus('Homepage URL copied', 'success');
          } catch (e) {
            window.AiHubUtils.showStatus('Unable to copy URL', 'error');
          }
        }
      },
      { type: 'separator' },
      {
        label: (app.state.config.enabledServices || []).includes(service.id) ? 'Disable' : 'Enable',
        onClick: () => app.toggleService(service.id)
      }
    );

    app.contextMenu(x, y, items);
  };

  function emptyState(message, actionLabel, iconName = 'search') {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';

    const icon = document.createElement('span');
    icon.className = 'empty-state-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.appendChild(app.icon(iconName, 18));
    wrap.appendChild(icon);

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

  /**
   * Structural placeholder shown while the catalogue is still loading.
   *
   * The shape deliberately mirrors a real `.service-item` (avatar + two text
   * lines) so the swap to live content causes no layout jump.
   *
   * @param {number} rows
   * @returns {DocumentFragment}
   */
  function skeletonList(rows = 5) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < rows; i += 1) {
      const row = document.createElement('div');
      row.className = 'skeleton-row';
      row.setAttribute('aria-hidden', 'true');

      const avatar = document.createElement('span');
      avatar.className = 'skeleton skeleton-avatar';

      const lines = document.createElement('span');
      lines.className = 'skeleton-lines';
      const title = document.createElement('span');
      title.className = 'skeleton skeleton-line';
      const meta = document.createElement('span');
      meta.className = 'skeleton skeleton-line short';
      lines.append(title, meta);

      row.append(avatar, lines);
      frag.appendChild(row);
    }
    return frag;
  }

  /**
   * Paint loading placeholders into the service lists.
   * Called once before the catalogue resolves; the first real render clears it.
   */
  app.showServiceSkeletons = function showServiceSkeletons() {
    const list = app.elements && app.elements.servicesList;
    if (!list || list.childElementCount > 0) return;
    list.setAttribute('aria-busy', 'true');
    list.appendChild(skeletonList(5));
  };

  // -- Sidebar ---------------------------------------------------------------

  app.renderEnabledServices = function renderEnabledServices() {
    const list = app.elements && app.elements.servicesList;
    if (!list) return;

    const query = app.elements.serviceSearch ? app.elements.serviceSearch.value : '';
    const services = app.filterServices(app.enabledServices(), query);

    // Real content replaces any loading placeholders.
    list.removeAttribute('aria-busy');
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

      header.appendChild(loginDot(service.id));
      const sidebarChip = freeChip(service);
      if (sidebarChip) header.appendChild(sidebarChip);

      if (openIds.has(service.id)) {
        const dot = document.createElement('span');
        dot.className = 'service-open-dot';
        dot.title = 'Already open';
        header.appendChild(dot);
      }

      const add = document.createElement('span');
      add.className = 'service-card-add';
      add.replaceChildren(app.icon('plus', 14));
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
      card.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        app.serviceDetailsMenu(event.clientX, event.clientY, service.id);
      });
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
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        app.serviceDetailsMenu(event.clientX, event.clientY, service.id);
      });
      grid.appendChild(item);
    }
  };

  // -- Filters ---------------------------------------------------------------

  /** Filter values as currently chosen in the Services tab. */
  app.currentServiceFilters = function currentServiceFilters() {
    const el = app.elements;
    return window.AiHubUtils.normalizeServiceFilters({
      query: el.allServicesSearch ? el.allServicesSearch.value : '',
      type: el.filterType ? el.filterType.value : 'all',
      status: el.filterStatus ? el.filterStatus.value : 'all',
      login: el.filterLogin ? el.filterLogin.value : 'all',
      access: el.filterAccess ? el.filterAccess.value : 'all',
      sort: el.sortServices ? el.sortServices.value : 'name',
      direction: app.state.serviceFilters.direction || 'asc'
    });
  };

  /** Push the filter bar's DOM state into `app.state.serviceFilters`. */
  function syncFilterInputsFromState() {
    const el = app.elements;
    const filters = app.state.serviceFilters;
    if (el.allServicesSearch && el.allServicesSearch.value !== filters.query) el.allServicesSearch.value = filters.query;
    if (el.filterType) el.filterType.value = filters.type || 'all';
    if (el.filterStatus) el.filterStatus.value = filters.status || 'all';
    if (el.filterLogin) el.filterLogin.value = filters.login || 'all';
    if (el.filterAccess) el.filterAccess.value = filters.access || 'all';
    if (el.sortServices) el.sortServices.value = filters.sort || 'name';
    if (el.sortDirection) {
      const descending = filters.direction === 'desc';
      el.sortDirection.classList.toggle('is-desc', descending);
      el.sortDirection.title = `Sort direction: ${descending ? 'descending' : 'ascending'}`;
    }
  }

  /** Type options with facet counts, e.g. `Conversational AI (7)`. */
  function populateTypeFilter(counts) {
    const select = app.elements.filterType;
    if (!select) return;

    const options = window.AiHubUtils.serviceTypes(app.state.services);
    const wanted = select.value || 'all';

    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = `All types (${counts.total})`;
    select.appendChild(all);

    for (const entry of options) {
      const option = document.createElement('option');
      option.value = entry.type;
      option.textContent = `${entry.type} (${entry.count})`;
      select.appendChild(option);
    }

    // Keep the current choice when it still exists, else fall back to "all".
    select.value = [...select.options].some((option) => option.value === wanted) ? wanted : 'all';
  }

  /** Grey out filter values that cannot match anything right now. */
  function refreshFilterAffordances(counts) {
    const el = app.elements;
    if (el.filterStatus) {
      el.filterStatus.options[1].disabled = counts.enabled === 0;
      el.filterStatus.options[2].disabled = counts.disabled === 0;
      el.filterStatus.options[3].disabled = counts.open === 0;
    }
    if (el.filterLogin) {
      el.filterLogin.options[1].disabled = counts.loggedIn === 0;
      el.filterLogin.options[2].disabled = counts.loggedOut === 0;
      el.filterLogin.options[4].disabled = counts.unknown === 0;
    }
    if (el.filterAccess) {
      el.filterAccess.options[1].disabled = counts.free === 0;
      el.filterAccess.options[2].disabled = counts.signin === 0;
    }
    if (el.filterReset) {
      const searching = Boolean(el.allServicesSearch && el.allServicesSearch.value.trim());
      el.filterReset.disabled =
        !searching &&
        (!el.filterType || el.filterType.value === 'all') &&
        (!el.filterStatus || el.filterStatus.value === 'all') &&
        (!el.filterLogin || el.filterLogin.value === 'all') &&
        (!el.filterAccess || el.filterAccess.value === 'all');
    }
  }

  app.initServiceFilters = function initServiceFilters() {
    const el = app.elements;
    if (!el.filterType && !el.filterStatus && !el.sortServices) return;

    const persisted = app.loadServiceFilters();
    app.state.serviceFilters = { ...app.state.serviceFilters, ...persisted };
    app.state.filtersLoaded = true;
    syncFilterInputsFromState();

    const apply = () => {
      app.state.serviceFilters = app.currentServiceFilters();
      app.saveServiceFilters(app.state.serviceFilters);
      app.renderAllServices();
    };

    const debounced = window.AiHubUtils.debounce(apply, 120);

    if (el.allServicesSearch) el.allServicesSearch.addEventListener('input', debounced);
    for (const node of [el.filterType, el.filterStatus, el.filterLogin, el.filterAccess, el.sortServices]) {
      if (node) node.addEventListener('change', apply);
    }
    if (el.sortDirection) {
      el.sortDirection.addEventListener('click', () => {
        const current = app.state.serviceFilters.direction === 'desc' ? 'asc' : 'desc';
        app.state.serviceFilters.direction = current;
        app.saveServiceFilters(app.state.serviceFilters);
        syncFilterInputsFromState();
        app.renderAllServices();
      });
    }
    if (el.filterReset) {
      el.filterReset.addEventListener('click', () => {
        app.state.serviceFilters = {
          query: '',
          type: 'all',
          status: 'all',
          login: 'all',
          access: 'all',
          sort: 'name',
          direction: 'asc'
        };
        if (el.allServicesSearch) el.allServicesSearch.value = '';
        app.saveServiceFilters(app.state.serviceFilters);
        syncFilterInputsFromState();
        app.renderAllServices();
        if (el.allServicesSearch) el.allServicesSearch.focus();
      });
    }
  };

  // -- Settings: manage services --------------------------------------------

  app.renderAllServices = function renderAllServices() {
    const list = app.elements && app.elements.allServicesList;
    if (!list) return;

    if (!app.state.filtersLoaded && app.initServiceFilters) {
      // The filter bar may not have been wired yet (catalogue loads first).
      syncFilterInputsFromState();
    }

    const filters = app.currentServiceFilters();
    const enabledIds = new Set(app.state.config.enabledServices || []);
    const cookieCounts = {};
    for (const [id, stats] of Object.entries(app.state.sessionStats || {})) {
      if (stats && typeof stats.cookies === 'number') cookieCounts[id] = stats.cookies;
    }

    const result = window.AiHubUtils.applyServiceFilters(
      app.state.services,
      filters,
      {
        enabledIds,
        openIds: app.openServiceIds(),
        loginStates: app.state.logins,
        usage: (app.state.config.serviceUsage) || {},
        cookieCounts
      }
    );

    populateTypeFilter(result.counts);
    refreshFilterAffordances(result.counts);

    const summary = app.elements.servicesFilterSummary;
    if (summary) {
      summary.textContent =
        result.counts.total === 0
          ? 'No services loaded yet.'
          : window.AiHubUtils.describeFilters(result.counts, filters);
    }

    list.innerHTML = '';

    if (app.state.services.length === 0) {
      list.appendChild(emptyState('The catalogue is empty. Use the update button to download it.'));
      return;
    }

    if (result.services.length === 0) {
      const wrap = emptyState(
        `No service matches the current filters (${result.counts.total} in the catalogue).`,
        null
      );
      list.appendChild(wrap);
      return;
    }

    // "Free first" also means *visibly* separated: the two groups get their own
    // headings instead of one mixed list.
    const grouped =
      filters.sort === 'access' ? window.AiHubUtils.groupServicesByAccess(result.services) : null;

    if (grouped && !grouped.single) {
      for (const group of grouped.groups) {
        list.appendChild(serviceGroupHeader(group));
        for (const service of group.services) {
          list.appendChild(serviceRow(service, enabledIds, cookieCounts[service.id] || 0));
        }
      }
    } else {
      for (const service of result.services) {
        list.appendChild(serviceRow(service, enabledIds, cookieCounts[service.id] || 0));
      }
    }
  };

  /** Section heading for one access group (`No sign-in needed` / `Sign-in required`). */
  function serviceGroupHeader(group) {
    const header = document.createElement('div');
    header.className = `service-group-header is-${group.id}`;

    const title = document.createElement('span');
    title.className = 'service-group-title';
    title.textContent = group.label;

    const count = document.createElement('span');
    count.className = 'service-group-count';
    count.textContent = String((group.services || []).length);

    header.append(title, count);
    return header;
  }

  /** One row of the Services tab: identity, session state and the toggle. */
  function serviceRow(service, enabledIds, cookieCount) {
    const utils = window.AiHubUtils;
    const record = app.loginStateOf(service.id);

    const row = document.createElement('div');
    row.className = 'service-item';
    row.dataset.id = service.id;
    if (enabledIds.has(service.id)) row.classList.add('is-enabled');
    if (app.openServiceIds().has(service.id)) row.classList.add('is-open');

    row.appendChild(avatarFor(service, 'sm'));

    const info = document.createElement('div');
    info.className = 'service-item-info';

    const name = document.createElement('h4');
    name.className = 'service-item-name';
    name.textContent = service.name;
    name.appendChild(loginDot(service.id));
    const chip = freeChip(service);
    if (chip) name.appendChild(chip);

    const meta = document.createElement('p');
    meta.className = 'service-item-type';
    const needsLogin = window.AiHubUtils.requiresLogin(service);
    const bits = [
      service.type || 'AI Service',
      needsLogin ? LOGIN_LABELS[record.state] || 'Not checked' : 'No sign-in needed'
    ];
    if (cookieCount) bits.push(`${cookieCount} cached cookie${cookieCount === 1 ? '' : 's'}`);
    if (record.expiresAt) bits.push(`token until ${utils.relativeTime(new Date(record.expiresAt).toISOString())}`);
    meta.textContent = bits.join(' · ');

    info.append(name, meta);
    row.appendChild(info);

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      app.serviceDetailsMenu(event.clientX, event.clientY, service.id);
    });

    const actions = document.createElement('div');
    actions.className = 'service-item-actions';

    if (needsLogin && record.state !== 'logged-in') {
      const signIn = document.createElement('button');
      signIn.type = 'button';
      signIn.className = 'btn btn-secondary btn-small';
      signIn.textContent = 'Sign in';
      signIn.addEventListener('click', () => {
        app.createTab({ serviceId: service.id, url: service.url, title: service.name });
        window.electronAPI.reloginService(service.id).catch(() => {});
      });
      actions.appendChild(signIn);
    }

    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabledIds.has(service.id);
    input.setAttribute('aria-label', `Enable ${service.name}`);

    const slider = document.createElement('span');
    slider.className = 'toggle-slider';

    toggle.append(input, slider);
    row.append(actions, toggle);

    input.addEventListener('change', async (event) => {
      const target = event.target;
      try {
        const result = await window.electronAPI.toggleService(service.id);
        app.state.config.enabledServices = result;
        app.renderEnabledServices();
        app.renderAllServices();
        app.toast(`${service.name} ${target.checked ? 'enabled' : 'disabled'}`, 'success');
      } catch (error) {
        target.checked = !target.checked;
        app.toast('Unable to update this service', 'error');
      }
    });

    return row;
  }
})(window.AiHub);
