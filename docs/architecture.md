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

## Blocking model

Each tab gets an allow-list = *its service's domains* ∪ *common auth domains*
∪ *always-allowed providers* (captchas, payments). A global
`session.webRequest.onBeforeRequest` filter evaluates every request:
internal protocols and the trusted shell pass, registered tabs are matched by a
suffix walk over their list, and unknown senders fail open by default
(`strictBlocking` flips them to fail-closed). See [security.md](security.md).

## Offline-first data

Both the service catalogue and the rules resolve as: **downloaded copy →
bundled copy**. The bundled JSON in `data/` ships inside the app
(`extraResources`), so the first launch works with no network. Remote payloads
are size/redirect/time-limited, JSON-validated *before* they touch disk and
written atomically.
