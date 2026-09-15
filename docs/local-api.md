# Local OpenAI-compatible API

AI Hub Desktop can serve an OpenAI-shaped HTTP endpoint on your own machine and
answer it with the **logged-in sessions the app already has**. No provider API
key, no second account, no copy-pasting between windows:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H "Authorization: Bearer $AIHUB_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"aihub/chatgpt","stream":true,"messages":[{"role":"user","content":"Summarise what I asked this morning"}]}'
```

Enable it in **Settings ▸ Local API** (off by default).

## Endpoints

| Method + path | Purpose |
|---------------|---------|
| `GET /health` | liveness; no key required, no secrets returned |
| `GET /v1/models` | the services this app exposes, as models |
| `POST /v1/chat/completions` | chat, buffered or `stream: true` (SSE) |
| `POST /v1/completions` | legacy `prompt` shim, mapped onto chat |
| `GET /v1/aihub/sessions` | per-service login state (extension) |
| `GET /v1/aihub/status` | queue, counters and the last requests (extension) |

`GET /v1/api.json`-style discovery is deliberately absent; the surface is small
and this page is it.

### Models

A service id is `aihub/<slug>` (`aihub/chatgpt`, `aihub/claude`, `aihub/gemini`,
…). Clients that insist on a plain name can send the bare slug, and
`aihub/grok:grok-3` style suffixes resolve to the upstream model when the
adapter knows it. `GET /v1/models` lists what is available right now, each entry
carrying an `aihub` block with `login`, `strategy` and the adapter's model list.

Only *enabled* services appear; `apiExposeAllServices: false` narrows it to the
list in `apiServices`.

### Request fields

```jsonc
{
  "model": "aihub/chatgpt",
  "messages": [{ "role": "user", "content": "…" }],   // or content parts
  "stream": true,
  "max_tokens": 1024,          // advisory; see "how it works"
  "temperature": 0.7,          // accepted, best-effort
  "stop": ["END"],             // accepted, best-effort
  "user": "ide-integration",   // logged, nothing more
  "conversation_id": "…",      // adapter-dependent continuation
  "history": true,             // false = send only the last user turn
  "strategy": "auto",          // "auto" | "api" | "dom"
  "timeout_seconds": 180       // 5–900
}
```

Unknown fields are ignored rather than rejected, so ordinary OpenAI clients work
unmodified. Multi-turn context is folded into the prompt text (`Earlier in this
conversation: …`), because a browser session has no way to receive a message
array.

### Response shapes

Buffered responses are a normal `chat.completion`. Streaming is
`text/event-stream` with `chat.completion.chunk` frames and a final
`data: [DONE]`, including a `usage` object estimated from text length (÷4 chars
and word count, whichever is larger) — these services do not expose exact token
counts to their own web UI.

Errors use the OpenAI error envelope so SDKs surface them properly:

| HTTP | `error.code` | Meaning |
|------|--------------|---------|
| 400 | `null` | invalid body (`messages`, `model`, size caps) |
| 401 | `invalid_api_key` | missing/bearer token mismatch |
| 403 | `bad_host` / `bad_origin` | rebinding or cross-origin attempt |
| 404 | `model_not_found` | service exists but is not exposed here |
| 429 | `rate_limit_exceeded` | per-minute budget spent; `Retry-After` set |
| 499 | `cancelled` | client hung up; the run was aborted |
| 502 | `session_unavailable` | not signed in, or the tab died mid-answer |
| 503 | `overloaded` | concurrency + backlog exhausted |

## How a request is answered

`src/api/index.js` (lifecycle) → `src/api/server.js` (transport) →
`src/api/engine.js` (driver) → one of two strategies, chosen per service from
`data/adapters.json`:

* **`api`** — the service's own web endpoint, called with that service's cookies
  replayed from its persistent jar, the same origin/`sec-fetch-*` headers the
  page sends, and any `authHeaders` the adapter declares (read from the page's
  own `localStorage`, e.g. ChatGPT's account id). Real streaming, no renderer.
* **`dom`** — a hidden, sandboxed window on that service's session: open the chat
  page, type the prompt with human cadence, submit, then read the answer node as
  it grows and stream the difference. Slower, but it survives a redesign and
  needs no reverse engineering.

`auto` tries `api` and falls back to `dom` when the endpoint rejects us
(rotated payload, unresolved placeholder, login redirect). A *dead session* is
never retried: it is reported, because silently re-driving the login page is how
you get an account flagged.

Before any of that, the engine requires that the target host is inside the
service's allow-list — the same rule set the tabs use — so a session's cookies
can never be sent to an unrelated domain by a template bug.

## Limits, and why they are tight

| Setting | Default | Note |
|---------|---------|------|
| `apiEnabled` | `false` | nothing listens until you say so |
| `apiPort` | `8788` | busy → walks up to 6 ports forward |
| `apiMaxConcurrent` | `2` | each request drives a real renderer |
| backlog | `4 × concurrency` | past that: `503`, not an unbounded queue |
| `apiRateLimitPerMinute` | `60` | sliding window |
| `apiTimeoutSeconds` | `180` | also the per-request cap |
| body size | 1 MB | `413` beyond it |
| messages / message | 200 / 64 kB | `400` beyond |

### Security notes

* Bound to `127.0.0.1` — there is no config key for another interface, and the
  code refuses to bind elsewhere.
* A request whose `Host` header is not loopback is refused (`403 bad_host`):
  that is the DNS-rebinding defence.
* Any browser `Origin` is refused (`403 bad_origin`) and no CORS headers are
  ever emitted, so a random web page cannot reach the endpoint. CLI tools and
  SDKs send neither header.
* The key is `aihub-<40 hex>`, generated in the main process, compared with
  `timingSafeEqual`, kept out of `getConfig()` (fetch it with
  `get-api-status`) and never written to the log file. **Rotate** in Settings
  invalidates old clients immediately.
* Cookies are read per service and only attached to that service's own host.

## Using it from a client

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8788/v1", api_key="<your key>")
for chunk in client.chat.completions.create(
    model="aihub/chatgpt",
    messages=[{"role": "user", "content": "Draft a reply"}],
    stream=True,
):
    print(chunk.choices[0].delta.content or "", end="")
```

