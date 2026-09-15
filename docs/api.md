# API surface

This document describes the IPC bridge between the shell renderer and the main
process. The shell never talks to Node or Electron directly: every call goes
through `preload.js` → `contextBridge` → `ipcMain`.

## Channel catalogue

All channel names live in `src/constants.js#IPC`. Do not hand-type strings in
new code — import the constant.

### Renderer → main (invoke / handle)

| Channel | Payload | Returns |
|---------|---------|---------|
| `get-config` | — | public config object |
| `save-config` | partial config | `{ success, config? , error? }` |
| `get-app-info` | — | versions, data status, blocking, tabs, update |
| `get-services` | — | normalised catalogue |
| `get-rules` | — | normalised rule set |
| `update-remote-data` | — | `{ success, services?, rules?, error? }` |
| `toggle-service` | serviceId | enabledServices array |
| `get-favicon` | url | `{ dataUrl }` or null fields |
| `open-external` | url | boolean |
| `clear-session-data` | — | `{ success, error? }` |
| `create-tab` | `{ tabId, serviceId, url, title?, userAgent?, zoomFactor?, muted? }` | `{ success, error?, tabId? }` |
| `get-tab-states` | — | tab state array |
| `hibernate-tabs` | — | `{ hibernated: string[] }` |
| `get-limits` | — | `{ maxTabs, limit, minTabs, hardMax }` |
| `set-zoom` | tabId, factor | clamped factor or null |
| `set-muted` | tabId, muted | boolean or null |
| `find-in-page` | tabId, text, options? | `{ requestId }` or `{ matches: 0 }` |
| `stop-find-in-page` | tabId | boolean |
| `open-tab-devtools` | tabId | boolean (dev builds only) |
| `check-for-updates` | — | update status |
| `get-update-status` | — | update status |
| `quit-and-install` | — | boolean |
| `get-blocking-stats` | — | blocking snapshot + counters |
| `get-login-states` | — | `{ serviceId: { state, reason, expiresAt, hasSnapshot, … } }` |
| `get-session-stats` | — | per-service cookie/cache stats + hardening status |
| `relogin-service` | serviceId | `{ ok, url, reason }` — opens the service's sign-in page |
| `touch-session` | serviceId | `{ ok, status }` — keep-alive ping + re-snapshot |
| `clear-service-data` | serviceId | `{ success, cleared }` — cookies, storage and snapshot for one service |
| `clear-session-data` | `{ scope: 'cache'\|'all' }` | `{ success, scope }` — `cache` keeps logins, `all` signs out |
| `get-api-status` | — | local API status incl. the key (only channel that returns it) |
| `rotate-api-token` | — | `{ ok, key, keyMasked }` |
| `api-ping` | — | self-test of `GET /health` over the socket |

### Renderer → main (send / on)

| Channel | Payload |
|---------|---------|
| `switch-tab` | tabId |
| `close-tab` | tabId |
| `close-other-tabs` | tabId |
| `reorder-tabs` | tabId[] |
| `set-view-bounds` | `{ x, y, width, height }` |
| `nav-go-back` / `nav-go-forward` / `nav-reload` | tabId |
| `set-active-service` | serviceId |
| `minimize-window` / `maximize-window` / `close-window` / `quit-app` | — |

### Main → renderer

| Channel | Payload |
|---------|---------|
| `deep-link-open` | serviceId |
| `tab-state` | `{ tabId, title, url, loading, canGoBack, canGoForward, hibernated, active, zoomFactor, muted, crashed?, requestFind? }` |
| `tab-created` | `{ tabId, serviceId, url, title }` |
| `tab-closed` | `{ tabId, nextActiveId }` |
| `tabs-emptied` | `{}` |
| `tab-blocked` | `{ tabId, hostname, kind }` |
| `tab-find-result` | `{ tabId, activeMatchOrdinal, matches, finalUpdate }` |
| `blocking-state` | snapshot + counters |
| `login-state` | `{ serviceId, previous, state, reason, confidence, expiresAt, changed }`, or `{ relogin: [serviceId] }` after the launch pass |
| `session-state` | `{ logins, hardening }` after a session wipe/recheck |
| `api-state` | local API status (start/stop/request finished) |
| `update-state` | updater status |

## Preload bridge (`window.electronAPI`)

`preload.js` exposes a small, typed surface. Every `on*` subscription returns an
unsubscribe function:

```js
const stop = window.electronAPI.onTabState((payload) => { /* … */ });
// later
stop();
```

## HTTP surface

The app also *serves* an OpenAI-compatible API on loopback (off by default):
see [local-api.md](local-api.md).

## Validation rules

- **Tab ids**: `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`
- **Service ids**: slugified; must exist in the loaded catalogue when known
- **URLs**: absolute `http:` / `https:` only, length-capped
- **Config writes**: only keys in `WRITABLE_KEYS` (`src/config.js`); values are
  coerced and clamped by `sanitizeConfig()`
- **Zoom**: clamped to `[0.3, 5]` with fractional precision (`clampFloat`)
- **Find text**: truncated to 500 characters

## Deep links

```
aihub://chatgpt
aihub:///claude
```

Validated in `main.js` (`validateServiceId`) and queued until the shell reports
ready via `did-finish-load`.
