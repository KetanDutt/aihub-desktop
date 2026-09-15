/**
 * AI Hub Desktop - main process entry point.
 *
 * Responsibilities: logging, crash containment, single-instance handling, deep
 * links (`aihub://<service>`), and wiring the modules together on startup.
 */

const { app, session, dialog, webContents } = require('electron');
const path = require('path');

const log = require('./src/logger');

log.configure({ isPackaged: app.isPackaged });

// Hot reload is a development-only convenience and lives in devDependencies,
// so it must never be required in a packaged build.
if (!app.isPackaged && process.env.NODE_ENV !== 'test' && process.env.AIHUB_NO_RELOAD !== '1') {
  try {
    // eslint-disable-next-line global-require
    require('electron-reload')(__dirname, {
      electron: require(path.join(__dirname, 'node_modules', 'electron')),
      hardResetMethod: 'exit'
    });
  } catch (error) {
    log.warn('Hot reload unavailable:', error.message);
  }
}

const { PROTOCOL, IPC } = require('./src/constants');
const { slugify } = require('./src/utils');

const dataStore = require('./src/data');
const windowManager = require('./src/window');
const blockingManager = require('./src/blocking');
const ipcManager = require('./src/ipc');
const updaterManager = require('./src/updater');
const sessionStore = require('./src/sessionstore');
const loginMonitor = require('./src/logins');
const stealth = require('./src/stealth');
const localApi = require('./src/api');
const headless = require('./src/headless');

/**
 * `--headless` / `--api-only` / `AIHUB_HEADLESS=1` runs the local API server
 * without the desktop shell: no window, no tray, no updater — just the endpoint.
 */
const HEADLESS = headless.isHeadless();
const HEADLESS_OPTIONS = HEADLESS ? headless.options() : { port: null, printKey: false, quiet: false };

// Blink flags for the anti-bot hardening have to exist before any renderer is
// created, so this runs at require time — not from inside `bootstrap()`.
stealth.applyCommandLineFlags();

/** Deep links received before the shell UI is ready. */
const pendingDeepLinks = [];
let shellReady = false;

// ---------------------------------------------------------------------------
// Crash containment
// ---------------------------------------------------------------------------

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
  try {
    if (!app.isPackaged) dialog.showErrorBox('Unexpected error', String(error && error.message));
  } catch (e) {
    /* nothing sensible left to do */
  }
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

/**
 * Validate the service id carried by an `aihub://` URL.
 * @param {string} serviceId
 * @returns {boolean}
 */
function validateServiceId(serviceId) {
  // Strict on purpose: the raw value must already be a safe slug. The renderer
  // produces ids via the same rule, so no normalisation is needed here.
  if (typeof serviceId !== 'string') return false;
  const id = serviceId.trim();
  return id.length > 0 && id.length <= 64 && /^[a-z0-9]+$/i.test(id);
}

function deliverDeepLink(serviceId) {
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed() && shellReady) {
    mainWindow.webContents.send('deep-link-open', serviceId);
    return true;
  }
  pendingDeepLinks.push(serviceId);
  return false;
}

function flushPendingDeepLinks() {
  shellReady = true;
  const mainWindow = windowManager.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  while (pendingDeepLinks.length > 0) {
    mainWindow.webContents.send('deep-link-open', pendingDeepLinks.shift());
  }
}

function handleDeepLinkUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.startsWith(`${PROTOCOL}://`)) return false;
  try {
    const url = new URL(urlStr);
    // aihub://chatgpt  -> hostname "chatgpt"; aihub:///chatgpt -> pathname.
    const serviceId = url.hostname || url.pathname.replace(/^\/+/, '');
    if (!validateServiceId(serviceId)) {
      log.warn('Rejected deep link with invalid service id:', serviceId);
      return false;
    }
    log.info('Deep link accepted:', serviceId);
    return deliverDeepLink(slugify(serviceId));
  } catch (error) {
    log.error('Unable to parse deep link:', error.message);
    return false;
  }
}

function extractDeepLink(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${PROTOCOL}://`)) || null;
}

// ---------------------------------------------------------------------------
// Hardening applied to every webContents created anywhere in the app
// ---------------------------------------------------------------------------

