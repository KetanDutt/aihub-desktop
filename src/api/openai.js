/**
 * OpenAI wire format (pure).
 *
 * Validation, response shaping and SSE framing for the local endpoint, so the
 * server itself stays a thin transport and every rule here is unit testable:
 *
 *   POST /v1/chat/completions   streaming + buffered
 *   POST /v1/completions        legacy `prompt`
 *   GET  /v1/models
 */

const { API } = require('../constants');
const { clampNumber, clampFloat, truncate } = require('../utils');
const { contentToText, getPath } = require('./template');
const contentClassifier = require('./content');

const CHATML_ROLES = ['system', 'developer', 'user', 'assistant', 'tool', 'function'];
const ID_PREFIX = 'chatcmpl-aihub';

let counter = 0;

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------
//
// `aihub/<service>` is always a valid model id, but a client should also be able
// to ask for `gemini-2.5-flash` or `gpt-5` directly. The catalogue publishes
// every id it can serve (`GET /v1/models`) and this map — rebuilt on each
// catalogue read — turns a bare upstream name back into a service id.
const modelRegistry = new Map();

/**
 * Register the ids the catalogue can serve.
 * @param {Array<{id: string, aihub?: {service?: string, upstreamModel?: string, aliases?: string[]}}>} entries
 */
function registerModelIds(entries) {
  if (!Array.isArray(entries)) return modelRegistry.size;

  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    const service = entry.aihub && entry.aihub.service;
    if (!service) continue;
    // Ids are published as `aihub/<service>[:<model>]`; route on the tail too.
    const raw = entry.id.toLowerCase();
    const keys = [raw, raw.startsWith(API.MODEL_PREFIX) ? raw.slice(API.MODEL_PREFIX.length) : raw];
    const upstream = entry.aihub.upstreamModel ? String(entry.aihub.upstreamModel).toLowerCase() : '';
    if (upstream && upstream !== 'default') keys.push(upstream);
    for (const alias of Array.isArray(entry.aihub.aliases) ? entry.aihub.aliases : []) {
      if (typeof alias === 'string' && alias) keys.push(alias.toLowerCase());
    }
    for (const key of keys) {
      // First writer wins: a name claimed by two services routes to the one
      // listed first, which keeps routing deterministic instead of random.
      if (key && !modelRegistry.has(key)) modelRegistry.set(key, service);
    }
  }

  return modelRegistry.size;
}

/** Forget every registered id (used by tests and on adapter reload). */
function clearModelRegistry() {
  modelRegistry.clear();
}

function nextId(seed = Date.now()) {
  counter = (counter + 1) % 100000;
  return `${ID_PREFIX}-${seed.toString(36)}${counter.toString(36)}`;
}

/**
 * `aihub/chatgpt`, `chatgpt`, `chatgpt:gpt-5` -> `chatgpt`, and a bare upstream
 * name the catalogue published (`gpt-5`) -> `chatgpt`.
 */
function serviceIdFromModel(model) {
  if (typeof model !== 'string') return '';
  let id = model.trim().toLowerCase();
  if (id.startsWith(API.MODEL_PREFIX)) id = id.slice(API.MODEL_PREFIX.length);
  if (modelRegistry.has(id)) return modelRegistry.get(id);
  const colon = id.indexOf(':');
  if (colon > -1) {
    const tail = id.slice(colon + 1);
    if (modelRegistry.has(tail)) return modelRegistry.get(tail);
    id = id.slice(0, colon);
  }
  if (modelRegistry.has(id)) return modelRegistry.get(id);
  return id.replace(/[^a-z0-9_-]/g, '');
}

function modelIdFor(serviceId) {
  return `${API.MODEL_PREFIX}${serviceId}`;
}

/** Cheap, deterministic token estimate (~4 chars per token). */
function estimateTokens(text) {
  if (typeof text !== 'string' || !text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(Math.max(text.length / 4, words * 1.35)));
}