Anything that takes a custom `base_url` works the same way: CLI helpers, LangChain
shims, editor integrations. Treat it as "automation over your own logged-in
browser", not as a model API: latency is human-scale, token counts are estimates,
and the answers come from whatever plan the browser session has.

## Adapters are best-effort by design

`data/adapters.json` ships selectors and endpoint shapes for the bundled
services. Providers change their frontends constantly; when one rotates, the
adapter degrades to the DOM driver and the error says so
(`composer-missing`, `unresolved-placeholder`). To fix one locally, copy the
bundled file to `<userData>/data/adapters.json` and edit — that copy wins over
the shipped one, and every field is validated on load (https-only targets,
selectors that cannot carry markup, header names that cannot inject a line, no
code from a data file).

| Field | Meaning |
|-------|---------|
| `strategy` | `api`, `dom` or `auto` (missing blocks downgrade instead of failing) |
| `api.url` / `method` / `headers` | endpoint, `{placeholder}` templates allowed |
| `api.body` | JSON template (substituted *before* serialising, so a prompt with quotes is inert) or a raw string for form-encoded APIs |
| `api.sse`, `deltaPath`, `resultPath`, `errorPath` | stream framing and extraction paths |
| `api.authHeaders` | `{header, from: "localStorage"\|"cookie", key, jsonPath}` |
| `api.urlParams` | `{name, from: "urlPattern", pattern}` for ids embedded in a path |
| `dom.url`, `composer`, `submit`, `answer`, `pending`, `stop` | page driving, incl. the "still generating" affordance |
| `dom.idlePolls`, `pollMs`, `navigateTimeoutMs` | when an answer is considered finished |
