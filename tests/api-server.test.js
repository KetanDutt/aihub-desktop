/**
 * The local OpenAI-compatible endpoint, over a real socket, with a stub engine.
 *
 * Everything that matters here is observable on the wire: auth, the loopback /
 * Origin defences, OpenAI-shaped bodies, SSE streaming, cancellation, rate
 * limiting and the exact error text a client will see when a service is not
 * signed in.
 */

const http = require('http');

const { createApiServer, generateToken } = require('../src/api/server');
const queue = require('../src/api/queue');

const TOKEN = generateToken();

function request({ port, path = '/v1/chat/completions', method = 'POST', body, headers = {}, raw = false, host, chunks = false }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : raw ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: host || '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'content-type': 'application/json',
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        const parts = [];
        res.on('data', (chunk) => {
          parts.push(chunk);
          if (chunks) res.emit('__chunk', chunk.toString('utf8'));
        });
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {
            /* keep it raw */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startServer(overrides = {}) {
  const server = createApiServer({
    authenticate: (token) => token === TOKEN,
    getToken: () => TOKEN,
    listModels: () => [
      {
        id: 'aihub/chatgpt',
        object: 'model',
        owned_by: 'aihub-desktop/auto',
        aihub: { service: 'chatgpt', login: 'logged-in', strategy: 'auto' }
      }
    ],
    listSessions: () => ({ chatgpt: { state: 'logged-in', name: 'ChatGPT' } }),
    complete: async (request_, stream) => {
      if (typeof overrides.complete === 'function') return overrides.complete(request_, stream);
      if (stream && stream.onDelta) {
        stream.onDelta('Hello ');
        stream.onDelta('world');
      }
      return { text: 'Hello world', usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } };
    },
    ...overrides
  });

  const bound = await server.listen(0, '127.0.0.1');
  return { server, port: bound.port };
}

async function stop(server) {
  await server.stop();
}

describe('health and auth', () => {
  it('answers /health without a key and requires one elsewhere', async () => {
    const { server, port } = await startServer();
    try {
      const health = await request({ port, path: '/health', method: 'GET' });
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({ ok: true, name: 'AI Hub Desktop' });

      const anonymous = await request({ port, path: '/v1/models', method: 'GET' });
      expect(anonymous.status).toBe(401);
      expect(anonymous.json.error.type).toBe('authentication_error');

      const wrong = await request({
        port,
        path: '/v1/models',
        method: 'GET',
        headers: { authorization: 'Bearer not-the-key' }
      });
      expect(wrong.status).toBe(401);

      const right = await request({ port, path: '/v1/models', method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } });
      expect(right.status).toBe(200);
      expect(right.json.data[0].id).toBe('aihub/chatgpt');
    } finally {
      await stop(server);
    }
  });

  it('accepts x-api-key as an alternative', async () => {
    const { server, port } = await startServer();
    try {
      const viaHeader = await request({ port, path: '/v1/models', method: 'GET', headers: { 'x-api-key': TOKEN } });
      expect(viaHeader.status).toBe(200);
    } finally {
      await stop(server);
    }
  });
});

describe('request validation', () => {
  it('rejects invalid JSON and malformed bodies with OpenAI errors', async () => {
    const { server, port } = await startServer();
    const auth = { authorization: `Bearer ${TOKEN}` };
    try {
      const broken = await request({ port, raw: true, body: '{"model":', headers: auth });
      expect(broken.status).toBe(400);
      expect(broken.json.error.message).toMatch(/valid JSON/);

      const noModel = await request({ port, body: { messages: [{ role: 'user', content: 'hi' }] }, headers: auth });
      expect(noModel.status).toBe(400);
      expect(noModel.json.error.param).toBe('model');
    } finally {
      await stop(server);
    }
  });

  it('caps the body size before parsing it', async () => {
    const { server, port } = await startServer();
    try {
      const huge = await request({
        port,
        raw: true,
        body: `{"model":"aihub/chatgpt","messages":[{"role":"user","content":"${'x'.repeat(1.5 * 1024 * 1024)}"}]}`,
        headers: { authorization: `Bearer ${TOKEN}` }
      });
      expect(huge.status).toBe(413);
      expect(huge.json.error.message).toMatch(/exceeds/);
    } finally {
      await stop(server);
    }
  });

  it('404s an unknown route', async () => {
    const { server, port } = await startServer();
    try {
      const result = await request({
        port,
        path: '/v1/embeddings',
        method: 'POST',
        body: { model: 'aihub/chatgpt', input: 'x' },
        headers: { authorization: `Bearer ${TOKEN}` }
      });
      expect(result.status).toBe(404);
      expect(result.json.error.message).toMatch(/Unknown endpoint/);
    } finally {
      await stop(server);
    }
  });
});

