/**
 * Local API panel: status, key, exposure and a live view of what the endpoint
 * has served. Everything is read from the main process (`get-api-status`);
 * settings changes go through the normal `save-config` path.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const utils = window.AiHubUtils;

  let keyRevealed = false;
  let currentKey = '';
  let currentBaseUrl = '';

  function copyToClipboard(text, label) {
    if (!text) {
      app.toast('Nothing to copy yet', 'warning');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => app.toast(`${label} copied`, 'success'))
      .catch(() => app.toast('Clipboard unavailable', 'error'));
  }

  app.refreshApi = async function refreshApi() {
    if (!window.electronAPI.getApiStatus) return null;
    try {
      const status = await window.electronAPI.getApiStatus();
      app.state.api = status;
      currentKey = (status && status.key) || '';
      currentBaseUrl = (status && status.baseUrl) || '';
      app.renderApiPanel();
      return status;
    } catch (error) {
      const line = app.elements && app.elements.apiStatusLine;
      if (line) line.textContent = 'The local API status is unavailable.';
      return null;
    }
  };

  app.renderApiPanel = function renderApiPanel() {
    const status = app.state.api;
    if (!status) return;

    const el = app.elements;

    if (el.apiStatusLine) {
      const counters = status.counters || {};
      const bits = [
        status.listening ? `Listening on ${status.baseUrl}` : 'Stopped',
        `${status.modelCount || 0} model(s)`,
        `${status.ready || 0} signed in`,
        `${counters.requests || 0} request(s)`,
        `${(status.queue && status.queue.active) || 0} running`
      ];
      if (status.lastError) bits.push(`last error: ${status.lastError}`);
      el.apiStatusLine.textContent = bits.join(' · ');
    }

    if (el.apiEndpointLine) {
      el.apiEndpointLine.textContent = `OpenAI base URL: ${status.baseUrl || '—'}   key: ${status.keyMasked || 'none'}`;
    }

    if (el.apiKeyField) {
      el.apiKeyField.type = keyRevealed ? 'text' : 'password';
      el.apiKeyField.value = keyRevealed ? currentKey : currentKey ? '•'.repeat(Math.min(24, currentKey.length)) : '';
    }

    if (el.apiPort && document.activeElement !== el.apiPort) el.apiPort.value = status.port;
    if (el.toggleApiEnabled) el.toggleApiEnabled.checked = Boolean(status.enabled);
    if (el.toggleApiAllServices) el.toggleApiAllServices.checked = status.exposeAll !== false;

    app.renderApiModels(status.models || []);
    app.renderApiLog(status.recent || []);
    app.renderApiServices();
    renderCurl(status);
  };

  function renderCurl(status) {
    const el = app.elements.apiCurlExample;
    if (!el) return;
    const base = status.baseUrl || currentBaseUrl || 'http://127.0.0.1:8788/v1';
    const model = (status.models && status.models[0] && status.models[0].id) || 'aihub/chatgpt';
    el.textContent = [
      `curl ${base}/chat/completions \\`,
      '  -H "Authorization: Bearer <key>" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"${model}","stream":true,"messages":[{"role":"user","content":"Summarise my last chat"}]}'`,
      '',
      `# python:  OpenAI(base_url="${base}", api_key="<key>")`
    ].join('\n');
  }

  app.renderApiModels = function renderApiModels(models) {
    const list = app.elements.apiModelList;
    if (!list) return;

    list.innerHTML = '';

    if (!models.length) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'No services are exposed. Enable the API and expose at least one service.';
      list.appendChild(hint);
      return;
    }

    for (const model of models) {
      const row = document.createElement('div');
      row.className = 'api-model-row';

      const id = document.createElement('code');
      id.className = 'api-model-id';
      id.textContent = model.id;

      const badge = document.createElement('span');
      badge.className = `login-chip login-${model.login || 'unknown'}`;
      badge.textContent =
        model.login === 'logged-in' ? 'ready' : model.login === 'challenge' ? 'verifying' : model.login === 'logged-out' ? 'sign in' : 'unknown';

      const strategy = document.createElement('span');
      strategy.className = 'api-model-strategy';
      strategy.textContent = model.strategy === 'api' ? 'direct API' : 'browser driver';

      row.append(id, badge, strategy);
      list.appendChild(row);
    }
  };

  app.renderApiLog = function renderApiLog(entries) {
    const log = app.elements.apiLog;
    if (!log) return;

    log.innerHTML = '';

    if (!entries.length) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'No requests yet.';
      log.appendChild(hint);
      return;
    }

    for (const entry of [...entries].reverse()) {
      const row = document.createElement('div');
      row.className = 'api-log-row';

      const statusEl = document.createElement('span');
      const statusNumber = entry.status || 0;
      statusEl.className = `api-log-status ${statusNumber >= 400 ? 'is-error' : 'is-ok'}`;
      statusEl.textContent = String(statusNumber);

      const route = document.createElement('span');
      route.className = 'api-log-route';
      route.textContent = `${entry.route || ''} ${entry.model ? `· ${entry.model}` : ''}${entry.stream ? ' · stream' : ''}`;

      const timing = document.createElement('span');
      timing.className = 'api-log-timing';
      timing.textContent = `${entry.ms || 0} ms`;

      row.append(statusEl, route, timing);
      if (entry.error) row.title = String(entry.error);
      log.appendChild(row);
    }
  };

  /** Checkbox list deciding which services the endpoint may drive. */
  app.renderApiServices = function renderApiServices() {
    const list = app.elements.apiServicesList;
    if (!list) return;

    const status = app.state.api || {};
    const enabled = new Set(app.state.config.enabledServices || []);
    const chosen = new Set(app.state.config.apiServices || []);
    const candidates = app.state.services.filter((service) => enabled.has(service.id) || chosen.has(service.id));

    list.innerHTML = '';

    if (status.exposeAll !== false) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'Every enabled service is callable while “expose every service” is on.';
      list.appendChild(hint);
      return;
    }

    if (candidates.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'Enable a service in the Services tab first.';
      list.appendChild(hint);
      return;
    }

    for (const service of candidates) {
      const label = document.createElement('label');
      label.className = 'api-service-check';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = chosen.has(service.id);
      input.dataset.id = service.id;

      const text = document.createElement('span');
      text.textContent = `${service.name}  ·  aihub/${service.id}`;

      input.addEventListener('change', () => {
        const next = new Set(app.state.config.apiServices || []);
        if (input.checked) next.add(service.id);
        else next.delete(service.id);
        app.state.config.apiServices = [...next];
        app.saveSettings();
      });

      label.append(input, text);
      list.appendChild(label);
    }
  };

  app.initApiPanel = function initApiPanel() {
    const el = app.elements;
    if (!el.apiStatusLine) return;

    if (el.btnApiReveal) {
      el.btnApiReveal.addEventListener('click', () => {
        keyRevealed = !keyRevealed;
        el.btnApiReveal.textContent = keyRevealed ? 'Hide' : 'Show';
        app.renderApiPanel();
      });
    }

    if (el.btnApiCopy) el.btnApiCopy.addEventListener('click', () => copyToClipboard(currentKey, 'API key'));
    if (el.btnApiCopyCurl) {
      el.btnApiCopyCurl.addEventListener('click', () =>
        copyToClipboard(el.apiCurlExample ? el.apiCurlExample.textContent : '', 'Example copied')
      );
    }

    if (el.btnApiRotate) {
      el.btnApiRotate.addEventListener('click', async () => {
        const ok = await app.confirm({
          title: 'Rotate the local API key?',
          message: 'Anything already configured with the old key stops working until it is updated.',
          confirmLabel: 'Rotate key'
        });
        if (!ok) return;
        const result = await window.electronAPI.rotateApiToken().catch(() => null);
        if (result && result.ok) {
          currentKey = result.key;
          await app.refreshApi();
          app.toast('New API key issued', 'success');
        } else {
          app.toast('Unable to rotate the key', 'error');
        }
      });
    }

    if (el.btnApiPing) {
      el.btnApiPing.addEventListener('click', async () => {
        el.btnApiPing.disabled = true;
        utils.showStatus('Testing the local endpoint…', 'loading');
        const result = await window.electronAPI.apiPing().catch(() => null);
        el.btnApiPing.disabled = false;
        if (result && result.ok) {
          app.toast('Endpoint answered /health', 'success');
          utils.showStatus('Endpoint answered', 'success');
        } else if (result && result.error === 'not-running') {
          app.toast('The API is not running — enable it above', 'warning');
        } else {
          app.toast(`Test failed: ${(result && (result.error || result.status)) || 'unknown'}`, 'error');
        }
        await app.refreshApi();
      });
    }

    if (window.electronAPI.onApiState) {
      const refresh = utils.debounce(() => app.refreshApi(), 500);
      window.electronAPI.onApiState(() => refresh());
    }
  };
})(window.AiHub);
