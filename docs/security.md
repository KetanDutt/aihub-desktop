# Security model

This document is honest about both what the app protects against and what it
deliberately does not.

## Renderer hardening

- The shell runs with `contextIsolation`, `nodeIntegration: false` and
  `sandbox: true`. Tabs run fully sandboxed.
- A strict CSP on `ui/index.html` locks the shell to local scripts/styles and
  `data:` images; `object-src 'none'`, `base-uri 'none'`.
- `<webview>` attachment is globally disabled (`will-attach-webview` is
  prevented).
- The shell's own navigation is locked to `file://`; any attempt to navigate it
  elsewhere is cancelled.

## Domain allow-list (the core feature)

Every tab may only talk to:

- the domains of **its own service** (e.g. `openai.com` for ChatGPT),
- shared **authentication domains** (Google/Microsoft/Okta/… sign-in), and
- a few **always-allowed providers** (captchas, payments).

Matching is suffix-based at label boundaries: `cdn.openai.com` is allowed for
ChatGPT, `notopenai.com` is not. Requests that fail are cancelled in
`session.webRequest.onBeforeRequest` and counted.

### Failure modes, by design

| Sender | Decision |
|--------|----------|
| Shell UI, devtools, `file:`/`data:`/`localhost` | always allowed |
| Registered tab, domain in list | allowed |
| Registered tab, domain not in list | **blocked** |
| Unknown webContents (pop-ups, workers) | allowed by default; blocked when `strictBlocking` is on |

Failing open for unknown senders is intentional: a bad update to the rule data
must never render the app unusable. Turn on **Strict mode** if you prefer
fail-closed.

### What it does NOT do

- It is a *network filter*, not a sandbox escape defence. A service's own
  allowed domains can still run their full site.
- The allow-lists are curated heuristics; a service that changes its CDN will
  need a rule update (the remote rule set ships independently of the app).
- It does not anonymise you: your accounts and IPs are still visible to the
  service you sign into.

## Permissions

Everything Chromium can ask for is denied unless explicitly allowed. `media`
(mic/camera) and `notifications` prompt with a native dialog and are remembered
for the session only; geolocation, MIDI, USB/serial/Bluetooth, display-capture,
etc. are denied outright.

## WebRTC / local IP leakage

Sessions install `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` so peer
connections prefer public interfaces and do not advertise LAN addresses. This
is especially relevant when a proxy is in use.

## Proxy

When *Use Proxy* is enabled, the proxy hostname is injected into every tab's
domain allow-list so proxied traffic is not self-blocked. Proxy URLs with
schemes like `javascript:` or `file:` are rejected at config save time.

## Window escape

`window.open` / `target="_blank"` never spawn a bare Electron window. Same-
service URLs open in a new tab (inheriting the allow-list); cross-service URLs
are handed to the OS browser after a confirmation dialog.

## Config hardening

All IPC input is validated in the main process: tab ids match a strict pattern,
service ids must exist in the catalogue, URLs must be `http(s)`, and config
writes are whitelisted/clamped (`sanitizeConfig`).

## Supply chain / data

Remote catalogue and rules are fetched over HTTPS with size, redirect and
timeout caps, parsed and validated *before* being written, and stored
atomically. A truncated or hostile response can never corrupt the cache, and
the bundled copy always remains as a fallback.

## Reporting

See `SECURITY.md` at the repository root.

## Sessions, cookies and the local API

**Cached logins.** `<userData>/data/sessions/` holds one small JSON file per
service: its cookies, re-stamped so Chromium persists them. The file is written
`0600`, encrypted with the OS keychain via `safeStorage` when one is available,
never leaves the machine, and is not included in any sync or diagnostic export.
Cookie *values* never cross the IPC bridge — the renderer gets counts.

**No credentials.** The app has no password field, no autofill, no credential
store and no keychain access beyond `safeStorage` for the cookie cache. Every
sign-in happens in the service's own page, typed by you. Re-login-on-open only
*navigates* to the provider's sign-in URL.

**Hardening is not an anonymity tool.** `src/stealth.js` removes the tells that
come from *this app* (the `Electron` UA token, automation flags, missing client
hints, `window.chrome`, plugin list). It does not make you untrackable: your
account, IP and behaviour are still yours to explain to the provider. Canvas
noise is off by default precisely because it would also destabilise the login
cache.

**The local API is loopback-only.** Bound to `127.0.0.1`, key-guarded, no CORS,
non-loopback `Host` refused (rebinding) and any browser `Origin` refused (CSRF).
Bodies, message counts, message size, per-minute rate and concurrency are capped;
a request dies with the client that made it. It replays *your* logged-in session,
which means it is as trusted as you are — do not expose the port, do not put the
key in a shell history you share, and rotate it from Settings if either happens.

**Automating a service may breach its terms.** Everything here talks to a service
the way its own web app does; whether you point it at something else is your
judgement and your account risk.
