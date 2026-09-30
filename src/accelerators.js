/**
 * Keyboard accelerators → shell commands.
 *
 * The service tabs are real `WebContentsView`s, so once the user clicks inside
 * one, keystrokes belong to that site — the app chrome never sees them. Without
 * a bridge, `Ctrl+W` in a ChatGPT tab would close the website's modal instead of
 * the tab, and none of the shortcuts advertised in the `?` dialog would work
 * while reading an answer.
 *
 * `src/window.js` therefore inspects every key press with `before-input-event`
 * and forwards the ones this module recognises to the renderer. Only a curated
 * list crosses over: anything a site legitimately owns (plain typing, `Esc`,
 * `Ctrl+A`, site-specific editor chords) is left alone.
 *
 * Deliberately free of Electron imports so the mapping is unit testable.
 */

const { IPC } = require('./constants');

/**
 * Commands the renderer understands. Kept in one place so the sender
 * (`window.js`), the validator below and the renderer's dispatch table can be
 * checked against each other.
 */
const APP_COMMANDS = [
  'new-tab',
  'reopen-tab',
  'close-tab',
  'toggle-sidebar',
  'next-tab',
  'prev-tab',
  'reload',
  'reload-hard',
  'back',
  'forward',
  'home',
  'find',
  'mute',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'settings',
  'shortcuts'
];

/** `select-tab:3` — jump straight to the nth tab. */
const SELECT_TAB_PREFIX = 'select-tab:';

/**
 * Is this a command this app is allowed to send to its own renderer?
 * @param {unknown} value
 * @returns {boolean}
 */
function isAppCommand(value) {
  if (typeof value !== 'string') return false;
  if (APP_COMMANDS.includes(value)) return true;
  if (value.startsWith(SELECT_TAB_PREFIX)) {
    const index = value.slice(SELECT_TAB_PREFIX.length);
    return /^[1-9]$/.test(index);
  }
  return false;
}

/**
 * Map an Electron `before-input-event` payload to a shell command.
 *
 * @param {{type?: string, key?: string, control?: boolean, meta?: boolean,
 *          alt?: boolean, shift?: boolean, isComposing?: boolean,
 *          isAutoRepeat?: boolean}} input
 * @param {string} [platform] `process.platform` — decides the primary modifier
 * @returns {string|null} command, or null when the page should keep the key
 */
function commandForInput(input, platform = process.platform) {
  if (!input || typeof input !== 'object') return null;
  // `keyUp`/`char` would double-fire every action.
  if (input.type && input.type !== 'keyDown') return null;
  // Never steal keys from an in-progress IME composition.
  if (input.isComposing) return null;

  const key = typeof input.key === 'string' ? input.key : '';
  if (!key) return null;

  const lower = key.toLowerCase();
  const isMac = platform === 'darwin';
  const primary = isMac ? Boolean(input.meta) : Boolean(input.control);
  // Ctrl on macOS (or Cmd on Windows/Linux) is a site chord, not ours.
  const foreignPrimary = isMac ? Boolean(input.control) : Boolean(input.meta);
  const shift = Boolean(input.shift);
  const alt = Boolean(input.alt);

  // -- Modifier-free function keys -----------------------------------------
  if (!primary && !foreignPrimary && !alt) {
    if (lower === 'f5') return 'reload';
    if (lower === 'f1') return 'shortcuts';
    return null;
  }

  // -- Alt navigation (a browser habit worth keeping) -----------------------
  if (alt && !primary && !foreignPrimary) {
    if (lower === 'arrowleft') return 'back';
    if (lower === 'arrowright') return 'forward';
    if (lower === 'home') return 'home';
    return null;
  }

  if (!primary || foreignPrimary || alt) return null;

  // -- Primary modifier -----------------------------------------------------
  if (lower === 'tab') return shift ? 'prev-tab' : 'next-tab';
  if (lower === 'pagedown') return 'next-tab';
  if (lower === 'pageup') return 'prev-tab';
  if (/^[1-9]$/.test(lower)) return shift ? null : `${SELECT_TAB_PREFIX}${lower}`;
  if (lower === 't') return shift ? 'reopen-tab' : 'new-tab';
  if (lower === 'w') return shift ? null : 'close-tab';
  if (lower === 'r') return shift ? 'reload-hard' : 'reload';
  if (lower === 'f') return shift ? null : 'find';
  if (lower === 'm') return shift ? null : 'mute';
  if (lower === 'b') return shift ? null : 'toggle-sidebar';
  // `Ctrl+=` and its shifted sibling `Ctrl+Shift+=` (which reports `+`) both
  // mean "zoom in", matching every browser.
  if (lower === '+') return 'zoom-in';
  if (lower === '=') return shift ? null : 'zoom-in';
  if (lower === '-') return shift ? null : 'zoom-out';
  if (lower === '0') return shift ? null : 'zoom-reset';
  if (lower === ',') return shift ? null : 'settings';

  return null;
}

/**
 * Keys worth forwarding even when nothing is listening, and the channel they
 * travel on. Exported so `window.js` and the preload bridge cannot drift.
 */
const APP_COMMAND_CHANNEL = IPC.APP_COMMAND;

module.exports = {
  APP_COMMANDS,
  APP_COMMAND_CHANNEL,
  SELECT_TAB_PREFIX,
  isAppCommand,
  commandForInput
};
