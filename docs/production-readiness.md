# Production readiness

What "ready to ship" means for this app, what is already guaranteed, and the
failure modes that were found and closed. Use this as the pre-release checklist.

## Release checklist

```bash
npm run doctor          # environment sanity (Node, deps, data, icons)
npm run services:check  # the menu catalogue matches data/services.json
npm run check           # ESLint + the full Jest suite
npm run benchmark       # informational: hot-path timings
npm run one-click-build # deps → catalogue → checks → installer in dist/
```

CI (`.github/workflows/ci.yml`) runs the catalogue check, lint, tests and
benchmarks on Node 20 and 22. The release workflow builds per-OS installers on
tag push.

## Invariants the tests enforce

| Invariant | Enforced by |
|-----------|-------------|
| Every declared IPC channel is registered exactly once | `tests/smoke.test.js` |
| No IPC channel name is duplicated | `tests/smoke.test.js` |
| Renderer input is validated before reaching the main process | `tests/config-sanitize.test.js`, `src/ipc.js` |
| The menu catalogue matches `services.json` and every icon exists | `tests/catalog.test.js`, `npm run services:check` |
| Login profiles and adapters resolve to real services | `tests/sessionstore.test.js`, `tests/api-adapters.test.js` |
| Secrets never leave the machine in an export | `tests/config-backup.test.js` |
| Hidden API windows stay inside their service's allow-list | `tests/blocking-api-windows.test.js` |
| The shell boots and drives its flows under jsdom | `tests/renderer-boot.test.js` |

## Bugs found and fixed

These were real defects in shipped code, each now covered by a regression test.

### `strictBlocking` silently disabled the local API

The OpenAI-compatible endpoint drives services in hidden `BrowserWindow`s. They
built their allow-list directly instead of registering it with the request
filter, so to `blocking.js` they were an *unattributed* webContents. With
`strictBlocking` on — which is deliberately fail-closed for unattributed
requests — **every** request the hidden window made was rejected, so the whole
API stopped answering with no obvious cause.

Fixed by `blocking.registerTabDomains()`, called when a hidden window is created
and cleaned up when it is destroyed. The window is registered with the *same*
allow-list a visible tab would get, so it is filtered, not trusted:
cross-service requests are still blocked.
→ `tests/blocking-api-windows.test.js`

### Headless server exited 0 on failure

`app.quit(1)` looks like it sets an exit code, but `quit()` takes no argument.
A headless server that failed to bind its port exited **successfully**, so
systemd, Docker and CI all read a hard failure as a clean shutdown. Now
`app.exit(1)`, which does take a code.

### Favicon misses were cached forever

Hits and misses shared one map, and a miss (`null`) was stored permanently.
An icon that failed once — offline at launch, a flaky CDN, a rate limit — was
never retried for the lifetime of the process. Misses now live in their own map
with a 6-hour TTL, so transient failures heal while genuinely icon-less sites
are still not re-fetched on every render.
→ `tests/favicon-cache.test.js`

### Stale tab state on navigation

`syncNavigation` updated the tab record and then notified with the `tab` object
captured when the view was created. When the record had been replaced, the
renderer was sent the *old* url and back/forward flags. It now sends the current
record.

### Deprecated navigation API

`contents.canGoBack()` / `goBack()` were deprecated in Electron 30 in favour of
`contents.navigationHistory`. The new API is used when present, with a fallback
so older runtimes keep working.

### Blocked-request toast storm

One toast per blocked request meant a tracker-heavy page buried the screen and
kept the renderer busy. Hosts are now coalesced into a single summary toast per
1.2 s window.

### Wasted repaints on login events

Login state arrives for every service on every cookie change. Each event
rebuilt the whole settings catalogue — 20+ rows with avatars and chips — even
when the settings drawer was closed. Repaints are now scoped to lists that are
actually on screen.

## Known limitations

Worth stating plainly, because none of these are bugs to be "fixed later":

- **Service DOM adapters are inherently fragile.** The local API drives real web
  UIs; when a provider ships a redesign, its adapter selectors break. They live
  in `data/adapters.json` precisely so a fix is data, not code.
- **Anti-bot hardening is best-effort.** It normalises the obvious automation
  tells. It is not a guarantee against a determined bot-detection vendor, and it
  is not a licence to violate a provider's terms.
- **The domain filter is a containment boundary, not a sandbox.** It constrains
  where a tab may talk; Chromium's own sandbox is what isolates code. See
  [security.md](security.md).
- **`--online` service audits depend on the network.** Offline regeneration is
  the default so builds stay reproducible; real favicons need a networked run.
- **Cross-OS installer builds are not supported.** Build each target on its own
  OS (or in CI); `--all` only expands to what the current host can produce.
