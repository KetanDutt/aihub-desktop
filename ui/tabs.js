/**
 * Tab strip: DOM rendering, drag & drop, context menu and the IPC listeners
 * that keep it in sync with the main process.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  // -- Favicon loading -------------------------------------------------------

  const faviconCache = new Map(); // serviceId -> dataUrl|null

  async function loadFavicon(serviceId, url) {
    if (faviconCache.has(serviceId)) return faviconCache.get(serviceId);

    // The audited catalogue ships an icon for every known service, so seed the
    // strip with it synchronously before any async lookup happens.
    const preloaded = app.catalogIcon ? app.catalogIcon(serviceId) : null;
    if (preloaded) {
      faviconCache.set(serviceId, preloaded);
      applyFavicon(serviceId, preloaded);
      return preloaded;
    }

    faviconCache.set(serviceId, null);

    try {
      const result = await window.electronAPI.getFavicon(url, serviceId);
      const dataUrl = (result && result.dataUrl) || null;
      faviconCache.set(serviceId, dataUrl);
      applyFavicon(serviceId, dataUrl);
      return dataUrl;
    } catch (error) {
      return null;
    }
  }

  function applyFavicon(serviceId, dataUrl) {
    if (!dataUrl || !serviceId) return;
    // Escape the service id for attribute selectors (ids are slugified, but
    // keep the path safe if a non-slug ever slips through).
    const safe =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(serviceId)
        : String(serviceId).replace(/[^A-Za-z0-9_-]/g, '');
    document.querySelectorAll(`.tab-item[data-service="${safe}"] .tab-favicon img`).forEach((img) => {
      img.src = dataUrl;
      img.classList.remove('hidden');
      const fallback = img.parentElement.querySelector('.tab-initials');
      if (fallback) fallback.classList.add('hidden');
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
    loading.replaceChildren(app.icon('spinner', 12));

    const hibernatedBadge = document.createElement('span');
    hibernatedBadge.className = 'tab-badge hidden';
    hibernatedBadge.textContent = 'z';
    hibernatedBadge.title = 'Hibernated — switch to this tab to wake it up';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-close-tab';
    closeBtn.replaceChildren(app.icon('close', 12));
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
        label: 'Back',
        disabled: !tab.canGoBack,
        onClick: () => window.electronAPI.navGoBack(id)
      },
      {
        label: 'Forward',
        disabled: !tab.canGoForward,
        onClick: () => window.electronAPI.navGoForward(id)
      },
      {
        label: tab.loading ? 'Stop loading' : 'Reload',
        onClick: () => (tab.loading ? window.electronAPI.navStop(id) : window.electronAPI.navReload(id))
      },
      {
        label: 'Reload, ignoring the cache',
        onClick: () => window.electronAPI.navReloadHard(id)
      },
      {
        label: 'Home',
        onClick: () => window.electronAPI.navHome(id)
      },
      { type: 'separator' },
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
        label: tab.muted ? 'Unmute tab' : 'Mute tab',
        onClick: async () => {
          const next = !tab.muted;
          try {
            await window.electronAPI.setMuted(id, next);
            tab.muted = next;
            const node = tabNode(id);
            if (node) node.classList.toggle('is-muted', next);
            app.toast(next ? 'Tab muted' : 'Tab unmuted', 'info');
          } catch (e) {
            app.toast('Unable to change mute state', 'error');
          }
        }
      },
      {
        label: 'Find in page…',
        onClick: () => {
          app.switchToTab(id);
          if (typeof app.openFindBar === 'function') app.openFindBar();
        }
      },
      { type: 'separator' },
      {
        label: 'Reopen closed tab',
        disabled: app.closedTabCount() === 0,
        onClick: () => app.reopenClosedTab()
      },
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

    app.paintNavControls();

    if (app.positionTabIndicator) app.positionTabIndicator();
  }

  /**
   * Sync the browser controls with the active tab: back/forward availability,
   * a Home target, and reload swapping to Stop while a page is loading.
   */
  app.paintNavControls = function paintNavControls() {
    const el = app.elements || {};
    const active = app.getActiveTab();
    const loading = Boolean(active && active.loading);

    if (el.btnNavBack) el.btnNavBack.disabled = !active || !active.canGoBack;
    if (el.btnNavForward) el.btnNavForward.disabled = !active || !active.canGoForward;
    if (el.btnNavHome) el.btnNavHome.disabled = !active;

    // Only one of reload/stop is visible at a time, the way a browser does it.
    if (el.btnNavReload) {
      el.btnNavReload.classList.toggle('hidden', loading);
      el.btnNavReload.disabled = !active;
    }
    if (el.btnNavStop) {
      el.btnNavStop.classList.toggle('hidden', !loading);
      el.btnNavStop.disabled = !loading;
    }
  };

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

    el.classList.toggle('is-muted', Boolean(payload.muted));

    if (payload.active) {
      app.state.currentTabId = payload.tabId;
      paintActiveTab();
    } else if (payload.tabId === app.state.currentTabId) {
      // Loading/navigation state of the tab already in front.
      app.paintNavControls();
    }

    if (payload.crashed) {
      app.toast('This tab crashed. Reload it to continue.', 'error');
    }

    if (payload.requestFind && typeof app.openFindBar === 'function') {
      app.openFindBar();
    }
  }

  // -- Public actions --------------------------------------------------------

  app.createTab = async function createTab({
    serviceId,
    url,
    title,
    tabId = null,
    zoomFactor = 1,
    muted = false
  }) {
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
      zoomFactor: zoomFactor || 1,
      muted: Boolean(muted)
    };

    app.upsertTab(record);
    const el = buildTabElement(record);
    if (record.muted) el.classList.add('is-muted');
    app.elements.tabsList.appendChild(el);
    loadFavicon(serviceId, url);

    let result;
    try {
      result = await window.electronAPI.createTab({
        tabId: id,
        serviceId,
        url,
        title: record.title,
        userAgent: '',
        zoomFactor: record.zoomFactor,
        muted: record.muted
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

  /**
   * Recently closed tabs, newest last — the stack behind Ctrl+Shift+T.
   * Bounded so a long session cannot grow it without limit.
   */
  const closedTabs = [];
  const MAX_CLOSED_TABS = 10;

  app.closeTab = async function closeTab(id) {
    const tab = app.getTab(id);
    if (!tab) return;

    // Remember enough to bring it back exactly as it was.
    closedTabs.push({
      serviceId: tab.serviceId,
      url: tab.url,
      title: tab.title,
      zoomFactor: tab.zoomFactor || 1,
      muted: Boolean(tab.muted)
    });
    while (closedTabs.length > MAX_CLOSED_TABS) closedTabs.shift();

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

  /**
   * Reopen the most recently closed tab (Ctrl+Shift+T), restoring its URL,
   * zoom and mute state. Skips entries whose service has since disappeared
   * from the catalogue.
   */
  app.reopenClosedTab = async function reopenClosedTab() {
    while (closedTabs.length > 0) {
      const record = closedTabs.pop();
      if (!app.serviceById(record.serviceId)) continue;
      const tab = await app.createTab({
        serviceId: record.serviceId,
        url: record.url,
        title: record.title,
        zoomFactor: record.zoomFactor,
        muted: record.muted
      });
      if (tab) {
        app.hideWelcome();
        return tab;
      }
      return null; // creation refused (tab limit): keep the rest of the stack
    }
    app.toast('No recently closed tab to reopen', 'info');
    return null;
  };

  /** How many tabs can currently be reopened (used to enable/disable UI). */
  app.closedTabCount = function closedTabCount() {
    return closedTabs.length;
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
    const open = app.state.tabs.length;
    const limit = app.state.limit;
    el.textContent = `${open}/${limit}`;
    // "3/3" is meaningless read aloud; spell it out for assistive tech.
    el.setAttribute(
      'aria-label',
      `${open} of ${limit} tabs open${open >= limit ? ' — limit reached' : ''}`
    );
    el.classList.toggle('at-limit', open >= limit);
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
      // A single page can trip the filter dozens of times (trackers, pixels,
      // third-party fonts). One toast per hit buried the screen and kept the
      // renderer busy, so hosts are coalesced into one summary toast instead.
      let blockedHosts = new Set();
      let blockedToastTimer = null;

      api.onTabBlocked(({ hostname }) => {
        app.state.blocking.blocked = (app.state.blocking.blocked || 0) + 1;
        window.AiHubUtils.updateBlockingUI({
          enabled: app.state.blocking.enabled,
          blocked: app.state.blocking.blocked
        });

        if (hostname) blockedHosts.add(hostname);
        if (blockedToastTimer) return;

        blockedToastTimer = setTimeout(() => {
          blockedToastTimer = null;
          const hosts = [...blockedHosts];
          blockedHosts = new Set();
          if (hosts.length === 0) return;
          app.toast(
            hosts.length === 1
              ? `Blocked a request to ${hosts[0]}`
              : `Blocked requests to ${hosts.length} domains (${hosts.slice(0, 2).join(', ')}…)`,
            'info'
          );
        }, 1200);
      });
    }
  };

  app.renderTabs = renderTabs;
  app.applyTabState = applyTabState;
  app.tabNode = tabNode;
})(window.AiHub);
