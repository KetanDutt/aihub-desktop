/**
 * Settings panel: load, edit, persist, plus the privacy and about tabs.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const utils = window.AiHubUtils;

  app.openSettings = function openSettings(tabName = 'general') {
    const panel = app.elements.settingsPanel;
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    app.selectSettingsTab(tabName);
    app.refreshAbout();
    app.refreshPrivacyInfo();
  };

  app.closeSettings = function closeSettings() {
    const panel = app.elements.settingsPanel;
    if (!panel) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
  };

  app.selectSettingsTab = function selectSettingsTab(name) {
    app.elements.settingsTabs.forEach((button) => {
      const isActive = button.dataset.tab === name;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    app.elements.settingsTabContents.forEach((content) => {
      content.classList.toggle('active', content.id === `tab-${name}`);
    });
    if (app.positionSettingsIndicator) app.positionSettingsIndicator();
  };

  // -- Load / save -----------------------------------------------------------

  app.loadSettingsIntoUI = function loadSettingsIntoUI() {
    const el = app.elements;
    const config = app.state.config;

    const set = (node, value) => {
      if (node) node.value = value;
    };
    const check = (node, value) => {
      if (node) node.checked = Boolean(value);
    };

    check(el.toggleBlocking, config.blockingEnabled);
    check(el.toggleStrictBlocking, config.strictBlocking);
    check(el.toggleDarkMode, config.darkMode);
    check(el.toggleHibernate, config.hibernateTabs);
    check(el.toggleMinimizeTray, config.minimizeToTray);
    check(el.toggleLaunchLogin, config.launchAtLogin);
    check(el.toggleAutoUpdate, config.autoUpdateServices);
    check(el.toggleProxy, config.useProxy);

    set(el.maxServices, config.maxActiveServices);
    set(el.hibernateMinutes, config.hibernateAfterMinutes);
    set(el.globalShortcut, config.globalShortcut);
    set(el.proxyUrl, config.proxyUrl);

    utils.updateBlockingUI({ enabled: config.blockingEnabled, blocked: app.state.blocking.blocked });
    utils.applyDarkMode(config.darkMode);
    if (el.lastUpdate) {
      el.lastUpdate.textContent = config.lastUpdate
        ? `${utils.formatDate(config.lastUpdate)} (${utils.relativeTime(config.lastUpdate)})`
        : 'Never';
    }
  };

  function collectSettings() {
    const el = app.elements;
    return {
      blockingEnabled: el.toggleBlocking ? el.toggleBlocking.checked : true,
      strictBlocking: el.toggleStrictBlocking ? el.toggleStrictBlocking.checked : false,
      maxActiveServices: utils.clamp(el.maxServices ? el.maxServices.value : 3, 1, 20, 3),
      hibernateTabs: el.toggleHibernate ? el.toggleHibernate.checked : true,
      hibernateAfterMinutes: utils.clamp(
        el.hibernateMinutes ? el.hibernateMinutes.value : 15,
        1,
        1440,
        15
      ),
      darkMode: el.toggleDarkMode ? el.toggleDarkMode.checked : true,
      minimizeToTray: el.toggleMinimizeTray ? el.toggleMinimizeTray.checked : true,
      launchAtLogin: el.toggleLaunchLogin ? el.toggleLaunchLogin.checked : false,
      globalShortcut: el.globalShortcut ? el.globalShortcut.value.trim() : '',
      autoUpdateServices: el.toggleAutoUpdate ? el.toggleAutoUpdate.checked : true,
      useProxy: el.toggleProxy ? el.toggleProxy.checked : false,
      proxyUrl: el.proxyUrl ? el.proxyUrl.value.trim() : ''
    };
  }

  app.saveSettings = async function saveSettings() {
    const payload = collectSettings();

    if (payload.useProxy && payload.proxyUrl && !utils.isValidHttpUrl(payload.proxyUrl)) {
      app.toast('Proxy URL must start with http:// or https://', 'error');
      return false;
    }

    try {
      const result = await window.electronAPI.saveConfig(payload);
      if (!result || result.success === false) {
        app.toast((result && result.error) || 'Unable to save settings', 'error');
        app.loadSettingsIntoUI();
        return false;
      }

      app.state.config = result.config;
      app.state.limit = result.config.maxActiveServices;
      app.state.blocking.enabled = result.config.blockingEnabled;

      utils.applyDarkMode(result.config.darkMode);
      utils.updateBlockingUI({
        enabled: result.config.blockingEnabled,
        blocked: app.state.blocking.blocked
      });
      app.updateTabCount();
      app.toast('Settings saved', 'success');
      return true;
    } catch (error) {
      app.toast('Unable to save settings', 'error');
      return false;
    }
  };

  // -- Privacy / data --------------------------------------------------------

  app.refreshPrivacyInfo = async function refreshPrivacyInfo() {
    const el = app.elements;
    if (!el.dataSource) return;

    try {
      const info = await window.electronAPI.getAppInfo();
      app.state.appInfo = info;

      el.dataSource.textContent =
        `Catalogue: ${info.data.servicesSource || 'unavailable'} · ` +
        `Rules: ${info.data.rulesSource || 'unavailable'} · ` +
        `${info.data.serviceCount} services, ${info.data.ruleCount} rule sets`;

      if (el.blockingStats) {
        el.blockingStats.textContent =
          `${info.blocking.blocked} request(s) blocked, ${info.blocking.allowed} allowed` +
          ` across ${info.blocking.tabs} open tab(s)`;
      }
      if (el.lastUpdate && info.data.lastUpdate) {
        el.lastUpdate.textContent =
          `${utils.formatDate(info.data.lastUpdate)} (${utils.relativeTime(info.data.lastUpdate)})`;
      }
    } catch (error) {
      el.dataSource.textContent = 'Unavailable';
    }
  };

  app.refreshAbout = async function refreshAbout() {
    const el = app.elements;
    try {
      const info = await window.electronAPI.getAppInfo();
      app.state.appInfo = info;

      if (el.aboutVersion) {
        el.aboutVersion.textContent = `Version ${info.version}${info.packaged ? '' : ' (development)'}`;
      }

      if (el.aboutDetails) {
        el.aboutDetails.innerHTML = '';
        const rows = [
          ['Electron', info.electron],
          ['Chromium', info.chrome],
          ['Node.js', info.node],
          ['Platform', `${info.platform} (${info.arch})`],
          ['Global shortcut', info.shortcut],
          ['Log file', info.logPath || 'n/a']
        ];
        for (const [label, value] of rows) {
          const row = document.createElement('div');
          row.className = 'about-row';
          const key = document.createElement('span');
          key.className = 'about-key';
          key.textContent = label;
          const val = document.createElement('span');
          val.className = 'about-value';
          val.textContent = value == null ? 'n/a' : String(value);
          row.append(key, val);
          el.aboutDetails.appendChild(row);
        }
      }

      app.renderUpdateStatus(info.update);
    } catch (error) {
      /* the panel simply stays empty */
    }
  };

  app.renderUpdateStatus = function renderUpdateStatus(update) {
    const el = app.elements.updateStatus;
    if (!el) return;
    app.state.update = update;

    if (!update) {
      el.textContent = 'Update status unavailable.';
      return;
    }

    const labels = {
      idle: 'Updates run in packaged builds only.',
      checking: 'Checking for updates…',
      available: `Version ${update.version} found — downloading…`,
      downloading: `Downloading update (${update.progress}%)`,
      downloaded: `Version ${update.version} ready. Restart to install.`,
      'up-to-date': `You are on the latest version (${update.currentVersion}).`,
      error: `Update check failed: ${update.error || 'unknown error'}`
    };

    el.textContent = labels[update.status] || update.status;
  };

  // -- Wiring ----------------------------------------------------------------

  app.initSettings = function initSettings() {
    const el = app.elements;
    const debouncedSave = utils.debounce(() => app.saveSettings(), 450);

    const changeInputs = [
      el.toggleBlocking,
      el.toggleStrictBlocking,
      el.toggleDarkMode,
      el.toggleHibernate,
      el.toggleMinimizeTray,
      el.toggleLaunchLogin,
      el.toggleAutoUpdate,
      el.toggleProxy
    ];
    changeInputs.forEach((input) => input && input.addEventListener('change', debouncedSave));

    [el.maxServices, el.hibernateMinutes, el.globalShortcut, el.proxyUrl].forEach(
      (input) => input && input.addEventListener('input', debouncedSave)
    );

    // Instant feedback for the theme toggle (no need to wait for the save).
    if (el.toggleDarkMode) {
      el.toggleDarkMode.addEventListener('change', (event) => utils.applyDarkMode(event.target.checked));
    }

    app.elements.settingsTabs.forEach((button) => {
      button.addEventListener('click', () => app.selectSettingsTab(button.dataset.tab));
    });

    if (el.btnUpdate) {
      el.btnUpdate.addEventListener('click', async () => {
        el.btnUpdate.disabled = true;
        el.btnUpdate.classList.add('is-loading');
        utils.showStatus('Updating service catalogue…', 'loading');
        try {
          const result = await window.electronAPI.updateRemoteData();
          if (result && result.success) {
            await app.loadServices();
            const config = await window.electronAPI.getConfig();
            app.state.config = config;
            app.loadSettingsIntoUI();
            app.toast(`Updated: ${result.services} services, ${result.rules} rule sets`, 'success');
          } else {
            app.toast(`Update failed: ${(result && result.error) || 'unknown error'}`, 'error');
          }
        } catch (error) {
          app.toast('Update failed', 'error');
        } finally {
          el.btnUpdate.disabled = false;
          el.btnUpdate.classList.remove('is-loading');
          app.refreshPrivacyInfo();
        }
      });
    }

    if (el.btnUpdatePrivacy && el.btnUpdate) {
      el.btnUpdatePrivacy.addEventListener('click', () => el.btnUpdate.click());
    }

    if (el.btnClearSession) {
      el.btnClearSession.addEventListener('click', async () => {
        const ok = await app.confirm({
          title: 'Clear session data?',
          message:
            'This signs you out of every AI service and removes cookies, caches and cached icons. Open tabs stay open.',
          confirmLabel: 'Clear data',
          danger: true
        });
        if (!ok) return;

        try {
          const result = await window.electronAPI.clearSessionData();
          if (result && result.success) {
            app.toast('Session data cleared', 'success');
            if (app.state.currentTabId) window.electronAPI.navReload(app.state.currentTabId);
          } else {
            app.toast('Unable to clear session data', 'error');
          }
        } catch (error) {
          app.toast('Unable to clear session data', 'error');
        }
      });
    }

    if (el.btnHibernate) {
      el.btnHibernate.addEventListener('click', async () => {
        try {
          const result = await window.electronAPI.hibernateTabs();
          const count = ((result && result.hibernated) || []).length;
          app.toast(count > 0 ? `Freed ${count} idle tab(s)` : 'No idle tabs to hibernate', 'info');
          app.refreshPrivacyInfo();
        } catch (error) {
          app.toast('Unable to hibernate tabs', 'error');
        }
      });
    }

    if (el.btnOpenLog) {
      el.btnOpenLog.addEventListener('click', async () => {
        const info = app.state.appInfo || (await window.electronAPI.getAppInfo());
        if (info && info.logPath) {
          navigator.clipboard.writeText(info.logPath).catch(() => {});
          app.toast(`Log path copied: ${info.logPath}`, 'info');
        } else {
          app.toast('Log path unavailable', 'error');
        }
      });
    }

    if (el.btnCheckUpdates) {
      el.btnCheckUpdates.addEventListener('click', async () => {
        el.btnCheckUpdates.disabled = true;
        app.renderUpdateStatus({ status: 'checking', currentVersion: app.state.appInfo && app.state.appInfo.version });
        try {
          const status = await window.electronAPI.checkForUpdates();
          app.renderUpdateStatus(status);
        } finally {
          el.btnCheckUpdates.disabled = false;
        }
      });
    }

    if (el.btnCloseSettings) el.btnCloseSettings.addEventListener('click', () => app.closeSettings());

    if (el.serviceSearch) {
      el.serviceSearch.addEventListener('input', utils.debounce(() => app.renderEnabledServices(), 120));
    }
    if (el.allServicesSearch) {
      el.allServicesSearch.addEventListener('input', utils.debounce(() => app.renderAllServices(), 120));
    }
  };
})(window.AiHub);
