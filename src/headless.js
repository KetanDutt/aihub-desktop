/**
 * Headless mode: run the local API server *without* the desktop shell.
 *
 *   npm run serve          # or: electron . --headless
 *   RUN-SERVER.bat         # Windows, one click
 *
 * Everything the endpoint needs (sessions, cookies, hidden browser windows for
 * the DOM driver) lives in the main process, so headless mode simply skips the
 * window, the tray and the updater and keeps the loopback server up. Useful for
 * a machine you only reach over SSH, for a CI box, or when you want the
 * OpenAI-compatible endpoint without a UI on screen.
 *
 * Terminal output is the whole interface here: the base URL, the key, what is
 * callable right now and how to stop it.
 */

const HEADLESS_FLAGS = ['--headless', '--api-only', '--server', '--no-gui'];
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

/**
 * Should this process run headless?
 *
 * @param {string[]} [argv]
 * @param {object} [env]
 * @returns {boolean}
 */
function isHeadless(argv = process.argv, env = process.env) {
  if (TRUE_VALUES.has(String(env.AIHUB_HEADLESS || '').trim().toLowerCase())) return true;
  if (!Array.isArray(argv)) return false;
  return argv.some((arg) => typeof arg === 'string' && HEADLESS_FLAGS.includes(arg.trim().toLowerCase()));
}

/**
 * Extra switches understood in headless mode.
 *
 * @param {string[]} [argv]
 * @returns {{port: number|null, printKey: boolean, quiet: boolean}}
 */
function options(argv = process.argv) {
  const list = Array.isArray(argv) ? argv : [];
  const out = { port: null, printKey: false, quiet: false };

  for (let i = 0; i < list.length; i += 1) {
    const arg = String(list[i] || '').trim();
    const inline = arg.match(/^--(?:api-)?port=(\d{1,5})$/);
    if (inline) {
      out.port = Number(inline[1]);
      continue;
    }
    if (arg === '--port' || arg === '--api-port') {
      const next = Number(list[i + 1]);
      if (Number.isFinite(next)) {
        out.port = next;
        i += 1;
      }
      continue;
    }
    if (arg === '--print-key') out.printKey = true;
    if (arg === '--quiet' || arg === '--silent') out.quiet = true;
  }

  return out;
}

/** The one-screen summary printed when the server comes up. */
function banner(status, { printKey = false, version = '' } = {}) {
  const models = Array.isArray(status.models) ? status.models : [];
  const ready = models.filter((model) => model.ready);
  const free = models.filter((model) => model.requiresLogin === false);
  // The key is printed in the clear only when asked for; the masked form is
  // enough to confirm *which* key is live.
  const shown = printKey ? status.key || '(none)' : '<key>';

  const lines = [
    '',
    '============================================================',
    ` AI Hub Desktop ${version ? `v${version} ` : ''}— API server (headless)`,
    '============================================================',
    '',
    ` Base URL   ${status.baseUrl}`,
    ` Key        ${printKey ? status.key || '(none)' : status.keyMasked || '(none)'}`,
    ` Listening  ${status.listening ? `yes (127.0.0.1:${status.port})` : 'no'}`,
    ` Models     ${models.length} (${ready.length} ready, ${free.length} need no sign-in)`,
    status.lastError ? ` Last error ${status.lastError}` : null,
    '',
    ' Try it:',
    `   curl ${status.baseUrl}/models -H "Authorization: Bearer ${shown}"`,
    `   curl ${status.baseUrl}/chat/completions -H "Authorization: Bearer ${shown}" \\`,
    '     -H "Content-Type: application/json" \\',
    `     -d '{"model":"${(models[0] && models[0].id) || 'aihub/chatgpt'}","messages":[{"role":"user","content":"hi"}]}'`,
    '',
    printKey ? null : ' Add --print-key to echo the key; it is always in Settings > Local API.',
    ' Press Ctrl+C to stop the server.',
    ''
  ].filter((line) => line !== null);

  return lines.join('\n');
}

module.exports = {
  HEADLESS_FLAGS,
  isHeadless,
  options,
  banner
};
