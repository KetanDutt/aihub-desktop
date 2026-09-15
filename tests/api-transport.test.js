/**
 * Concurrency + rate limiting for the local endpoint, and the outbound
 * transport used to replay a service's own API call.
 */

const http = require('http');
const queue = require('../src/api/queue');
const transport = require('../src/api/http');

describe('createQueue', () => {
  it('never exceeds the concurrency limit', async () => {
    const q = queue.createQueue({ concurrency: 2 });
    let active = 0;
    let peak = 0;

    const task = () => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve) => setTimeout(() => {
        active -= 1;
        resolve('done');
      }, 10));
    };

    await Promise.all([q.run(task), q.run(task), q.run(task), q.run(task), q.run(task)]);
    expect(peak).toBe(2);
    expect(q.stats().served).toBe(5);
  });

  it('rejects work beyond the backlog', async () => {
    const q = queue.createQueue({ concurrency: 1, maxQueued: 1 });
    const blocker = () => new Promise((resolve) => setTimeout(resolve, 20));
    const running = q.run(blocker);
    const queued = q.run(blocker);
    await Promise.resolve();

    await expect(q.run(blocker)).rejects.toMatchObject({ code: 'queue_full' });
    await Promise.all([running, queued]);
    expect(q.stats().rejected).toBe(1);
  });

  it('propagates rejections and keeps draining', async () => {
    const q = queue.createQueue({ concurrency: 1 });
    const failing = q.run(async () => {
      throw new Error('nope');
    });
    await expect(failing).rejects.toThrow('nope');

    await expect(q.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('drops a queued task when the caller aborts, and tells a running one', async () => {
    const q = queue.createQueue({ concurrency: 1 });
    let started = 0;

    const controller = new AbortController();
    const blocker = q.run(async (signal) => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { sawAbort: signal.aborted };
    });

    const queued = q.run(
      async () => {
        started += 1;
        return 'never';
      },
      { signal: controller.signal }
    );
    const rejection = expect(queued).rejects.toMatchObject({ code: 'cancelled' });

    controller.abort();
    expect(await blocker).toEqual({ sawAbort: false });
    await rejection;
    expect(started).toBe(1); // the queued task never ran
  });

  it('refuses to start a task whose signal is already aborted', async () => {
    const q = queue.createQueue({ concurrency: 1 });
    const controller = new AbortController();
    controller.abort();
    let started = 0;
    await expect(
      q.run(async () => {
        started += 1;
      }, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(started).toBe(0);
  });

  it('rejects a non-function task', async () => {
    const q = queue.createQueue({});
    await expect(q.run('nope')).rejects.toThrow(TypeError);
  });

  it('gives every task an abort signal', async () => {
    const q = queue.createQueue({ concurrency: 1 });
    const result = await q.run((signal) => ({ aborted: signal.aborted }));
    expect(result).toEqual({ aborted: false });
  });
});

describe('createRateLimiter', () => {
  it('allows `limit` calls per window and reports the wait', () => {
    const limiter = queue.createRateLimiter({ limit: 3, windowMs: 1000 });
    const now = 10_000;
    expect(limiter.tryAcquire('k', now).allowed).toBe(true);
    expect(limiter.tryAcquire('k', now + 100).allowed).toBe(true);
    expect(limiter.tryAcquire('k', now + 200).allowed).toBe(true);

    const blocked = limiter.tryAcquire('k', now + 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    // The oldest hit leaves the window and the budget frees up.
    expect(limiter.tryAcquire('k', now + 1400).allowed).toBe(true);
  });

  it('tracks callers independently and can be reset', () => {
    const limiter = queue.createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.tryAcquire('a').allowed).toBe(true);
    expect(limiter.tryAcquire('b').allowed).toBe(true);
    expect(limiter.tryAcquire('a').allowed).toBe(false);
    limiter.reset('a');
    expect(limiter.tryAcquire('a').allowed).toBe(true);
    limiter.reset();
    expect(limiter.size).toBe(0);
  });
});

describe('withTimeout', () => {
  it('resolves in time and rejects past the deadline', async () => {
    await expect(queue.withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(queue.withTimeout(new Promise(() => {}), 10, 'slow')).rejects.toThrow('slow');
  });

  it('is a no-op without a duration', async () => {
    await expect(queue.withTimeout(Promise.resolve('x'), 0)).resolves.toBe('x');
  });
});

describe('cookie header assembly', () => {
  it('joins name=value pairs and de-duplicates by scope', () => {
    const header = transport.cookieHeader([
      { name: 'a', value: '1', domain: 'x.com', path: '/' },
      { name: 'a', value: '2', domain: 'x.com', path: '/' },
      { name: 'b', value: '3', domain: 'x.com', path: '/' }
    ]);
    expect(header).toBe('a=1; b=3');
  });

  it('refuses values that could inject a header', () => {
    expect(transport.cookieHeader([{ name: 'a', value: 'x\r\nSet-Cookie: evil=1' }])).toBe('a=x\r\nSet-Cookie: evil=1'.includes('\r') ? '' : 'x');
    expect(transport.cookieHeader([{ name: 'evil\r\n', value: 'x' }])).toBe('');
    expect(transport.cookieHeader(null)).toBe('');
  });

  it('caps how many cookies go out', () => {
    const many = Array.from({ length: 200 }, (unused, index) => ({ name: `c${index}`, value: 'v', domain: 'x', path: '/' }));
    expect(transport.cookieHeader(many).split('; ').length).toBe(64);
  });

  it('builds session headers with origin, referer and sec-fetch', () => {
    const headers = transport.sessionHeaders({
      cookies: [{ name: 'sid', value: 'v', domain: 'chatgpt.com', path: '/' }],
      origin: 'https://chatgpt.com',
      userAgent: 'Mozilla/5.0',
      acceptLanguage: 'en-US,en;q=0.9',
      extra: { 'content-type': 'application/json', 'skip-me': '' }
    });
    expect(headers).toMatchObject({
      cookie: 'sid=v',
      origin: 'https://chatgpt.com',
      referer: 'https://chatgpt.com/',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json'
    });
    expect(headers['skip-me']).toBeUndefined();
  });
});

describe('target validation', () => {
  it('accepts http(s) and rejects everything else', () => {
    expect(transport.assertSafeTarget('https://a.com/x').ok).toBe(true);
    expect(transport.assertSafeTarget('http://localhost/x').ok).toBe(true);
    expect(transport.assertSafeTarget('file:///etc/passwd')).toEqual({ ok: false, error: 'unsupported protocol file:' });
    expect(transport.assertSafeTarget('https://user:pw@a.com').error).toMatch(/credentials/);
    expect(transport.assertSafeTarget('not a url').ok).toBe(false);
  });
});

describe('sendRequest / streamRequest against a real socket', () => {
  let server;
  let port;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        if (req.url === '/json') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ echo: body, cookie: req.headers.cookie, ua: req.headers['user-agent'] }));
          return;
        }
        if (req.url === '/sse') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"delta":"one"}\n\n');
          setTimeout(() => {
            res.write('data: {"delta":"two"}\n\n');
            res.end('data: [DONE]\n\n');
          }, 15);
          return;
        }
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'https://accounts.google.com/login' });
          res.end();
          return;
        }
        if (req.url === '/big') {
          res.writeHead(200, { 'content-type': 'text/plain' });
          let sent = 0;
          const tick = setInterval(() => {
            sent += 1;
            res.write('x'.repeat(2048));
            if (sent > 40) {
              clearInterval(tick);
              res.end();
            }
          }, 2);
          return;
        }
        if (req.url === '/slow') {
          setTimeout(() => res.end('late'), 500);
          return;
        }
        if (req.url === '/boom') {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('upstream exploded');
          return;
        }
        res.writeHead(404);
        res.end('nothing');
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(() => server.close());

  it('posts a JSON body and reads the response back', async () => {
    const response = await transport.sendRequest({
      url: `http://127.0.0.1:${port}/json`,
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'sid=abc', 'user-agent': 'Mozilla/5.0' },
      body: '{"q":1}'
    });
    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.text);
    expect(parsed.echo).toBe('{"q":1}');
    expect(parsed.cookie).toBe('sid=abc');
  });

  it('streams SSE chunks to the caller', async () => {
    const seen = [];
    const result = await transport.streamRequest({
      url: `http://127.0.0.1:${port}/sse`,
      method: 'GET',
      onData: (chunk) => seen.push(chunk)
    });
    expect(result.status).toBe(200);
    expect(seen.join('')).toContain('"delta":"one"');
    expect(seen.join('')).toContain('[DONE]');
  });

  it('refuses a redirect instead of forwarding cookies to it', async () => {
    await expect(
      transport.sendRequest({ url: `http://127.0.0.1:${port}/redirect`, method: 'GET' })
    ).rejects.toThrow(/redirect/);
  });

  it('surfaces a 5xx with its body for the error message', async () => {
    await expect(
      transport.streamRequest({ url: `http://127.0.0.1:${port}/boom`, method: 'GET' })
    ).rejects.toMatchObject({ status: 500, body: 'upstream exploded' });
  });

  it('gives up on a hung response', async () => {
    await expect(
      transport.sendRequest({ url: `http://127.0.0.1:${port}/slow`, method: 'GET', timeoutMs: 40 })
    ).rejects.toThrow(/timed out/i);
  });

  it('stops reading past the size cap', async () => {
    await expect(
      transport.sendRequest({ url: `http://127.0.0.1:${port}/big`, method: 'GET', maxBytes: 4096 })
    ).rejects.toThrow(/too large/i);
    await expect(
      transport.streamRequest({ url: `http://127.0.0.1:${port}/big`, method: 'GET', maxBytes: 4096, onData: () => {} })
    ).rejects.toThrow(/too large|aborted/i);
  });

  it('rejects an unsafe url before touching the network', async () => {
    await expect(transport.sendRequest({ url: 'ftp://x/y' })).rejects.toThrow(/protocol/);
    await expect(transport.streamRequest({ url: 'nope' })).rejects.toThrow(/invalid url/);
  });
});
