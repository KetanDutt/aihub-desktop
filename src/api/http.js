/**
 * Outbound transport for the local API.
 *
 * Node's `http`/`https` (not Chromium's stack) so the behaviour is explicit and
 * unit testable against a local server: no cookie-jar magic, no ambient
 * proxying, and the caller decides exactly which headers and cookies leave the
 * machine. The engine replays the *service's own* cookies onto the request, so
 * the call carries the logged-in session — and only that session.
 */

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Only plain http(s), never a redirect we did not ask for. */
function assertSafeTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return { ok: false, error: 'invalid url' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: `unsupported protocol ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) return { ok: false, error: 'credentials in the url are not allowed' };
  return { ok: true, url: parsed };
}

function decodeBody(buffer, contentEncoding) {
  const encoding = String(contentEncoding || '').toLowerCase();
  try {
    if (encoding === 'gzip') return zlib.gunzipSync(buffer);
    if (encoding === 'deflate') return zlib.inflateSync(buffer);
    if (encoding === 'br') return zlib.brotliDecompressSync(buffer);
  } catch (e) {
    // A truncated or unsupported body must not take the whole request down.
    return buffer;
  }
  return buffer;
}

function buildRequestOptions(target, method, headers, timeoutMs) {
  return {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: String(method || 'POST').toUpperCase(),
    headers,
    timeout: timeoutMs || 60000
  };
}

/**
 * Fire a request and collect the whole body.
 *
 * @param {{url: string, method?: string, headers?: object, body?: string|Buffer,
 *           timeoutMs?: number, maxBytes?: number}} options
 * @returns {Promise<{status: number, headers: object, text: string, bytes: number}>}
 */
function sendRequest(options = {}) {
  const check = assertSafeTarget(options.url);
  if (!check.ok) return Promise.reject(new Error(check.error));

  const target = check.url;
  const transport = target.protocol === 'https:' ? https : http;
  const maxBytes = options.maxBytes || MAX_RESPONSE_BYTES;
  const headers = { 'accept-encoding': 'gzip, deflate', ...(options.headers || {}) };

  return new Promise((resolve, reject) => {
    const request = transport.request(buildRequestOptions(target, options.method, headers, options.timeoutMs), (response) => {
      const status = response.statusCode || 0;

      // A redirect here means the session bounced to a login page: report it
      // instead of cheerfully forwarding cookies to the identity provider.
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new Error(`Unexpected redirect (${status}) — the session may have expired`));
        return;
      }

      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        // Re-check on completion: a small-but-over-cap body can arrive in one
        // chunk, before the destroy above takes effect.
        if (bytes > maxBytes) {
          reject(new Error('Response too large'));
          return;
        }
        const raw = Buffer.concat(chunks);
        const decoded = decodeBody(raw, response.headers['content-encoding']);
        resolve({ status, headers: response.headers, text: decoded.toString('utf8'), bytes: raw.length });
      });
      response.on('error', reject);
    });

    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);

    if (options.body !== undefined && options.body !== null) request.end(options.body);
    else request.end();
  });
}

/**
 * Stream a response body, invoking `onData` with each decoded chunk.
 *
 * @param {object} options same as {@link sendRequest} plus `onData(chunk: string)`
 *   and an optional `abortSignal` (AbortSignal).
 * @returns {Promise<{status: number, headers: object, bytes: number}>}
 */
function streamRequest(options = {}) {
  const check = assertSafeTarget(options.url);
  if (!check.ok) return Promise.reject(new Error(check.error));

  const target = check.url;
  const transport = target.protocol === 'https:' ? https : http;
  const maxBytes = options.maxBytes || MAX_RESPONSE_BYTES;
  const onData = typeof options.onData === 'function' ? options.onData : () => {};
  const headers = { accept: 'text/event-stream', ...(options.headers || {}) };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    const request = transport.request(
      buildRequestOptions(target, options.method, headers, options.timeoutMs || 180000),
      (response) => {
        const status = response.statusCode || 0;

        if (status >= 300 && status < 400) {
          response.resume();
          finish(reject, new Error(`Unexpected redirect (${status}) — the session may have expired`));
          return;
        }

        if (status >= 400) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            finish(
              reject,
              Object.assign(new Error(`HTTP ${status}`), {
                status,
                body: Buffer.concat(chunks).toString('utf8').slice(0, 2000)
              })
            )
          );
          response.on('error', () => finish(reject, new Error(`HTTP ${status}`)));
          return;
        }

        let bytes = 0;
        const compressed = /^(gzip|deflate|br)$/.test(String(response.headers['content-encoding'] || ''));
        const source = compressed
          ? response.pipe(zlib.createUnzip({ flush: zlib.constants.Z_SYNC_FLUSH }))
          : response;

        source.setEncoding('utf8');
        source.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) {
            request.destroy(new Error('Response too large'));
            return;
          }
          try {
            onData(chunk);
          } catch (error) {
            request.destroy(error);
          }
        });
        source.on('end', () => finish(resolve, { status, headers: response.headers, bytes }));
        source.on('error', (error) => finish(reject, error));
      }
    );

    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', (error) => finish(reject, error));

    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        request.destroy(new Error('aborted'));
      } else if (typeof options.abortSignal.addEventListener === 'function') {
        options.abortSignal.addEventListener('abort', () => request.destroy(new Error('aborted')), {
          once: true
        });
      }
    }

    if (options.body !== undefined && options.body !== null) request.end(options.body);
    else request.end();
  });
}

/** Serialise a `Cookie` header from `session.cookies` shaped entries. */
function cookieHeader(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  const seen = new Set();
  const parts = [];

  for (const cookie of list) {
    if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    if (/[\r\n\0;]/.test(cookie.name) || /[\r\n\0]/.test(cookie.value)) continue;
    const key = `${cookie.name}=${cookie.value}`;
    if (seen.has(`${cookie.name}|${cookie.domain}|${cookie.path}`)) continue;
    seen.add(`${cookie.name}|${cookie.domain}|${cookie.path}`);
    parts.push(`${cookie.name}=${cookie.value}`);
    if (parts.length >= 64) break;
    void key;
  }

  return parts.join('; ');
}

/** `Cookie` + `Referer` + origin/SEC-FETCH headers of the page we imitate. */
function sessionHeaders({ cookies, origin, userAgent, acceptLanguage, extra }) {
  const referer = origin ? `${origin}/` : undefined;
  const headers = {
    'user-agent': userAgent,
    'accept-language': acceptLanguage,
    origin,
    referer,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    cookie: cookieHeader(cookies)
  };

  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null || value === '') continue;
    headers[key] = value;
  }

  // Drop empty ones so Chromium-style `cookie: ` never goes out.
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined && value !== ''));
}

module.exports = {
  MAX_RESPONSE_BYTES,
  assertSafeTarget,
  decodeBody,
  sendRequest,
  streamRequest,
  cookieHeader,
  sessionHeaders
};