function usageFrom(promptText, completionText) {
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(completionText);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  };
}

function errorOf(message, type = 'invalid_request_error', options = {}) {
  return {
    error: {
      message: truncate(String(message), 500),
      type,
      param: options.param || null,
      code: options.code || null
    }
  };
}

const ERRORS = {
  unauthorized: (msg = 'Missing or invalid API key') => errorOf(msg, 'authentication_error', { code: 'invalid_api_key' }),
  notFound: (msg = 'Unknown endpoint') => errorOf(msg, 'invalid_request_error', { code: '404' }),
  tooManyRequests: (msg = 'Rate limit exceeded') =>
    errorOf(msg, 'rate_limit_error', { code: 'rate_limit_exceeded' }),
  overloaded: (msg = 'The local queue is full') => errorOf(msg, 'server_error', { code: 'overloaded' }),
  timeout: (msg = 'The service did not answer in time') => errorOf(msg, 'timeout_error', { code: 'timeout' }),
  serviceUnavailable: (msg = 'No logged-in session available') =>
    errorOf(msg, 'service_unavailable', { code: 'session_unavailable' }),
  upstream: (msg = 'The service returned an error') => errorOf(msg, 'api_error', { code: 'upstream_error' }),
  cancelled: (msg = 'Request cancelled') => errorOf(msg, 'user_cancelled', { code: 'cancelled' })
};

/**
 * Validate a `/v1/chat/completions` body.
 *
 * @param {unknown} body
 * @returns {{ok: true, request: object} | {ok: false, error: object}}
 */
function normalizeChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: errorOf('Request body must be a JSON object') };
  }

  const serviceId = serviceIdFromModel(body.model);
  if (!serviceId) return { ok: false, error: errorOf('`model` is required', 'invalid_request_error', { param: 'model' }) };

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, error: errorOf('`messages` must be a non-empty array', 'invalid_request_error', { param: 'messages' }) };
  }
  if (body.messages.length > API.MAX_MESSAGES) {
    return {
      ok: false,
      error: errorOf(`\`messages\` may hold at most ${API.MAX_MESSAGES} entries`, 'invalid_request_error', { param: 'messages' })
    };
  }

  const messages = [];
  for (const raw of body.messages) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: errorOf('Every message must be an object', 'invalid_request_error', { param: 'messages' }) };
    }
    const role = typeof raw.role === 'string' ? raw.role.toLowerCase() : '';
    if (!CHATML_ROLES.includes(role)) {
      return {
        ok: false,
        error: errorOf(`Unsupported role "${String(raw.role).slice(0, 32)}"`, 'invalid_request_error', { param: 'messages[].role' })
      };
    }
    const content = contentToText(raw.content);
    if (content.length > API.MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        error: errorOf(`Message content exceeds ${API.MAX_MESSAGE_CHARS} characters`, 'invalid_request_error', { param: 'messages[].content' })
      };
    }
    messages.push({ role, content });
  }

  if (!messages.some((message) => message.role === 'user' || message.role === 'tool' || message.role === 'function')) {
    return { ok: false, error: errorOf('At least one `user` message is required', 'invalid_request_error', { param: 'messages' }) };
  }

  const stream = body.stream === true || body.stream === 'true';
  // Fractional, clamped: `temperature: 99` must become 2.0, not 0.99.
  const temperature = clampFloat(body.temperature, 0, 2, 1, 2);
  const topP = body.top_p === undefined || body.top_p === null ? null : clampFloat(body.top_p, 0, 1, 1, 2);
  const maxTokens = Number.isFinite(Number(body.max_tokens)) ? clampNumber(body.max_tokens, 1, 200000, 4096) : null;
  const timeoutSeconds = clampNumber(
    body.timeout_seconds ?? body.timeout,
    API.MIN_TIMEOUT_SECONDS,
    API.MAX_TIMEOUT_SECONDS,
    API.DEFAULT_TIMEOUT_SECONDS
  );

  return {
    ok: true,
    request: {
      id: nextId(),
      serviceId,
      model: typeof body.model === 'string' ? body.model.trim() : modelIdFor(serviceId),
      messages,
      stream,
      temperature,
      maxTokens,
      topP,
      stop: Array.isArray(body.stop)
        ? body.stop.filter((entry) => typeof entry === 'string').slice(0, 4)
        : typeof body.stop === 'string'
          ? [body.stop]
          : [],
      user: typeof body.user === 'string' ? truncate(body.user, 128) : null,
      conversationId:
        typeof body.conversation_id === 'string' ? truncate(body.conversation_id, 128) : null,
      includeHistory: body.history !== false,
      strategy: body.strategy === 'dom' || body.strategy === 'api' ? body.strategy : 'auto',
      timeoutSeconds,
      created: Math.floor(Date.now() / 1000)
    }
  };
}

