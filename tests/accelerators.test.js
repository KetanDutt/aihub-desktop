/**
 * Keyboard bridge between a focused service tab and the app shell.
 *
 * The rule to protect: a command is only produced for keys the app owns, and
 * only for the platform's primary modifier. Anything else must fall through to
 * the page, because a chat site's own shortcuts matter as much as ours.
 */

jest.mock('electron', () => ({}), { virtual: true });

const { commandForInput, isAppCommand, APP_COMMANDS } = require('../src/accelerators');

/** Build a `before-input-event` payload the way Electron does. */
function press(key, modifiers = {}, extra = {}) {
  const { ctrl = false, meta = false, alt = false, shift = false } = modifiers;
  return {
    type: 'keyDown',
    key,
    control: ctrl,
    meta,
    alt,
    shift,
    isAutoRepeat: false,
    isComposing: false,
    ...extra
  };
}

const win = (key, mods, extra) => commandForInput(press(key, mods, extra), 'win32');
const mac = (key, mods, extra) => commandForInput(press(key, mods, extra), 'darwin');

describe('commandForInput (Windows/Linux)', () => {
  it('maps the primary-modifier shortcuts', () => {
    expect(win('t', { ctrl: true })).toBe('new-tab');
    expect(win('T', { ctrl: true, shift: true })).toBe('reopen-tab');
    expect(win('w', { ctrl: true })).toBe('close-tab');
    expect(win('b', { ctrl: true })).toBe('toggle-sidebar');
    expect(win('r', { ctrl: true })).toBe('reload');
    expect(win('R', { ctrl: true, shift: true })).toBe('reload-hard');
    expect(win('f', { ctrl: true })).toBe('find');
    expect(win('m', { ctrl: true })).toBe('mute');
    expect(win(',', { ctrl: true })).toBe('settings');
  });

  it('maps tab navigation', () => {
    expect(win('Tab', { ctrl: true })).toBe('next-tab');
    expect(win('Tab', { ctrl: true, shift: true })).toBe('prev-tab');
    expect(win('PageDown', { ctrl: true })).toBe('next-tab');
    expect(win('PageUp', { ctrl: true })).toBe('prev-tab');
    expect(win('9', { ctrl: true })).toBe('select-tab:9');
    expect(win('1', { ctrl: true })).toBe('select-tab:1');
  });

  it('maps zoom keys, with or without the shift that produces “+”', () => {
    expect(win('=', { ctrl: true })).toBe('zoom-in');
    expect(win('+', { ctrl: true, shift: true })).toBe('zoom-in');
    expect(win('-', { ctrl: true })).toBe('zoom-out');
    expect(win('0', { ctrl: true })).toBe('zoom-reset');
  });

  it('maps bare function keys and Alt navigation', () => {
    expect(win('F5')).toBe('reload');
    expect(win('F1')).toBe('shortcuts');
    expect(win('ArrowLeft', { alt: true })).toBe('back');
    expect(win('ArrowRight', { alt: true })).toBe('forward');
    expect(win('Home', { alt: true })).toBe('home');
  });
});

describe('commandForInput (macOS)', () => {
  it('uses Command, not Control', () => {
    expect(mac('t', { meta: true })).toBe('new-tab');
    expect(mac('t', { ctrl: true })).toBeNull();
    expect(mac('w', { ctrl: true })).toBeNull();
  });

  it('lets Control chords through to the site on macOS', () => {
    // Ctrl+A / Ctrl+E / Ctrl+K are readline bindings sites rely on.
    expect(mac('a', { ctrl: true })).toBeNull();
    expect(mac('e', { ctrl: true })).toBeNull();
  });
});

describe('keys that stay with the page', () => {
  it('ignores plain typing', () => {
    expect(win('a')).toBeNull();
    expect(win('Enter')).toBeNull();
    expect(win(' ')).toBeNull();
  });

  it('ignores non-keyDown events, key repeats of the wrong kind and IME input', () => {
    expect(commandForInput({ type: 'keyUp', key: 't', control: true }, 'win32')).toBeNull();
    expect(commandForInput({ type: 'char', key: 't', control: true }, 'win32')).toBeNull();
    expect(win('t', { ctrl: true }, { isComposing: true })).toBeNull();
    expect(commandForInput(null, 'win32')).toBeNull();
    expect(commandForInput({ type: 'keyDown' }, 'win32')).toBeNull();
  });

  it('ignores combinations a site owns', () => {
    expect(win('a', { ctrl: true })).toBeNull(); // select all
    expect(win('c', { ctrl: true })).toBeNull(); // copy
    expect(win('v', { ctrl: true })).toBeNull(); // paste
    expect(win('i', { ctrl: true, shift: true })).toBeNull(); // devtools
    expect(win('t', { ctrl: true, alt: true })).toBeNull(); // macOS-style new tab
    expect(win('k', { ctrl: true })).toBeNull(); // omnibox habit, the site may use it
    expect(win('F5', { ctrl: true })).toBeNull(); // deliberately not "reload hard"
  });

  it('does not invent commands for modified Shift variants', () => {
    expect(win('m', { ctrl: true, shift: true })).toBeNull();
    expect(win('f', { ctrl: true, shift: true })).toBeNull();
    expect(win('b', { ctrl: true, shift: true })).toBeNull();
    expect(win('w', { ctrl: true, shift: true })).toBeNull();
  });
});

describe('isAppCommand', () => {
  it('accepts every advertised command', () => {
    for (const command of APP_COMMANDS) expect(isAppCommand(command)).toBe(true);
    expect(isAppCommand('select-tab:4')).toBe(true);
  });

  it('rejects anything else, including injection-shaped values', () => {
    for (const value of ['', 'delete-everything', 'select-tab:0', 'select-tab:10', 'select-tab:', null, 42, {}]) {
      expect(isAppCommand(value)).toBe(false);
    }
  });

  it('produces only commands it would accept', () => {
    const samples = [
      win('t', { ctrl: true }),
      win('Tab', { ctrl: true, shift: true }),
      win('9', { ctrl: true }),
      win('F1'),
      mac('f', { meta: true })
    ].filter(Boolean);
    for (const command of samples) expect(isAppCommand(command)).toBe(true);
  });
});
