/**
 * Local OpenAI-compatible API — lifecycle + wiring.
 *
 * Everything Electron-specific lives here: reading settings, minting the API
 * key, keeping the HTTP server in sync with the config, and telling the shell UI
 * what is listening. The transport (`server.js`) and the browser driver
 * (`engine.js`) stay independent so they can be tested without a display.
 */

const { ipcMain } = require('electron');
const log = require('electron-log');

const configStore = require('./../config');
const dataStore = require('./../data');
const paths = require('./../paths');
const loginMonitor = require('./../logins');
const adapterLoader = require('./adapters');
const engine = require('./engine');
const serverFactory = require('./server');
const openai = require('./openai');
const { API, IPC } = require('./../constants');

/** @type {{server: object, port: number, host: string, url: string}|null} */
let instance = null;
let lastError = null;
let broadcast = () => {};
let setupDone = false;

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * The token is main-process owned: generated, rotated and read here only.
 * A key exists from the very first launch — `config` mints one on load and this
 * re-checks it, so an old or hand-edited config still ends up with a real key.
 */
function ensureToken() {
  return configStore.ensureApiToken();
}

function rotateToken() {
  const created = configStore.rotateApiToken();
  log.info('Rotated the local API key');
  return created;
}

function maskToken(token) {
  if (!token) return '';
  const value = String(token);
  if (value.length <= 14) return `${value.slice(0, 4)}…`;
  return `${value.slice(0, 10)}…${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function loadAdapters() {
  const { adapters, defaultAdapter, source } = adapterLoader.loadAdapters({
    userDataDir: paths.userDataDir(),
    bundledDataDir: paths.bundledDataDir(),
    log
  });
  engine.setAdapters(adapters, defaultAdapter);
  log.info(`Loaded ${adapters.size} chat adapter(s) from ${source} data`);
  return { count: adapters.size, source };
}

function currentSettings() {
  const config = configStore.getConfig();
  return {
    enabled: config.apiEnabled === true,
    port: clampPort(config.apiPort),
    host: '127.0.0.1'
  };
}

function clampPort(value) {
  const port = Number(value);
  if (!Number.isFinite(port)) return API.DEFAULT_PORT;
  return Math.min(API.MAX_PORT, Math.max(API.MIN_PORT, Math.round(port)));
}

/**
 * Start listening. On `EADDRINUSE` we walk a handful of ports forward so a
 * developer with something already on 8788 still gets a working endpoint.
 */
async function start({ restart = false, force = false } = {}) {
  const settings = currentSettings();
  if (!settings.enabled && !force) {
    await stop();
    return { ok: false, error: 'disabled' };
  }

  if (instance && !restart && instance.port === settings.port) {
    return { ok: true, alreadyRunning: true, ...describe() };
  }
  if (instance) await stop();

  const config = configStore.getConfig();
  const token = ensureToken();

  const server = serverFactory.createApiServer({
    version: safeVersion(),
    concurrency: config.apiMaxConcurrent || API.DEFAULT_CONCURRENCY,
    rateLimitPerMinute: config.apiRateLimitPerMinute || API.DEFAULT_RATE_LIMIT_PER_MINUTE,
    defaultTimeoutSeconds: config.apiTimeoutSeconds || API.DEFAULT_TIMEOUT_SECONDS,
    getToken: () => configStore.getConfigItem('apiToken', ''),
    authenticate: (candidate) => {
      const expected = configStore.getConfigItem('apiToken', '');
      if (!expected) return false;
      return serverFactory.timingSafeEqualText(candidate, expected);
    },
    listModels: () => engine.models(),
    listSessions: () => engine.sessions(),
    complete: (request, streamCtx) => engine.complete(request, streamCtx),
    onEvent: (entry) => {
      if (entry && entry.status && entry.status >= 400) {
        log.warn(`Local API ${entry.route} → ${entry.status} (${entry.ms}ms) ${entry.error || ''}`.trim());
      }
      broadcast(IPC.API_STATE, describe());
    }
  });

  const tried = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const port = settings.port + attempt;
    if (port > API.MAX_PORT) break;
    tried.push(port);
    try {
      // eslint-disable-next-line no-await-in-loop
      const bound = await server.listen(port, settings.host);
      instance = { server, port: bound.port, host: bound.host, url: bound.url, startedAt: Date.now() };
      lastError = null;
      // The key itself never reaches the log file; "a key exists" is enough.
      log.info(`Local API listening on ${bound.url} (${token ? 'key protected' : 'no key'})`);
      broadcast(IPC.API_STATE, describe());
      return { ok: true, ...describe() };
    } catch (error) {
      if (error && error.code === 'EADDRINUSE') continue;
      lastError = error.message;
      log.warn(`Unable to start the local API: ${error.message}`);
      return { ok: false, error: error.message, tried };
    }
  }

  lastError = 'port busy';
  return { ok: false, error: 'Port is already in use', tried };
}

async function stop() {
  if (!instance) return { ok: true, stopped: false };
  const { server } = instance;
  instance = null;
  try {
    await server.stop();
  } catch (error) {
    log.debug(`Local API stop error: ${error.message}`);
  }
  engine.dispose();
  log.info('Local API stopped');
  broadcast(IPC.API_STATE, describe());
  return { ok: true, stopped: true };
}

function safeVersion() {
  try {
    // eslint-disable-next-line global-require
    return require('./../../package.json').version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

function describe() {
  const settings = currentSettings();
  const config = configStore.getConfig();
  const token = configStore.getConfigItem('apiToken', '');
  const listing = instance ? instance.server.stats() : null;
  const catalogue = ((dataStore.getServicesCache() || {}).ai_services) || [];
  const models = engine.models();
  const freeModels = models.filter((model) => model.aihub && model.aihub.requiresLogin === false);
  const readyModels = models.filter((model) => model.aihub && model.aihub.ready);

  return {
    enabled: settings.enabled,
    listening: Boolean(instance),
    host: instance ? instance.host : settings.host,
    port: instance ? instance.port : settings.port,
    baseUrl: instance ? instance.url : `http://${settings.host}:${settings.port}/v1`,
    key: token || '',
    keyMasked: maskToken(token),
    models: models.map((model) => ({
      id: model.id,
      owned_by: model.owned_by,
      description: model.description,
      login: model.aihub ? model.aihub.login : 'unknown',
      strategy: model.aihub ? model.aihub.strategy : 'dom',
      requiresLogin: model.aihub ? model.aihub.requiresLogin !== false : true,
      ready: model.aihub ? model.aihub.ready === true : false,
      service: model.aihub ? model.aihub.service : null,
      upstreamModel: model.aihub ? model.aihub.upstreamModel : null
    })),
    modelCount: models.length,
    readyModelCount: readyModels.length,
    freeModelCount: freeModels.length,
    exposedServiceCount: engine.exposedServices().length,
    freeServiceCount: engine.exposedServices().filter((service) => service.requiresLogin === false).length,
    exposeAll: config.apiExposeAllServices !== false,
    catalogueCount: catalogue.length,
    ready: (() => {
      const states = loginMonitor.getAll();
      return Object.values(states).filter((record) => record && record.state === loginMonitor.STATE.LOGGED_IN).length;
    })(),
    queue: listing ? listing.queue : { active: 0, queued: 0, limit: configStore.getConfigItem('apiMaxConcurrent', 2) },
    counters: listing ? listing.counters : { requests: 0, completed: 0, failed: 0, cancelled: 0, streaming: 0 },
    recent: listing ? listing.recent : [],
    lastError,
    engine: engine.status()
  };
}

