/**
 * Tab strip: DOM rendering, drag & drop, context menu and the IPC listeners
 * that keep it in sync with the main process.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const SPINNER_SVG =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>' +
    '<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>' +
    '<line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>' +
    '<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>';

  const CLOSE_SVG =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  // -- Favicon loading -------------------------------------------------------

  const faviconCache = new Map(); // serviceId -> dataUrl|null

  async function loadFavicon(serviceId, url) {
    if (faviconCache.has(serviceId)) return faviconCache.get(serviceId);
    faviconCache.set(serviceId, null);

    try {
      const result = await window.electronAPI.getFavicon(url);
      const dataUrl = (result && result.dataUrl) || null;
      faviconCache.set(serviceId, dataUrl);
      applyFavicon(serviceId, dataUrl);
      return dataUrl;
    } catch (error) {
      return null;
    }
  }

  function applyFavicon(serviceId, dataUrl) {
    document.querySelectorAll(`.tab-item[data-service="${serviceId}"] .tab-favicon img`).forEach((img) => {
      if (dataUrl) {
        img.src = dataUrl;
        img.classList.remove('hidden');
        const fallback = img.parentElement.querySelector('.tab-initials');
        if (fallback) fallback.classList.add('hidden');
      }
    });
  }

  app.getFavicon = function getFavicon(serviceId) {
    return faviconCache.get(serviceId) || null;
  };

  // -- Rendering -------------------------------------------------------------

  function tabNode(id) {
    // CSS.escape guards the attribute selector; ids are already constrained to
    // [A-Za-z0-9_-] by the main process, so the fallback is always safe.
    const selector =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(id)
        : id.replace(/[^A-Za-z0-9_-]/g, '');
    return document.querySelector(`.tab-item[data-id="${selector}"]`);
  }

  function buildTabElement(tab) {
    const el = document.createElement('div');
    el.className = 'tab-item';
    el.dataset.id = tab.id;
    el.dataset.service = tab.serviceId;
    el.setAttribute('draggable', 'true');
    el.setAttribute('role', 'tab');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-selected', 'false');
    el.title = `${tab.title} — ${tab.url}`;

    const faviconWrap = document.createElement('span');
    faviconWrap.className = 'tab-favicon';

    const img = document.createElement('img');
    img.alt = '';
    img.classList.add('hidden');

    const initialsEl = document.createElement('span');
    initialsEl.className = 'tab-initials';
    initialsEl.textContent = window.AiHubUtils.initials(tab.title);

    const service = app.serviceById(tab.serviceId);
    if (service && service.color) {
      initialsEl.style.backgroundColor = `#${service.color}`;
    }

    faviconWrap.append(img, initialsEl);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title;

    const loading = document.createElement('span');
    loading.className = 'tab-loading spin hidden';
    loading.innerHTML = SPINNER_SVG;

    const hibernatedBadge = document.createElement('span');
    hibernatedBadge.className = 'tab-badge hidden';
    hibernatedBadge.textContent = 'z';
    hibernatedBadge.title = 'Hibernated — switch to this tab to wake it up';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-close-tab';
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.setAttribute('aria-label', `Close ${tab.title}`);
    closeBtn.setAttribute('tabindex', '-1');

    el.append(faviconWrap, title, loading, hibernatedBadge, closeBtn);

    // -- Interactions --------------------------------------------------------
    el.addEventListener('click', (event) => {
      if (event.target.closest('.btn-close-tab')) return;
      app.switchToTab(tab.id);
    });

    el.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        app.closeTab(tab.id);
      }
    });

    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        app.switchToTab(tab.id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        app.closeTab(tab.id);
      }
    });

    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      app.closeTab(tab.id);
    });

    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openTabContextMenu(event.clientX, event.clientY, tab.id);
    });

    el.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', tab.id);
      event.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    el.addEventListener('dragover', (event) => {
      event.preventDefault();
      const dragging = document.querySelector('.tab-item.dragging');
      if (!dragging || dragging === el) return;
      const list = app.elements.tabsList;
      const children = Array.from(list.children);
      if (children.indexOf(dragging) < children.indexOf(el)) el.after(dragging);
      else el.before(dragging);
    });

    el.addEventListener('drop', (event) => {
      event.preventDefault();
      app.commitTabOrder();
    });

    return el;
  }

  function openTabContextMenu(x, y, id) {
    const tab = app.getTab(id);
    if (!tab) return;

    app.contextMenu(x, y, [
      { type: 'header', label: tab.title },
      {
        label: 'Reload',
        onClick: () => window.electronAPI.navReload(id)
      },
      {
        label: tab.hibernated ? 'Wake up' : 'Free memory (hibernate)',
        onClick: async () => {
          if (tab.hibernated) {
            app.switchToTab(id);
            return;
          }
          const result = await window.electronAPI.hibernateTabs();
          app.toast(`Hibernated ${((result && result.hibernated) || []).length} idle tab(s)`, 'success');
        }
      },
      {
        label: 'Copy URL',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(tab.url);
            window.AiHubUtils.showStatus('URL copied to clipboard', 'success');
          } catch (e) {
            window.AiHubUtils.showStatus('Unable to copy URL', 'error');
          }
        }
      },
      {
        label: 'Open in browser',
        onClick: () => window.electronAPI.openExternal(tab.url)
      },
      { type: 'separator' },
      {
        label: 'Zoom in',
        onClick: () => window.electronAPI.setZoom(id, (tab.zoomFactor || 1) + 0.1)
      },
      {
        label: 'Zoom out',
        onClick: () => window.electronAPI.setZoom(id, (tab.zoomFactor || 1) - 0.1)
      },
      {
        label: 'Reset zoom',
        onClick: () => window.electronAPI.setZoom(id, 1)
      },
      { type: 'separator' },
      {
        label: 'Close other tabs',
        disabled: app.state.tabs.length < 2,
        onClick: () => window.electronAPI.closeOtherTabs(id)
      },
      { label: 'Close tab', danger: true, onClick: () => app.closeTab(id) }
    ]);
  }

  function renderTabs() {
    const list = app.elements.tabsList;
    if (!list) return;
    list.innerHTML = '';

    for (const tab of app.state.tabs) {
      const el = buildTabElement(tab);
      list.appendChild(el);
      const favicon = faviconCache.get(tab.serviceId);
      if (favicon) applyFavicon(tab.serviceId, favicon);
      loadFavicon(tab.serviceId, tab.url);
    }

    paintActiveTab();
    app.updateTabCount();
  }

  function paintActiveTab() {
    document.querySelectorAll('.tab-item').forEach((el) => {
      const isActive = el.dataset.id === app.state.currentTabId;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const active = app.getActiveTab();
    if (app.elements.btnNavBack) app.elements.btnNavBack.disabled = !active || !active.canGoBack;
    if (app.elements.btnNavForward) app.elements.btnNavForward.disabled = !active || !active.canGoForward;

    if (app.positionTabIndicator) app.positionTabIndicator();
  }

  /** Apply a `tab-state` payload from the main process. */
  function applyTabState(payload) {
    if (!payload || !payload.tabId) return;
    const tab = app.getTab(payload.tabId);
    if (!tab && !payload.title) return;

    app.upsertTab(payload);
    const el = tabNode(payload.tabId);
    if (!el) return;

    if (payload.title) {
      const titleEl = el.querySelector('.tab-title');
      if (titleEl) titleEl.textContent = payload.title;
      el.title = `${payload.title} — ${payload.url || ''}`;
    }

    const loadingEl = el.querySelector('.tab-loading');
    if (loadingEl) loadingEl.classList.toggle('hidden', !payload.loading);

    const badge = el.querySelector('.tab-badge');
    if (badge) badge.classList.toggle('hidden', !payload.hibernated);

    if (payload.active) {
      app.state.currentTabId = payload.tabId;
      paintActiveTab();
    }

    if (payload.crashed) {
      app.toast('This tab crashed. Reload it to continue.', 'error');
    }
  }

  // -- Public actions --------------------------------------------------------

  app.createTab = async function createTab({ serviceId, url, title, tabId = null }) {
    const id = tabId || `${serviceId}-${Date.now()}`;

    if (app.state.tabs.length >= app.state.limit) {
      app.toast(`Tab limit reached (${app.state.limit}). Close a tab first.`, 'warning');
      return null;
    }
    if (app.state.tabs.some((tab) => tab.id === id)) {
      app.switchToTab(id);
      return app.getTab(id);
    }

    const service = app.serviceById(serviceId);
    const record = {
      id,
      serviceId,
      url,
      title: title || (service ? service.name : serviceId),
      loading: true,
      canGoBack: false,
      canGoForward: false,
      hibernated: false,
      zoomFactor: 1
    };

    app.upsertTab(record);
    const el = buildTabElement(record);
    app.elements.tabsList.appendChild(el);
    loadFavicon(serviceId, url);

    let result;
    try {
      result = await window.electronAPI.createTab({
        tabId: id,
        serviceId,
        url,
        title: record.title,
        userAgent: ''
      });
    } catch (error) {
      app.removeTab(id);
      el.remove();
      app.toast(`Unable to open ${record.title}`, 'error');
      app.updateTabCount();
      return null;
    }

    if (!result || result.success === false) {
      app.removeTab(id);
      el.remove();
      const reason = result && result.error === 'limit_reached'
        ? `Tab limit reached (${(result && result.limit) || app.state.limit})`
        : `Unable to open ${record.title}${result && result.error ? ` (${result.error})` : ''}`;
      app.toast(reason, 'error');
      app.updateTabCount();
      return null;
    }

    app.switchToTab(id);
    app.hideWelcome();
    app.renderEnabledServices();
    app.updateTabCount();
    try {
      window.electronAPI.setActiveService(serviceId);
    } catch (e) {
      /* non fatal */
    }
    return record;
  };

  app.switchToTab = function switchToTab(id) {
    if (!app.getTab(id)) return;
    app.state.currentTabId = id;
    paintActiveTab();
    try {
      window.electronAPI.switchTab(id);
    } catch (e) {
      /* non fatal */
    }
    const tab = app.getTab(id);
    if (tab) {
      try {
        window.electronAPI.setActiveService(tab.serviceId);
      } catch (e) {
        /* non fatal */
      }
    }
  };

  app.switchToNextTab = function switchToNextTab(direction = 1) {
    if (app.state.tabs.length < 2) return;
    const index = app.state.tabs.findIndex((tab) => tab.id === app.state.currentTabId);
    const base = index === -1 ? 0 : index;
    const next = (base + direction + app.state.tabs.length) % app.state.tabs.length;
    app.switchToTab(app.state.tabs[next].id);
  };

  app.closeTab = async function closeTab(id) {
    const tab = app.getTab(id);
    if (!tab) return;

    app.removeTab(id);
    const el = tabNode(id);
    if (el) el.remove();

    try {
      window.electronAPI.closeTab(id);
    } catch (e) {
      /* non fatal */
    }

    if (app.state.tabs.length > 0) {
      // Stay on the current tab when it was not the one that closed.
      const stillOpen = app.getTab(app.state.currentTabId);
      const fallback = stillOpen || app.state.tabs[Math.max(0, app.state.tabs.length - 1)];
      app.switchToTab(fallback.id);
    } else {
      app.state.currentTabId = null;
      app.showWelcome();
    }

    app.renderEnabledServices();
    app.updateTabCount();
    paintActiveTab();
  };

  app.closeOtherTabs = function closeOtherTabs(id) {
    try {
      window.electronAPI.closeOtherTabs(id);
    } catch (e) {
      /* non fatal */
    }
  };

  /** Persist the tab order after a drag & drop. */
  app.commitTabOrder = function commitTabOrder() {
    const ids = Array.from(app.elements.tabsList.children).map((el) => el.dataset.id);
    app.state.tabs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    try {
      window.electronAPI.reorderTabs(ids);
    } catch (e) {
      /* non fatal */
    }
    if (app.positionTabIndicator) app.positionTabIndicator();
  };

  app.updateTabCount = function updateTabCount() {
    const el = app.elements && app.elements.tabCount;
    if (!el) return;
    el.textContent = `${app.state.tabs.length}/${app.state.limit}`;
    el.classList.toggle('at-limit', app.state.tabs.length >= app.state.limit);
  };

  app.showWelcome = function showWelcome() {
    if (app.elements.welcomeScreen) app.elements.welcomeScreen.classList.remove('hidden');
  };

  app.hideWelcome = function hideWelcome() {
    if (app.elements.welcomeScreen) app.elements.welcomeScreen.classList.add('hidden');
  };

  // -- IPC listeners ---------------------------------------------------------

  app.initTabListeners = function initTabListeners() {
    const api = window.electronAPI;

    if (api.onTabState) api.onTabState(applyTabState);

    if (api.onTabCreated) {
      api.onTabCreated((payload) => {
        if (!payload || app.getTab(payload.tabId)) return;
        app.upsertTab({
          id: payload.tabId,
          serviceId: payload.serviceId,
          url: payload.url,
          title: payload.title || payload.serviceId,
          loading: true
        });
        const el = buildTabElement(app.getTab(payload.tabId));
        app.elements.tabsList.appendChild(el);
        loadFavicon(payload.serviceId, payload.url);
        app.hideWelcome();
        app.updateTabCount();
      });
    }

    if (api.onTabClosed) {
      api.onTabClosed(({ tabId, nextActiveId }) => {
        app.removeTab(tabId);
        const el = tabNode(tabId);
        if (el) el.remove();
        if (nextActiveId && app.getTab(nextActiveId)) app.state.currentTabId = nextActiveId;
        if (app.state.tabs.length === 0) {
          app.state.currentTabId = null;
          app.showWelcome();
        }
        paintActiveTab();
        app.renderEnabledServices();
        app.updateTabCount();
      });
    }

    if (api.onTabsEmptied) {
      api.onTabsEmptied(() => {
        app.state.tabs = [];
        app.state.currentTabId = null;
        renderTabs();
        app.showWelcome();
      });
    }

    if (api.onTabBlocked) {
      api.onTabBlocked(({ hostname }) => {
        app.state.blocking.blocked = (app.state.blocking.blocked || 0) + 1;
        window.AiHubUtils.updateBlockingUI({
          enabled: app.state.blocking.enabled,
          blocked: app.state.blocking.blocked
        });
        app.toast(`Blocked a request to ${hostname}`, 'info');
      });
    }
  };

  app.renderTabs = renderTabs;
  app.applyTabState = applyTabState;
  app.tabNode = tabNode;
})(window.AiHub);
