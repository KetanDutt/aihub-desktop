/**
 * Renderer hardening: permission prompts, navigation guards and a policy for
 * links that try to escape a tab.
 *
 * Rules of thumb implemented here:
 *  - everything Chromium can ask for is denied unless explicitly allowed below;
 *  - the shell UI can never navigate away from `file://`;
 *  - `window.open` / `target=_blank` never produces a bare Electron window: the
 *    URL is either opened in a new tab of the same service, or handed to the
 *    OS browser after the user confirms;
 *  - top level navigation stays inside the tab's allow-list.
 */

const { shell, dialog, session } = require('electron');
const log = require('electron-log');
const { isSafeHttpUrl } = require('./utils');

/**
 * Permission policy. Anything not listed is denied.
 * 'ask' shows a native confirmation dialog and remembers the answer for the
 * lifetime of the app.
 */
const PERMISSION_POLICY = {
  media: 'ask', // microphone / camera (voice input, screen share)
  notifications: 'ask',
  clipboardSanitizedWrite: 'allow',
  clipboardSanitizedRead: 'allow',
  fullscreen: 'allow',
  'storage-access': 'allow',
  geolocation: 'deny',
  midi: 'deny',
  midiSysex: 'deny',
  pointerLock: 'deny',
  'display-capture': 'deny',
  openExternal: 'deny',
  idleDetection: 'deny',
  keyboardLock: 'deny',
  usb: 'deny',
  serial: 'deny',
  hid: 'deny',
  bluetooth: 'deny',
  'mediaKeySystem': 'deny',
  'top-level-storage-access': 'deny'
};

const PERMISSION_LABELS = {
  media: 'use your microphone or camera',
  notifications: 'show notifications'
};

/** origin|permission -> boolean (session-lifetime memory of user answers) */
const permissionMemory = new Map();

function decidePermission(requestingOrigin, permission) {
  const policy = PERMISSION_POLICY[permission] || 'deny';
  if (policy !== 'ask') return policy === 'allow';

  const key = `${requestingOrigin}|${permission}`;
  if (permissionMemory.has(key)) return permissionMemory.get(key);

  const label = PERMISSION_LABELS[permission] || `use the "${permission}" capability`;
  const { response } = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Allow', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    title: 'Permission requested',
    message: `${requestingOrigin} wants to ${label}.`,
    detail: 'AI Hub Desktop only grants this for the current session.'
  });

  const granted = response === 0;
  permissionMemory.set(key, granted);
  return granted;
}

/**
 * Install permission handlers on a session. Idempotent.
 * @param {Electron.Session} [targetSession]
 */
function hardenSession(targetSession) {
  const ses = targetSession || session.defaultSession;
  if (!ses) return false;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = (details && details.requestingUrl) || (webContents && webContents.getURL()) || 'unknown';
    let granted = false;
    try {
      granted = decidePermission(origin, permission);
    } catch (e) {
      log.error('Permission prompt failed:', e.message);
      granted = false;
    }
    log.info(`Permission ${permission} for ${origin}: ${granted ? 'granted' : 'denied'}`);
    callback(granted);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const policy = PERMISSION_POLICY[permission] || 'deny';
    if (policy === 'allow') return true;
    if (policy === 'ask') return permissionMemory.get(`${requestingOrigin}|${permission}`) === true;
    return false;
  });

  if (typeof ses.setDevicePermissionHandler === 'function') {
    ses.setDevicePermissionHandler(() => false);
  }

  return true;
}

/**
 * Validate + hand a URL to the operating system browser.
 * @param {string} url
 * @param {{ confirm?: boolean, parent?: Electron.BrowserWindow }} [options]
 * @returns {Promise<boolean>} whether the URL was opened
 */
async function openExternal(url, { confirm = true, parent = null } = {}) {
  if (!isSafeHttpUrl(url)) {
    log.warn('Refused to open non-http(s) URL:', String(url).slice(0, 120));
    return false;
  }

  if (confirm) {
    let hostname = url;
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      /* keep the raw value */
    }
    const { response } = await dialog.showMessageBox(parent || undefined, {
      type: 'question',
      buttons: ['Open in browser', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Open external link',
      message: `Open ${hostname} in your default browser?`,
      detail: url
    });
    if (response !== 0) return false;
  }

  try {
    await shell.openExternal(url);
    return true;
  } catch (e) {
    log.error('Unable to open external URL:', e.message);
    return false;
  }
}

/**
 * Lock the app shell window down: no navigation away from the bundled UI, no
 * child windows, no permission grants.
 * @param {Electron.BrowserWindow} window
 */
function installShellGuards(window) {
  const contents = window.webContents;

  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      log.warn('Blocked shell navigation attempt to', url);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
}

/**
 * Attach per-tab guards to a tab's webContents.
 *
 * @param {Electron.WebContents} contents
 * @param {{
 *   isAllowed: (hostname: string) => boolean,
 *   onBlocked: (info: {url: string, hostname: string, kind: string}) => void,
 *   onOpenNewTab: (url: string) => void,
 *   onOpenExternal: (url: string) => void
 * }} hooks
 */
function attachTabGuards(contents, hooks) {
  const { isAllowed, onBlocked, onOpenNewTab, onOpenExternal } = hooks;

  const allowed = (url) => {
    try {
      return isAllowed(new URL(url).hostname);
    } catch (e) {
      return false;
    }
  };

  contents.on('will-navigate', (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    onBlocked({ url, hostname: safeHostnameOf(url), kind: 'navigation' });
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) {
      // Same service: keep the user inside the tab strip.
      onOpenNewTab(url);
      return { action: 'deny' };
    }
    onOpenExternal(url);
    return { action: 'deny' };
  });

  contents.on('render-process-gone', (event, details) => {
    log.error('Tab renderer crashed:', details && details.reason);
  });

  contents.on('unresponsive', () => {
    log.warn('Tab became unresponsive:', contents.getURL());
  });
}

function safeHostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

/** Forget remembered permission answers (used by "Clear session data"). */
function clearPermissionMemory() {
  permissionMemory.clear();
}

module.exports = {
  PERMISSION_POLICY,
  hardenSession,
  openExternal,
  installShellGuards,
  attachTabGuards,
  clearPermissionMemory
};