/** `prompt` (string | string[]) instead of messages, for /v1/completions. */
function completionsToChatBody(body) {
  if (!body || typeof body !== 'object') return null;
  const prompt = Array.isArray(body.prompt) ? body.prompt.join('\n') : body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  return {
    model: body.model,
    messages: [{ role: 'user', content: prompt }],
    stream: body.stream === true,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    stop: body.stop,
    user: body.user,
    history: false
  };
}

/**
 * Split an answer into typed parts and build the assistant message.
 *
 * `content` stays the whole answer (that is what OpenAI clients expect); the
 * typed view rides along in `aihub.content` and the reasoning is mirrored to
 * `reasoning_content`, the field reasoning UIs already look for.
 */
function buildAssistantMessage(text) {
  const body = typeof text === 'string' ? text : String(text ?? '');
  const analysis = contentClassifier.analyzeContent(body);
  const message = { role: 'assistant', content: body };
  if (analysis.thinking) message.reasoning_content = analysis.thinking;
  return { message, analysis };
}

/** A `chat.completion` object. */
function buildCompletion({ id, model, text, usage, finishReason = 'stop', created, systemFingerprint }) {
  const content = typeof text === 'string' ? text : String(text ?? '');
  const { message, analysis } = buildAssistantMessage(content);
  return {
    id: id || nextId(),
    object: 'chat.completion',
    created: created || Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        logprobs: null,
        finish_reason: finishReason
      }
    ],
    usage: usage || usageFrom(content, content),
    // Extensions: what the answer is made of, for clients that care.
    aihub: {
      content: {
        segments: analysis.segments,
        types: analysis.types,
        links: analysis.links,
        code: analysis.code.map((block) => ({ language: block.language, chars: block.text.length })),
        thinking: analysis.thinking || null,
        hasThinking: analysis.hasThinking,
        hasCode: analysis.hasCode,
        hasLinks: analysis.hasLinks
      }
    },
    ...(systemFingerprint ? { system_fingerprint: systemFingerprint } : {})
  };
}

/** One `chat.completion.chunk` frame. */
function buildChunk({ id, model, created, delta, finishReason = null, usage = null, aihub = null }) {
  const chunk = {
    id: id || nextId(),
    object: 'chat.completion.chunk',
    created: created || Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: delta || {}, logprobs: null, finish_reason: finishReason }]
  };
  if (usage) chunk.usage = usage;
  if (aihub) chunk.aihub = aihub;
  return chunk;
}

function firstChunk({ id, model, created }) {
  return buildChunk({ id, model, created, delta: { role: 'assistant', content: '' } });
}

/**
 * One streamed delta.
 *
 * `reasoning` sends the text to `reasoning_content` instead of `content` (it is
 * the model thinking out loud, not the answer); `segment` tells the client which
 * kind of block the delta landed in, so code, links and reasoning can be
 * rendered as they arrive rather than after the fact.
 */
