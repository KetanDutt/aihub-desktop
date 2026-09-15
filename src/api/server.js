/**
 * The local HTTP surface: an OpenAI-compatible façade over the app's logged-in
 * sessions.
 *
 *   GET  /health                  liveness (no auth, no secrets)
 *   GET  /v1/models              models = the services you are signed into
 *   POST /v1/chat/completions    streaming (SSE) + buffered
 *   POST /v1/completions         legacy `prompt` shim
 *   GET  /v1/aihub/sessions      login/cookie status per service (extension)
 *
 * Deliberate hardening, because "a local port anyone on the machine can hit" is
 * a real attack surface:
 *  - loopback bind only; a non-loopback `Host` header is rejected (DNS
 *    rebinding defence) and so is any browser `Origin` (CSRF defence) —
 *    CLI/tooling clients send neither;
 *  - a bearer token compared in constant time, generated in the main process
 *    and never written by the renderer;
 *  - body size, message count, timeout, concurrency and rate limits;
 *  - no `Access-Control-Allow-Origin`, ever.
 *
 * No Electron here: the server receives its behaviour through `deps`, so it can
 * be exercised against a real socket in tests.
 */

const http = require('http');
const crypto = require('crypto');

const { API } = require('../constants');
const openai = require('./openai');
const contentClassifier = require('./content');

const MAX_BODY_BYTES = API.MAX_BODY_BYTES;

/** Loopback hosts we are willing to bind to. */
function isLoopbackHost(host) {
  return API.LOOPBACK_HOSTS.includes(String(host).toLowerCase());
}

function hostHeaderIsLoopback(header) {
  const value = String(header || '').toLowerCase();
  if (!value) return false;
  const host = value.replace(/^\[[0-9a-f:]+\]$/, '::1').split(':')[0];
  return API.LOOPBACK_HOSTS.includes(host);
}

/** `aihub-<40 hex>` — readable enough to paste, long enough to not guess. */
function generateToken() {
  return `aihub-${crypto.randomBytes(20).toString('hex')}`;
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function bearerOf(req) {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.trim().toLowerCase().startsWith('bearer ')) {
    return header.trim().slice(7).trim();
  }
  const alt = req.headers['x-api-key'];
  if (typeof alt === 'string') return alt.trim();
  return '';
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
}

