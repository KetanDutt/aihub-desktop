/**
 * Sessions panel: what the login monitor knows, and the actions around it.
 *
 * The main process owns every piece of state here (`login-state` /
 * `session-state` events plus `get-session-stats`); this file only renders it
 * and offers the four things a user actually needs when a login misbehaves:
 * re-check, sign in, force a refresh, clear this one service.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const utils = window.AiHubUtils;

  const STATE_LABELS = {
    'logged-in': 'Signed in',
    'logged-out': 'Signed out',
    challenge: 'Verifying',
    unknown: 'Not checked'
  };

  let renderTimer = null;

  /** Coalesce a burst of `login-state` events into one repaint. */
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      app.renderSessionList();
      app.renderSessionSummary();
      if (app.renderAllServices) app.renderAllServices();
      if (app.renderEnabledServices) app.renderEnabledServices();
    }, 350);
  }

  /** Merge a pushed login update into the local state. */
  app.applyLoginUpdate = function applyLoginUpdate(payload) {
    if (!payload || !payload.serviceId) return;
    app.state.logins[payload.serviceId] = {
      ...(app.state.logins[payload.serviceId] || {}),
      state: payload.state,
      reason: payload.reason,
      expiresAt: payload.expiresAt,
      lastCheckedAt: Date.now()
    };
    scheduleRender();
  };

  app.refreshSessions = async function refreshSessions() {
    try {
      const stats = await window.electronAPI.getSessionStats();
      app.state.sessionStats = (stats && stats.perService) || {};
      app.state.logins = (stats && stats.logins) || {};
      app.state.hardening = (stats && stats.hardening) || null;
      app.state.sessionMeta = {
        isolation: Boolean(stats && stats.isolation),
        persistence: stats && stats.persistence !== false,
        keepAlive: (stats && stats.keepAlive) || { enabled: true, minutes: 45 },
        snapshots: (stats && stats.snapshots) || 0
      };
      app.renderSessionList();
      app.renderSessionSummary();
      app.renderHardeningSummary();
      if (app.renderAllServices) app.renderAllServices();
      return stats;
    } catch (error) {
      const el = app.elements && app.elements.sessionSummary;
      if (el) el.textContent = 'Session information is unavailable in this build.';
      return null;
    }
  };

  app.renderSessionSummary = function renderSessionSummary() {
    const el = app.elements && app.elements.sessionSummary;
    if (!el) return;

    const states = Object.values(app.state.logins || {});
    const signedIn = states.filter((record) => record.state === 'logged-in').length;
    const expiring = states.filter((record) => record.state === 'logged-in' && record.expiresAt && record.expiresAt - Date.now() < 86400000).length;
    const needsAttention = states.filter((record) => record.state === 'logged-out').length;
    const verifying = states.filter((record) => record.state === 'challenge').length;
    const meta = app.state.sessionMeta || {};

    const bits = [`${signedIn} signed in`];
    if (needsAttention) bits.push(`${needsAttention} need a sign-in`);
    if (expiring) bits.push(`${expiring} expiring soon`);
    if (verifying) bits.push(`${verifying} verifying`);
    bits.push(meta.persistence === false ? 'cookie cache off' : `${meta.snapshots || 0} cached snapshot(s)`);
    bits.push(meta.isolation ? 'isolated profiles' : 'shared profile');

    el.textContent = bits.join(' · ');
  };

  app.renderHardeningSummary = function renderHardeningSummary() {
    const el = app.elements && app.elements.hardeningSummary;
    if (!el) return;

    const status = app.state.hardening;
    if (!status) {
      el.textContent = 'Hardening status unavailable.';
      return;
    }
    if (!status.enabled) {
      el.textContent = 'Anti-bot hardening is off: these tabs announce themselves as Electron.';
      return;
    }

    const chrome = status.chromeMajor ? `Chrome ${status.chromeMajor}` : 'Chrome';
    const bits = [
      `Masked as ${chrome}`,
      `lang ${status.languages ? status.languages.join(',') : 'en-US'}`,
      status.timezone ? `tz ${status.timezone}` : 'tz from system',
      status.humanize ? 'human-paced input' : 'instant input',
      status.canvasNoise ? 'canvas noise on' : 'no canvas noise',
      `${status.attachedTabs || 0} tab(s) patched`
    ];
    el.textContent = bits.join(' · ');
  };

  function sessionRow(serviceId, service, stats, record) {
    const row = document.createElement('div');
    row.className = 'session-row';
    row.dataset.id = serviceId;

    const head = document.createElement('div');
    head.className = 'session-row-head';

    const name = document.createElement('span');
    name.className = 'session-name';
    name.textContent = (service && service.name) || serviceId;

    const chip = document.createElement('span');
    const state = (record && record.state) || 'unknown';
    chip.className = `login-chip login-${state}`;
    chip.textContent = STATE_LABELS[state] || state;

    head.append(name, chip);
    row.appendChild(head);

    const facts = document.createElement('div');
    facts.className = 'session-facts';
    const parts = [];
    if (stats) {
      parts.push(`${stats.cookies || 0} cookie${stats.cookies === 1 ? '' : 's'}`);
      if (stats.authCookies) parts.push(`${stats.authCookies} session`);
      if (stats.pinned) parts.push(`${stats.pinned} re-stamped`);
      parts.push(stats.isolated ? `profile ${serviceId}` : 'shared profile');
      if (stats.cacheSize) parts.push(`${Math.round(stats.cacheSize / 1024)} MB cache`);
    }
    if (record && record.expiresAt) parts.push(`token ${utils.relativeTime(new Date(record.expiresAt).toISOString())}`);
    if (record && record.lastCheckedAt) parts.push(`checked ${utils.relativeTime(new Date(record.lastCheckedAt).toISOString())}`);
    else if (record) parts.push(`not checked (${record.reason || 'unknown'})`);
    if (record && record.hasSnapshot) parts.push('snapshot on disk');
    facts.textContent = parts.join(' · ') || 'No cached data yet.';
    row.appendChild(facts);

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    const button = (label, title, handler, kind = 'btn-secondary') => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `btn ${kind} btn-small`;
      el.textContent = label;
      el.title = title;
      el.addEventListener('click', handler);
      return el;
    };

    actions.appendChild(
      button('Re-check', 'Re-run cookie + page detection for this service', async () => {
        const result = await window.electronAPI.touchSession(serviceId).catch(() => null);
        await app.refreshSessions();
        app.toast(
          result && result.ok ? `Refreshed the ${serviceId} session` : `Could not refresh ${serviceId}`,
          result && result.ok ? 'success' : 'warning'
        );
      })
    );

    actions.appendChild(
      button('Sign in', 'Open this service on its sign-in page', async () => {
        await window.electronAPI.reloginService(serviceId).catch(() => null);
        app.toast(`Opened the sign-in page for ${serviceId}`, 'info');
      })
    );

    actions.appendChild(
      button('Clear', 'Delete cookies, storage and the cached snapshot for this service only', async () => {
        const ok = await app.confirm({
          title: `Sign ${serviceId} out?`,
          message: 'Cookies, local storage and the cached session snapshot for this service are removed. Other services keep their logins.',
          confirmLabel: 'Clear this service',
          danger: true
        });
        if (!ok) return;
        const result = await window.electronAPI.clearServiceData(serviceId).catch(() => null);
        await app.refreshSessions();
        app.toast(result && result.success ? `${serviceId} cleared` : 'Unable to clear this service', result && result.success ? 'success' : 'error');
      }, 'btn-danger')
    );

    row.appendChild(actions);
    return row;
  }

  app.renderSessionList = function renderSessionList() {
    const list = app.elements && app.elements.sessionList;
    if (!list) return;

    list.innerHTML = '';

    const enabled = new Set(app.state.config.enabledServices || []);
    const services = app.state.services.filter((service) => enabled.has(service.id));
    const ids = [...new Set([...services.map((service) => service.id), ...Object.keys(app.state.logins || {})])];

    if (ids.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'Enable a service to start tracking its session.';
      list.appendChild(hint);
      return;
    }

    const serviceById = new Map(app.state.services.map((service) => [service.id, service]));
    const rank = { 'logged-out': 0, unknown: 1, 'logged-in': 2, challenge: 3 };

    ids.sort((a, b) => {
      const stateA = (app.state.logins[a] || {}).state || 'unknown';
      const stateB = (app.state.logins[b] || {}).state || 'unknown';
      return ((rank[stateA] ?? 1) - (rank[stateB] ?? 1)) || a.localeCompare(b);
    });

    for (const serviceId of ids) {
      list.appendChild(
        sessionRow(
          serviceId,
          serviceById.get(serviceId) || { name: serviceId },
          (app.state.sessionStats || {})[serviceId],
          app.state.logins[serviceId]
        )
      );
    }
  };

  app.initSessions = function initSessions() {
    const el = app.elements;
    if (!el.sessionList) return;

    if (el.btnRefreshSessions) {
      el.btnRefreshSessions.addEventListener('click', async () => {
        el.btnRefreshSessions.disabled = true;
        utils.showStatus('Re-checking sessions…', 'loading');
        await app.refreshSessions();
        el.btnRefreshSessions.disabled = false;
        utils.showStatus('Sessions re-checked', 'success');
      });
    }

    if (el.btnSignoutAll) {
      el.btnSignoutAll.addEventListener('click', async () => {
        const ok = await app.confirm({
          title: 'Sign out of every service?',
          message:
            'Cookies, local storage and the cached session snapshots are deleted. Re-login on open will then take you back through each provider’s sign-in page.',
          confirmLabel: 'Sign out everywhere',
          danger: true
        });
        if (!ok) return;
        const result = await window.electronAPI.clearSessionData({ scope: 'all' });
        await app.refreshSessions();
        app.toast(result && result.success ? 'Signed out of every service' : 'Unable to clear the sessions', result && result.success ? 'success' : 'error');
      });
    }

    if (window.electronAPI.onLoginState) {
      window.electronAPI.onLoginState((payload) => {
        if (payload && payload.relogin) {
          const names = payload.relogin.join(', ');
          app.toast(`Session expired — sign-in page opened for ${names}`, 'warning');
          return;
        }
        app.applyLoginUpdate(payload);
      });
    }

    if (window.electronAPI.onSessionState) {
      window.electronAPI.onSessionState((payload) => {
        if (!payload) return;
        if (payload.logins) app.state.logins = { ...app.state.logins, ...payload.logins };
        if (payload.hardening) app.state.hardening = payload.hardening;
        scheduleRender();
      });
    }
  };
})(window.AiHub);
