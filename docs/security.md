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

## Window escape

`window.open` / `target="_blank"` never spawn a bare Electron window. Same-
service URLs open in a new tab (inheriting the allow-list); cross-service URLs
are handed to the OS browser after a confirmation dialog.

## Config hardening

All IPC input is validated in the main process: tab ids match a strict pattern,
service ids must exist in the catalogue, URLs must be `http(s)`, and config
writes are whitelisted/clamped (`sanitizeConfig`). Proxy URLs with schemes like
`javascript:` or `file:` are rejected.

## Supply chain / data

Remote catalogue and rules are fetched over HTTPS with size, redirect and
timeout caps, parsed and validated *before* being written, and stored
atomically. A truncated or hostile response can never corrupt the cache, and
the bundled copy always remains as a fallback.

## Reporting

See `SECURITY.md` at the repository root.