function deltaChunk({ id, model, created, text, reasoning = false, segment = null, extra = null }) {
  const delta = reasoning ? { reasoning_content: text } : { content: text };
  return buildChunk({
    id,
    model,
    created,
    delta,
    ...(segment || extra ? { aihub: { ...(segment ? { segment } : {}), ...(extra || {}) } } : {})
  });
}

function finalChunk({ id, model, created, finishReason = 'stop', usage, aihub = null }) {
  return buildChunk({ id, model, created, delta: {}, finishReason, usage, aihub });
}

/** `data: {...}\n\n` — SSE with no `event:` field, like OpenAI. */
function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const SSE_DONE = 'data: [DONE]\n\n';

/**
 * Incremental `text/event-stream` reader.
 *
 * Accepts raw chunks and yields the decoded `data:` payloads. Ignores comments
 * (`:`) and unknown fields; tolerates `\r\n`, split frames and a payload that
 * never ends with a blank line (some services close the socket instead).
 */
function createSseParser() {
  let buffer = '';

  return {
    push(chunk) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      // Servers may frame with CRLF; normalise so one delimiter rule holds.
      buffer += text.replace(/\r\n/g, '\n');
      const events = [];
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const rawEvent = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = rawEvent
          .split('\n')
          .map((line) => line.replace(/\r$/, ''))
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (data) events.push(data);
        index = buffer.indexOf('\n\n');
      }
      return events;
    },
    end() {
      const rest = buffer.trim();
      buffer = '';
      if (!rest) return [];
      const data = rest
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      return data ? [data] : [];
    }
  };
}

/**
 * Pull one delta out of a service frame.
 *
 * @param {string|object} payload decoded `data:` payload
 * @param {string} deltaPath e.g. `messages.0.content.parts.0`
 * @returns {{text: string, done: boolean, error?: string}}
 */
function extractDelta(payload, deltaPath) {
  let parsed = payload;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === '[DONE]') return { text: '', done: true };
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      // Some services emit raw text deltas.
      return { text: trimmed, done: false };
    }
  }
  if (parsed && typeof parsed === 'object' && parsed.done === true) return { text: '', done: true };

  const candidates = [deltaPath, 'delta.content', 'choices.0.delta.content', 'completion'].filter(Boolean);

  for (const candidate of candidates) {
    const value = getPath(parsed, candidate);
    if (typeof value === 'string' && value.length > 0) {
      const error = deltaPath ? null : getPath(parsed, 'error');
      return { text: value, done: false, error: error ? String(error.message || error) : undefined };
    }
    if (Array.isArray(value) && value.length > 0) {
      const last = value[value.length - 1];
      if (typeof last === 'string') return { text: last, done: false };
    }
  }

  const message = getPath(parsed, 'error.message') || getPath(parsed, 'detail');
  return { text: '', done: false, error: message ? String(message) : undefined };
}

/** Full-text extraction for services that answer with one JSON blob. */
function extractResult(payload, resultPath) {
  let parsed = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch (e) {
      return { text: payload.trim(), done: true };
    }
  }
  const paths = [resultPath, 'choices.0.message.content', 'message.content', 'completion', 'response'].filter(Boolean);
  for (const candidate of paths) {
    const value = getPath(parsed, candidate);
    if (typeof value === 'string' && value.trim()) return { text: value.trim(), done: true };
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      return { text: value.join('\n'), done: true };
    }
  }
  return { text: '', done: true };
}

module.exports = {
  CHATML_ROLES,
  ERRORS,
  errorOf,
  normalizeChatRequest,
  completionsToChatBody,
  buildCompletion,
  buildAssistantMessage,
  buildChunk,
  firstChunk,
  deltaChunk,
  finalChunk,
  registerModelIds,
  clearModelRegistry,
  sseFrame,
  SSE_DONE,
  createSseParser,
  extractDelta,
  extractResult,
  estimateTokens,
  usageFrom,
  serviceIdFromModel,
  modelIdFor,
  nextId
};
