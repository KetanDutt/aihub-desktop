# Architecture

AI Hub Desktop is a classic Electron three-layer app: a privileged **main
process**, a **shell renderer** (the chrome: header, tab strip, sidebar,
settings, status bar) and one **`WebContentsView` per open service tab**.

```
+---------------------------------------------------------------+
| BrowserWindow (shell UI, sandboxed, context-isolated)         |
|  header / tabs / sidebar / settings / status bar              |
|                                                               |
|   +-------------------------------------------------------+   |
|   | WebContentsView (active tab)  - sandboxed             |   |
|   +-------------------------------------------------------+   |
+---------------------------------------------------------------+
            |  IPC (contextBridge, preload.js)
            v
        main process
          main.js        entry, lifecycle, deep links, crash containment
          src/ipc.js     validated IPC surface
          src/window.js  window/tray/shortcuts + WebContentsView host
          src/tabs.js    pure tab state machine (no Electron imports)
          src/blocking.js  per-tab domain allow-list + request filter
          src/security.js  permissions, navigation guards, external links
          src/data.js    service catalogue + rules (remote + bundled)
          src/config.js  electron-store backed settings + sanitisation
          src/favicon.js favicon resolver (main-process fetch + cache)
          src/updater.js electron-updater wiring
          src/loginstate.js login classification (pure: cookies + URL + DOM hints)
          src/logins.js   login monitor: tab watchers, re-login on open, keep-alive
          src/sessionstore.js cookie pin/snapshot/restore, per-service partitions
          src/cookies.js  cookie primitives (pin, merge, summarise) — no Electron
          src/fingerprint.js stable fingerprint profile + hardening script (pure)
          src/stealth.js  anti-bot hardening: flags, headers, CDP injection, cadence
          src/api/        local OpenAI-compatible endpoint
            index.js      lifecycle, key, IPC surface, config sync
            server.js     HTTP transport (no Electron; deps injected)
            openai.js     wire format: validation, completions, SSE (pure)
            engine.js     drives a logged-in session (API replay or hidden window)
            adapters.js   adapter descriptor validation (pure)
            template.js   `{placeholder}` rendering, path get/set (pure)
            queue.js      concurrency + rate limits (pure)
            http.js       outbound transport, cookie header assembly
          src/logger.js  electron-log configuration
          src/paths.js   bundled/user data directory resolution
          src/utils.js   pure helpers (slugify, clamp, URL checks)
```

## Why `WebContentsView` instead of `<webview>`

The deprecated `<webview>` tag runs as an out-of-process iframe with a fragile
API. `WebContentsView` gives each tab a real, sandboxed renderer that the main
process positions over the `#webviews-container` element. The shell reports the
container's real bounds over IPC; `constants.js` only provides a fallback for
the first frames.

## Layering constraint (important)

Child views always paint **above** the shell's own webContents. Therefore the
sidebar and settings panel are *in-layout* drawers (the flex row collapses
their width) rather than absolutely positioned overlays - an overlay would be
hidden underneath the active tab. `ui/styles.css` documents this.

## Tab lifecycle

1. Renderer calls `create-tab` with `{tabId, serviceId, url, title}`.
2. `ipc.js` validates the id, the service (must exist in the catalogue) and the
   URL, then asks `window.js`.
3. `window.js` reserves a slot in `TabManager` (enforcing the limit), creates a
   `WebContentsView`, registers the tab's domain allow-list **before**
   navigating, attaches navigation/permission guards and loads the URL.
4. State changes (title, loading, back/forward, hibernation) are pushed to the
   renderer as `tab-state` events.
5. `openTabs` / `activeTabId` are persisted (debounced) so the session restores
   on next launch.

## Hibernation

A 60s sweep asks `TabManager.hibernationCandidates()` for tabs that have been
inactive longer than the configured idle time. Their `WebContentsView` is torn
down (freeing the renderer process and its memory) while the tab record
survives; switching back recreates the view on demand. The active tab is never
hibernated.

## Session fields that survive restarts

`TabManager.toJSON()` persists, per tab:

| Field | Purpose |
|-------|---------|
| `id` / `serviceId` / `url` / `title` | Identity and last location |
| `zoomFactor` | Per-tab zoom (fractional) |
| `muted` | Per-tab audio mute |

Find-in-page state is ephemeral and is not restored.

## Blocking model

Each tab gets an allow-list = *its service's domains* ∪ *common auth domains*
∪ *always-allowed providers* (captchas, payments). A global
`session.webRequest.onBeforeRequest` filter evaluates every request:
internal protocols and the trusted shell pass, registered tabs are matched by a
suffix walk over their list, and unknown senders fail open by default
(`strictBlocking` flips them to fail-closed). See [security.md](security.md).

## Session and login layer

Tabs run in the persistent default session (or in `persist:aihub-<id>` when
`isolateSessions` is on). `src/logins.js` watches each tab's URL and cookie jar,
classifies the session with `src/loginstate.js`, and persists the verdict, which
is what makes re-login-on-open safe to automate. `src/sessionstore.js` pins and
caches cookies (see [sessions.md](sessions.md)); it writes `0600` files through
`safeStorage` and never sends cookie values to the renderer.

Anti-bot hardening is applied per session and per tab by `src/stealth.js`, from a
seed-derived profile in `src/fingerprint.js` so it is stable across launches.

The local API is a thin transport over that same session material — it does not
own a second copy of your logins.

## Offline-first data

Both the service catalogue and the rules resolve as: **downloaded copy →
bundled copy**. The bundled JSON in `data/` ships inside the app
(`extraResources`), so the first launch works with no network. Remote payloads
are size/redirect/time-limited, JSON-validated *before* they touch disk and
written atomically.
