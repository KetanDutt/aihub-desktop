/**
 * Template + path helpers for service adapters (pure).
 *
 * Adapter bodies in `data/adapters.json` are ordinary JSON with `{placeholder}`
 * holes. Substitution happens on the *parsed* object rather than the raw text,
 * so a prompt containing quotes, braces or `"` can never break out of a JSON
 * string — there is nothing to escape.
 */

/** Placeholder syntax: `{name}` alone in a string, or embedded in one. */
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_.]*)\}/g;

/** Read `messages.0.content.parts.0` (and `messages.-1` from the end). */
function getPath(source, path) {
  if (typeof path !== 'string' || path === '') return undefined;
  let current = source;
  for (const raw of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    let key = raw;
    if (Array.isArray(current) && /^\[-?\d+\]$/.test(key)) key = key.slice(1, -1);
    const index = Number(key);
    if (Array.isArray(current) && Number.isInteger(index)) {
      const resolved = index < 0 ? current.length + index : index;
      current = current[resolved];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/** Write `a.b.0.c`, creating objects/arrays as needed. Returns the root. */
function setPath(root, path, value) {
  const parts = String(path).split('.').filter(Boolean);
  if (parts.length === 0) return root;
  let current = root;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (current[key] === undefined || current[key] === null) current[key] = nextIsIndex ? [] : {};
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
  return root;
}

function hasPlaceholders(text) {
  return typeof text === 'string' && PLACEHOLDER.test(text) && (PLACEHOLDER.lastIndex = 0, true);
}

/**
 * Substitute `{key}` holes in a header/body template.
 *
 * @param {*} node parsed JSON (object/array/string/number)
 * @param {Record<string, *>} context values keyed by placeholder name
 * @returns {*} the rendered structure
 */
function renderTemplate(node, context = {}) {
  if (typeof node === 'string') {
    const whole = node.match(/^\{([a-zA-Z][a-zA-Z0-9_.]*)\}$/);
    if (whole) {
      const value = context[whole[1]];
      // A lone placeholder keeps the value's type (numbers stay numbers,
      // `null` stays null) — services validate those shapes strictly.
      return value === undefined ? null : value;
    }
    return node.replace(PLACEHOLDER, (match, key) => {
      const value = context[key];
      if (value === undefined || value === null) return '';
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }

  if (Array.isArray(node)) return node.map((entry) => renderTemplate(entry, context));

  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) out[renderTemplate(key, context)] = renderTemplate(value, context);
    return out;
  }

  return node;
}

/**
 * Collapse an OpenAI `messages` array into what a chat UI wants: one prompt
 * plus an optional system preamble. Multi-turn context is preserved by
 * rendering the earlier turns ahead of the newest user message, which is the
 * only thing a browser-based assistant can actually consume.
 *
 * @param {Array<{role: string, content: string|Array}>} messages
 * @param {{maxChars?: number, includeHistory?: boolean}} [options]
 */
function flattenMessages(messages, { maxChars = 32 * 1024, includeHistory = true } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const system = [];
  const turns = [];

  for (const message of list) {
    if (!message || typeof message !== 'object') continue;
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : 'user';
    const text = contentToText(message.content);
    if (!text) continue;
    if (role === 'system' || role === 'developer') system.push(text);
    else turns.push({ role, text });
  }

  const last = turns.length > 0 ? turns[turns.length - 1] : { role: 'user', text: '' };
  const history = includeHistory ? turns.slice(0, -1) : [];

  let prompt = last.text;
  if (history.length > 0) {
    const rendered = history
      .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.text}`)
      .join('\n\n');
    prompt = `Earlier in this conversation:\n${rendered}\n\nUser: ${last.text}`;
  }

  if (prompt.length > maxChars) prompt = prompt.slice(prompt.length - maxChars);

  return {
    prompt,
    system: system.join('\n\n'),
    historyTurns: history.length,
    role: last.role
  };
}

/** OpenAI content may be a string or a list of `{type:'text', text}` parts. */
function contentToText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text.trim();
  return '';
}

module.exports = {
  PLACEHOLDER,
  getPath,
  setPath,
  hasPlaceholders,
  renderTemplate,
  flattenMessages,
  contentToText
};