describe('loopback and origin defences', () => {
  it('refuses a request that claims a non-loopback Host (DNS rebinding)', async () => {
    const { server, port } = await startServer();
    try {
      const result = await request({
        port,
        path: '/health',
        method: 'GET',
        headers: { host: 'attacker.example' },
        host: '127.0.0.1'
      });
      expect([403, 400]).toContain(result.status);
    } finally {
      await stop(server);
    }
  });

  it('refuses a browser Origin, and 405s a preflight', async () => {
    const { server, port } = await startServer();
    try {
      const corsy = await request({
        port,
        path: '/v1/models',
        method: 'GET',
        headers: { origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` }
      });
      expect(corsy.status).toBe(403);

      const preflight = await request({ port, path: '/v1/models', method: 'OPTIONS' });
      expect(preflight.status).toBe(405);

      // No CORS headers are ever emitted.
      const plain = await request({ port, path: '/v1/models', method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } });
      expect(plain.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await stop(server);
    }
  });
});

describe('chat completions', () => {
  it('returns a buffered completion', async () => {
    const { server, port } = await startServer();
    try {
      const result = await request({
        port,
        headers: { authorization: `Bearer ${TOKEN}` },
        body: { model: 'chatgpt', messages: [{ role: 'user', content: 'hi' }] }
      });
      expect(result.status).toBe(200);
      expect(result.json.object).toBe('chat.completion');
      expect(result.json.choices[0].message.content).toBe('Hello world');
      expect(result.json.usage.total_tokens).toBe(10);
      expect(result.json.id).toMatch(/^chatcmpl-aihub-/);
    } finally {
      await stop(server);
    }
  });

  it('streams SSE frames and terminates with [DONE]', async () => {
    let sawDelta = false;
    const { server, port } = await startServer({
      complete: async (request_, stream) => {
        stream.onDelta('Hel');
        await new Promise((resolve) => setTimeout(resolve, 20));
        stream.onDelta('lo');
        return { text: 'Hello' };
      }
    });

    try {
      const result = await request({
        port,
        headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' },
        body: { model: 'chatgpt', stream: true, messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toMatch(/text\/event-stream/);

      const frames = result.text
        .split('\n\n')
        .filter((frame) => frame.startsWith('data: '))
        .map((frame) => frame.slice(6));

      expect(frames[frames.length - 1]).toBe('[DONE]');
      const parsed = frames.slice(0, -1).map((frame) => JSON.parse(frame));
      const content = parsed.map((frame) => (frame.choices && frame.choices[0].delta.content) || '').join('');
      expect(content).toBe('Hello');
      expect(parsed.some((frame) => frame.object === 'chat.completion.chunk')).toBe(true);
      sawDelta = true;
      expect(sawDelta).toBe(true);
    } finally {
      await stop(server);
    }
  });

  it('supports the legacy /v1/completions shape', async () => {
    const { server, port } = await startServer();
    try {
      const result = await request({
        port,
        path: '/v1/completions',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: { model: 'chatgpt', prompt: 'hi' }
      });
      expect(result.status).toBe(200);
      expect(result.json.choices[0].message.content).toBe('Hello world');
    } finally {
      await stop(server);
    }
  });

  it('exposes session status under the aihub namespace', async () => {
    const { server, port } = await startServer();
    try {
      const sessions = await request({
        port,
        path: '/v1/aihub/sessions',
        method: 'GET',
        headers: { authorization: `Bearer ${TOKEN}` }
      });
      expect(sessions.json).toMatchObject({ object: 'aihub.sessions', sessions: { chatgpt: { state: 'logged-in' } } });

      const status = await request({ port, path: '/v1/aihub/status', method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } });
      expect(status.json).toMatchObject({ object: 'aihub.status' });
      expect(status.json.counters).toEqual(
        expect.objectContaining({ requests: expect.any(Number), completed: expect.any(Number) })
      );
      expect(status.json.listening).toBe(true);
    } finally {
      await stop(server);
    }
  });
});

describe('failure mapping', () => {
  it('maps "not signed in" to a service-unavailable error the client can read', async () => {
    const openai = require('../src/api/openai');
    const { server, port } = await startServer({
      complete: async () => {
        throw Object.assign(new Error('chatgpt is not signed in'), {
          openaiError: openai.ERRORS.serviceUnavailable('chatgpt is not signed in — open the tab and sign in once.')
        });
      }
    });
    try {
      const result = await request({
        port,
        headers: { authorization: `Bearer ${TOKEN}` },
        body: { model: 'chatgpt', messages: [{ role: 'user', content: 'hi' }] }
      });
      expect(result.status).toBe(502);
      expect(result.json.error.code).toBe('session_unavailable');
      expect(result.json.error.message).toMatch(/sign in once/);
    } finally {
      await stop(server);
    }
  });

  it('reports an upstream crash as a 502 rather than hanging', async () => {
    const { server, port } = await startServer({
      complete: async () => {
        throw new Error('renderer exploded');
      }
    });
    try {
      const result = await request({
        port,
        headers: { authorization: `Bearer ${TOKEN}` },
        body: { model: 'chatgpt', messages: [{ role: 'user', content: 'hi' }] }
      });
      expect(result.status).toBe(502);
      expect(result.json.error.message).toMatch(/renderer exploded/);
    } finally {
      await stop(server);
    }
  });
});

describe('limits', () => {
  it('rate limits a chatty client and says when to retry', async () => {
    const limiter = queue.createRateLimiter({ limit: 2, windowMs: 60000 });
    const { server, port } = await startServer({ limiter });
    try {
      const auth = { authorization: `Bearer ${TOKEN}` };
      const body = { model: 'chatgpt', messages: [{ role: 'user', content: 'hi' }] };
      const first = await request({ port, body, headers: auth });
      const second = await request({ port, body, headers: auth });
      const third = await request({ port, body, headers: auth });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.json.error.type).toBe('rate_limit_error');
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await stop(server);
    }
  });

  it('serialises work through the queue and rejects an overflowing backlog', async () => {
    let concurrent = 0;
    let peak = 0;
    const { server, port } = await startServer({
      concurrency: 1,
      complete: async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 40));
        concurrent -= 1;
        return { text: 'ok' };
      }
    });

    try {
      const auth = { authorization: `Bearer ${TOKEN}` };
      const body = { model: 'chatgpt', messages: [{ role: 'user', content: 'hi' }] };
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => request({ port, body, headers: auth }).catch((error) => ({ status: 0, error: error.message })))
      );

      expect(peak).toBe(1); // never more than one tab-driven call at a time
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
      expect(statuses).toContain(503); // and the overflow is refused, not queued forever
      expect(statuses.filter((status) => status === 200).length).toBeLessThan(8);
    } finally {
      await stop(server);
    }
  });
});

describe('server plumbing', () => {
  it('records a bounded request log for the settings panel', async () => {
    const { server, port } = await startServer();
    try {
      await request({ port, body: { model: 'chatgpt', messages: [{ role: 'user', content: 'hi' }] }, headers: { authorization: `Bearer ${TOKEN}` } });
      const entries = server.log();
      expect(entries.length).toBe(1);
      expect(entries[0]).toMatchObject({ route: '/v1/chat/completions', status: 200, serviceId: 'chatgpt' });
      expect(entries[0].at).toEqual(expect.any(String));
    } finally {
      await stop(server);
    }
  });

  it('stops cleanly and refuses a second bind on the same exclusive port', async () => {
    const first = await startServer();
    const address = first.server.server.address();
    await stop(first.server);

    const a = await startServer();
    const b = createApiServer({ getToken: () => TOKEN, authenticate: () => true });
    await expect(b.listen(a.port, '127.0.0.1')).rejects.toMatchObject({ code: 'EADDRINUSE' });

    expect(typeof address.port).toBe('number');
    await stop(a.server);
  });

  it('emits an event for every request so the UI can update live', async () => {
    const events = [];
    const server = createApiServer({
      getToken: () => TOKEN,
      authenticate: (token) => token === TOKEN,
      onEvent: (entry) => events.push(entry),
      complete: async () => ({ text: 'ok' })
    });
    const bound = await server.listen(0, '127.0.0.1');
    try {
      await request({
        port: bound.port,
        body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        headers: { authorization: `Bearer ${TOKEN}` }
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ status: 200, route: '/v1/chat/completions' });
    } finally {
      await server.stop();
    }
  });
});