app.on('web-contents-created', (event, contents) => {
  // No nested <webview> tags anywhere.
  contents.on('will-attach-webview', (attachEvent) => attachEvent.preventDefault());

  contents.on('destroyed', () => {
    blockingManager.removeTabDomains(contents.id);
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function bootstrap() {
  log.info(
    `Starting ${app.getName()} ${app.getVersion()} (packaged: ${app.isPackaged}${HEADLESS ? ', headless API server' : ''})`
  );

  ipcManager.setupIpcHandlers();

  // Load the bundled/downloaded catalogue before anything can open a tab.
  await dataStore.initialize();

  const configStore = require('./src/config');
  blockingManager.updateBlockingState(configStore.getConfig(), dataStore.getRulesCache());
  blockingManager.setupWebRequestBlocking();

  const securityManager = require('./src/security');
  securityManager.hardenSession(session.defaultSession);

  // --- Sessions: cached cookies first, then watch, then react -------------
  // Replaying the cached jar *before* any tab navigates is what turns a
  // "welcome back" into a silent resume instead of a sign-in wall.
  sessionStore.loadProfiles();
  stealth.initialise(session.defaultSession);

  const services = (await dataStore.loadServices()) || { ai_services: [] };
  const restore = await sessionStore.restoreAll(services.ai_services || []);
  if (restore.restored > 0) log.info(`Replayed ${restore.restored} cached cookie(s) at startup`);

  loginMonitor.setup({
    send: (channel, payload) => {
      const win = windowManager.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
    onRelogin: (request) => (HEADLESS ? null : windowManager.reloginService(request))
  });

  if (HEADLESS) {
    // No Dock icon on macOS: this process is a server, not an app window.
    try {
      if (process.platform === 'darwin' && app.dock && typeof app.dock.hide === 'function') app.dock.hide();
    } catch (error) {
      log.debug(`Unable to hide the dock icon: ${error.message}`);
    }
  } else {
    windowManager.createMainWindow();
    windowManager.setupTray();
    const shortcut = windowManager.setupGlobalShortcuts();
    if (shortcut && !shortcut.ok) {
      log.warn(`Global shortcut unavailable (${shortcut.error})`);
    }
  }

  const mainWindow = windowManager.getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      flushPendingDeepLinks();
      // Once the shell is up: work out where every session actually stands, and
      // re-open sign-in pages for the ones that quietly expired.
      setTimeout(() => {
        loginMonitor
          .reloginOnOpen(windowManager.openServiceIds())
          .then((result) => {
            if (result && result.attempted && result.attempted.length > 0) {
              sendToShell(IPC.LOGIN_STATE, { relogin: result.attempted });
            }
          })
          .catch((error) => log.warn(`Relogin pass failed: ${error.message}`));
      }, 1500);
    });
  }

  function sendToShell(channel, payload) {
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  // Prime the login states from the freshly restored jar (no DOM yet), so the
  // very first paint of the service list can already show "signed in".
  loginMonitor.primeFromCache((services.ai_services || []).slice(0, 40)).catch(() => {});

  // Register the IPC surface and load the adapters in both modes; headless then
  // forces the server up (the shell is not there to toggle it).
  await localApi.setup({ send: sendToShell });

  if (HEADLESS) {
    if (configStore.getConfigItem('apiEnabled', true) !== true) {
      configStore.updateConfigItem('apiEnabled', true);
    }
    if (Number.isFinite(HEADLESS_OPTIONS.port) && HEADLESS_OPTIONS.port > 0) {
      configStore.updateConfigItem('apiPort', Math.round(HEADLESS_OPTIONS.port));
    }
    const started = await localApi.start({ force: true, restart: true });
    const status = localApi.describe();
    // `console` so it lands on the terminal that launched us, not only the log.
    if (!HEADLESS_OPTIONS.quiet) {
      console.log(headless.banner(status, {
        printKey: HEADLESS_OPTIONS.printKey,
        version: app.getVersion()
      }));
    }
    if (!started || started.ok === false) {
      log.error(`Headless API server failed to start: ${(started && started.error) || 'unknown error'}`);
      app.quit(1);
      return;
    }
    log.info(`Headless API server ready on ${status.baseUrl}`);
  } else {
    if (configStore.getConfigItem('apiEnabled', true)) {
      log.info('Local OpenAI-compatible API is enabled');
    }
    updaterManager.setupAutoUpdater();
  }

  // A deep link may have launched the app.
  const initialLink = extractDeepLink(process.argv);
  if (initialLink) handleDeepLinkUrl(initialLink);
}

// A headless server is stopped the way any terminal process is: Ctrl+C.
if (HEADLESS) {
  const shutdown = (signal) => {
    log.info(`Received ${signal}, stopping the headless API server`);
    localApi
      .stop()
      .catch(() => {})
      .finally(() => app.quit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.info('Another instance is already running, exiting');
  if (HEADLESS && !HEADLESS_OPTIONS.quiet) {
    // The desktop app already serves the same endpoint on the same port, so
    // this is the expected outcome, not a failure — say so instead of exiting
    // silently and leaving the operator staring at a dead console.
    console.log(
      [
        '',
        '[aihub] AI Hub Desktop is already running, and its window owns the API server.',
        '        Use that one, or close the app and re-run this script.',
        ''
      ].join('\n')
    );
  }
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    log.info('Second instance detected, focusing the existing window');
    windowManager.showMainWindow();

    const url = extractDeepLink(commandLine);
    if (url) handleDeepLinkUrl(url);
  });

  // macOS deep links.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    log.info('Received deep link:', url);
    handleDeepLinkUrl(url);
  });

  app.whenReady().then(bootstrap).catch((error) => {
    log.error('Startup failed:', error);
    dialog.showErrorBox('Startup failed', String(error && error.message));
    app.quit();
  });

  app.on('activate', () => {
    // macOS: reopening from the Dock must always give you a window. Headless
    // has no window by design, so there is nothing to restore.
    if (HEADLESS) return;
    if (webContents.getAllWebContents().length === 0) {
      windowManager.createMainWindow();
    } else {
      windowManager.showMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    // Headless never opened a window; quitting here would end the server.
    if (HEADLESS) return;
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    windowManager.setQuitting(true);
    // Cache while the sessions are still alive: this is the snapshot the next
    // launch restores. Best-effort — a slow page must never block quitting.
    try {
      void loginMonitor.flush();
    } catch (error) {
      log.debug(`Session flush on quit skipped: ${error.message}`);
    }
  });

  app.on('will-quit', () => {
    try {
      windowManager.shutdown();
      blockingManager.teardownWebRequestBlocking();
      stealth.teardown();
      void localApi.stop();
      loginMonitor.stopSweeps();
    } catch (error) {
      log.error('Error during shutdown:', error.message);
    }
  });
}

module.exports = {
  validateServiceId,
  handleDeepLinkUrl,
  extractDeepLink
};