function sendError(res, status, error, headers) {
  sendJson(res, status, error, headers);
  if (status === 413 && res.req) res.req.destroy();
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        // Pause rather than destroy: an ECONNRESET tells the client nothing,
        // while a real 413 does. The socket is dropped after the response ends.
        req.pause();
        reject(Object.assign(new Error(`Request body exceeds ${limit} bytes`), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function openEventStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write(': ok\n\n');
}

/**
 * @param {{
 *   authenticate?: (token: string) => boolean,
 *   listModels?: () => object[],
 *   listSessions?: () => object,
 *   complete?: (request: object, stream: object) => Promise<object>,
 *   onEvent?: (entry: object) => void,
 *   concurrency?: number,
 *   rateLimitPerMinute?: number,
 *   defaultTimeoutSeconds?: number,
 *   version?: string
 * }} deps
 */
function createApiServer(deps = {}) {
  const {
    authenticate = () => false,
    listModels = () => [],
    listSessions = () => ({}),
    complete = async () => {
      throw new Error('no engine wired');
    },
    onEvent = () => {},
    defaultTimeoutSeconds = API.DEFAULT_TIMEOUT_SECONDS,
    version = '0.0.0'
  } = deps;

  const queueMod = require('./queue');
  const concurrency = deps.concurrency || API.DEFAULT_CONCURRENCY;
  const queue =
    deps.queue ||
    // A browser-driven request is slow and heavy, so the backlog stays short:
    // past that, a 503 is more honest than a request that times out in a queue.
    queueMod.createQueue({ concurrency, maxQueued: Math.max(2, concurrency * 4) });
  const limiter =
    deps.limiter || queueMod.createRateLimiter({ limit: deps.rateLimitPerMinute || API.DEFAULT_RATE_LIMIT_PER_MINUTE });

  /** Ring buffer of the most recent requests, for Settings > Local API. */
  const log_ = [];
  const logLimit = API.REQUEST_LOG_ENTRIES;
  const counters = { requests: 0, completed: 0, failed: 0, cancelled: 0, bytes: 0, streaming: 0 };

  function record(entry) {
    const stamped = { ...entry, at: new Date().toISOString() };
    log_.push(stamped);
    if (log_.length > logLimit) log_.shift();
    try {
      onEvent(stamped);
    } catch (e) {
      /* logging must never break the request */
    }
    return stamped;
  }

  async function handleChat(req, res, { stream, body }) {
    const started = Date.now();
    counters.requests += 1;

    let parsed;
    try {
      parsed = body.trim() ? JSON.parse(body) : {};
    } catch (e) {
      counters.failed += 1;
      sendError(res, 400, openai.errorOf('Body is not valid JSON'));
      return;
    }

    if (req.url && req.url.endsWith('/v1/completions')) {
      const translated = openai.completionsToChatBody(parsed);
      if (!translated) {
        counters.failed += 1;
        sendError(res, 400, openai.errorOf('`prompt` is required', 'invalid_request_error', { param: 'prompt' }));
        return;
      }
      parsed = translated;
    }

    const normalised = openai.normalizeChatRequest(parsed);
    if (!normalised.ok) {
      counters.failed += 1;
      record({ route: req.url, model: parsed && parsed.model, status: 400, ms: Date.now() - started });
      sendError(res, 400, normalised.error);
      return;
    }

    const request = { ...normalised.request, timeoutSeconds: normalised.request.timeoutSeconds || defaultTimeoutSeconds };

    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort();
        counters.cancelled += 1;
      }
    };
    res.on('close', () => {
      if (!res.writableEnded) abort();
    });

    let released = false;
    const run = async (taskSignal) => {
      // The queue's own signal is what the engine watches: it fires both on a
      // client hang-up and on a queue timeout.
      const watch = taskSignal || controller.signal;
      if (stream) {
        openEventStream(res);
        counters.streaming += 1;
        res.write(openai.sseFrame(openai.firstChunk(request)));
      }

      // Classify as the answer arrives: reasoning goes to `reasoning_content`,
      // and every segment boundary is announced so a client can render code,
      // links and tables while the text is still streaming.
      const segmenter = contentClassifier.createStreamSegmenter();

      const result = await complete(request, {
        signal: watch,
        stream,
        onDelta: (text) => {
          if (!stream || !res.writable || !text) return;
          const info = segmenter.push(text);
          for (const event of info.events) {
            res.write(
              openai.sseFrame(
                openai.deltaChunk({
                  ...request,
                  text: '',
                  segment: event.segment,
                  extra: { segmentEvent: event.kind }
                })
              )
            );
          }
          res.write(
            openai.sseFrame(
              openai.deltaChunk({
                ...request,
                text,
                reasoning: info.type === contentClassifier.SEGMENT_TYPES.THINKING,
                segment: { type: info.type, index: info.index }
              })
            )
          );
        },
        onMeta: (meta) => {
          if (!stream || !res.writable) return;
          res.write(openai.sseFrame({ ...request, object: 'chat.completion.chunk', aihub: meta }));
        }
      });

      const usage = result.usage || openai.usageFrom(request.messages.map((m) => m.content).join('\n'), result.text);
      // Some engines only hand back a finished answer (no deltas), so the
      // segmenter may be empty: classify the result itself in that case.
      const analysis =
        segmenter.text && segmenter.text.length >= (result.text || '').length
          ? segmenter.finish()
          : contentClassifier.analyzeContent(result.text);
      const aihub = {
        service: result.service || request.serviceId,
        upstreamModel: result.upstreamModel || null,
        strategy: result.strategy || null,
        ...(result.conversationId ? { conversationId: result.conversationId } : {}),
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
      };

      if (stream) {
        res.write(
          openai.sseFrame(
            openai.finalChunk({ ...request, finishReason: result.finishReason || 'stop', usage, aihub })
          )
        );
        res.write(openai.SSE_DONE);
        res.end();
      } else {
        const completion = openai.buildCompletion({
          id: request.id,
          model: request.model,
          created: request.created,
          text: result.text,
          usage,
          finishReason: result.finishReason || 'stop'
        });
        sendJson(res, 200, {
          ...completion,
          aihub: { ...(completion.aihub || {}), ...aihub },
          ...(result.conversationId ? { conversation_id: result.conversationId } : {})
        });
      }

      counters.completed += 1;
      released = true;
      record({
        route: req.url,
        model: request.model,
        serviceId: request.serviceId,
        stream: Boolean(stream),
        status: 200,
        ms: Date.now() - started,
        chars: (result.text || '').length
      });
    };

    try {
      await queue.run((taskSignal) => run(taskSignal), {
        timeoutMs: (request.timeoutSeconds + 30) * 1000,
        signal: controller.signal
      });
    } catch (error) {
      if (released) return;
      const cancelled = error && (error.code === 'cancelled' || error.name === 'AbortError' || controller.signal.aborted);
      const overloaded = error instanceof queueMod.QueueFullError;

      if (cancelled) counters.cancelled += 1;
      else counters.failed += 1;

      const status = cancelled ? 499 : overloaded ? 503 : error && error.status === 401 ? 401 : 502;
      const payload = cancelled
        ? openai.ERRORS.cancelled()
        : overloaded
          ? openai.ERRORS.overloaded(String(error.message))
          : error && error.openaiError
            ? error.openaiError
            : openai.ERRORS.upstream(String((error && error.message) || 'upstream failure'));

      record({
        route: req.url,
        model: request.model,
        serviceId: request.serviceId,
        stream: Boolean(stream),
        status,
        ms: Date.now() - started,
        error: String((error && error.message) || '')
      });

      if (stream && res.headersSent) {
        res.write(openai.sseFrame(payload));
        res.write(openai.SSE_DONE);
        res.end();
        return;
      }
      sendError(res, status, payload);
    } finally {
      if (!controller.signal.aborted) controller.abort();
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = String(req.url || '/');
    const path = url.split('?')[0];

    if (!hostHeaderIsLoopback(req.headers.host)) {
      sendError(res, 403, openai.errorOf('This endpoint only answers loopback requests', 'invalid_request_error', { code: 'bad_host' }));
      return;
    }

    const origin = req.headers.origin;
    if (origin && !/^(null|file:)$/.test(String(origin))) {
      sendError(res, 403, openai.errorOf('Cross-origin requests are not accepted', 'invalid_request_error', { code: 'bad_origin' }));
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(405, { allow: 'GET, POST' });
      res.end();
      return;
    }

    if (path === '/health' || path === '/' ) {
      sendJson(res, 200, {
        ok: true,
        name: 'AI Hub Desktop',
        version,
        endpoint: 'openai-compatible',
        auth: 'bearer'
      });
      return;
    }

    const expected = deps.getToken ? deps.getToken() : '';
    if (!expected) {
      sendError(res, 503, openai.ERRORS.serviceUnavailable('The local API has no key; enable it in Settings > Local API'));
      return;
    }
    if (!authenticate(bearerOf(req))) {
      // Slow down brute forcing; the port is loopback-only, so a small delay is
      // enough and keeps the failure cheap.
      const timer = setTimeout(() => sendError(res, 401, openai.ERRORS.unauthorized()), API.AUTH_FAILURE_DELAY_MS);
      req.once('close', () => clearTimeout(timer));
      return;
    }

    const rate = limiter.tryAcquire('local');
    if (!rate.allowed) {
      sendError(res, 429, openai.ERRORS.tooManyRequests(`Retry in ${Math.ceil(rate.retryAfterMs / 1000)}s`), {
        'retry-after': String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000)))
      });
      return;
    }

    if (path === '/v1/models' && req.method === 'GET') {
      const models = listModels() || [];
      sendJson(res, 200, { object: 'list', data: models });
      return;
    }

    if (path === '/v1/aihub/sessions' && req.method === 'GET') {
      sendJson(res, 200, { object: 'aihub.sessions', sessions: listSessions() || {} });
      return;
    }

    if (path === '/v1/aihub/status' && req.method === 'GET') {
      sendJson(res, 200, { object: 'aihub.status', ...serverStats() });
      return;
    }

    if ((path === '/v1/chat/completions' || path === '/v1/completions') && req.method === 'POST') {
      // Read the body once: `stream` decides the response shape *before* the
      // request runs, so it has to be known up front.
      let raw = '';
      try {
        raw = await readBody(req);
      } catch (error) {
        counters.requests += 1;
        counters.failed += 1;
        sendError(res, error.status || 400, openai.errorOf(error.message));
        return;
      }

      let wantsStream = false;
      try {
        const peek = raw.trim() ? JSON.parse(raw) : {};
        wantsStream = peek.stream === true || peek.stream === 'true';
      } catch (e) {
        /* the handler reports the parse failure with the right status */
      }

      await handleChat(req, res, { stream: wantsStream, body: raw });
      return;
    }

    sendError(res, 404, openai.ERRORS.notFound(`Unknown endpoint ${req.method} ${path}`));
  });

  function serverStats() {
    return {
      listening: Boolean(server.listening),
      address: server.address() || null,
      counters: { ...counters },
      queue: queue.stats(),
      recent: log_.slice(-10).reverse()
    };
  }

  return {
    server,
    stats: serverStats,
    log: () => [...log_],
    resetLog: () => {
      log_.length = 0;
    },
    queue,
    limiter,
    listen(port, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          const address = server.address();
          resolve({ port: address ? address.port : port, host, url: `http://${host}:${address ? address.port : port}/v1` });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ port, host, exclusive: true });
      });
    },
    stop() {
      return new Promise((resolve) => {
        server.closeIdleConnections?.();
        server.close(() => resolve(true));
        // Never let a lingering keep-alive block shutdown.
        const timer = setTimeout(() => {
          server.closeAllConnections?.();
          resolve(true);
        }, 1500);
        if (typeof timer.unref === 'function') timer.unref();
      });
    }
  };
}

module.exports = {
  createApiServer,
  generateToken,
  timingSafeEqualText,
  bearerOf,
  isLoopbackHost,
  hostHeaderIsLoopback,
  MAX_BODY_BYTES
};