/** Called by `src/ipc.js` after any config write. */
function onConfigChanged(previous, next) {
  const wasEnabled = previous && previous.apiEnabled;
  const isEnabled = next && next.apiEnabled;
  const portChanged = previous && next && Number(previous.apiPort) !== Number(next.apiPort);
  const concurrencyChanged =
    previous && next && Number(previous.apiMaxConcurrent) !== Number(next.apiMaxConcurrent);

  if (!wasEnabled && isEnabled) return start();
  if (wasEnabled && !isEnabled) return stop();
  if (wasEnabled && isEnabled && (portChanged || concurrencyChanged)) return start({ restart: true });
  return Promise.resolve({ ok: true, unchanged: true });
}

/**
 * Register the API's IPC surface and start it when the user had it enabled.
 * @param {{send?: (channel: string, payload: object) => void}} [hooks]
 */
function setup({ send } = {}) {
  if (typeof send === 'function') broadcast = send;
  if (!setupDone) {
    setupDone = true;
    loadAdapters();

    ipcMain.handle(IPC.GET_API_STATUS, () => describe());
    ipcMain.handle(IPC.ROTATE_API_TOKEN, () => {
      const token = rotateToken();
      return { ok: true, key: token, keyMasked: maskToken(token) };
    });
    ipcMain.handle(IPC.API_PING, async () => {
      // Self-test: hit our own /health endpoint through HTTP so the user sees
      // the real round trip (auth, host checks, port).
      if (!instance) return { ok: false, error: 'not-running' };
      const http = require('http');
      const token = configStore.getConfigItem('apiToken', '');
      return new Promise((resolve) => {
        const request = http.get(
          { host: instance.host, port: instance.port, path: '/health', headers: { authorization: `Bearer ${token}` } },
          (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () =>
              resolve({
                ok: response.statusCode === 200,
                status: response.statusCode,
                body: Buffer.concat(chunks).toString('utf8').slice(0, 400)
              })
            );
          }
        );
        request.on('error', (error) => resolve({ ok: false, error: error.message }));
        request.setTimeout(4000, () => {
          request.destroy(new Error('timeout'));
        });
      });
    });
  }

  if (currentSettings().enabled) {
    return start().catch((error) => {
      lastError = error.message;
      return { ok: false, error: error.message };
    });
  }
  return Promise.resolve({ ok: true, skipped: 'disabled' });
}

/**
 * A ready-to-paste example for the settings panel.
 * @param {string} baseUrl
 * @param {string} modelId
 */
function curlExample(baseUrl, modelId) {
  return [
    `curl ${baseUrl}/chat/completions \\`,
    "  -H \"Authorization: Bearer $AIHUB_KEY\" \\",
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model": "${modelId || 'aihub/chatgpt'}", "messages": [{"role": "user", "content": "Summarise my last chat"}]}'`,
    '',
    `# or point any OpenAI SDK at ${baseUrl} with api_key = your key`
  ].join('\n');
}

module.exports = {
  setup,
  start,
  stop,
  restart: () => start({ restart: true }),
  describe,
  onConfigChanged,
  loadAdapters,
  ensureToken,
  rotateToken,
  maskToken,
  curlExample,
  modelIdFor: openai.modelIdFor,
  serviceIdFromModel: openai.serviceIdFromModel,
  isRunning: () => Boolean(instance),
  _instance: () => instance
};
