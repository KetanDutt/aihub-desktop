# Configuration

Settings live in `electron-store` (per-user JSON inside the OS app-data
directory, e.g. `%APPDATA%\aihub-desktop\config.json` on Windows). Only the
keys below are writable from the UI; internal state (`openTabs`, `activeTabId`,
`remoteUrls`, `lastUpdate`) is managed by the app and rejected if a renderer
tries to write it.

| Key | Type | Default | Effect |
|-----|------|---------|--------|
| `blockingEnabled` | bool | `true` | Master switch for the domain allow-list. |
| `strictBlocking` | bool | `false` | Also block requests that can't be tied to a known tab. May break pop-ups; off by default so the app can never brick itself. |
| `maxActiveServices` | int 1–20 | `3` | Concurrent tab limit (each tab is a full Chromium renderer). |
| `hibernateTabs` | bool | `true` | Tear down idle tabs' renderers to free memory. |
| `hibernateAfterMinutes` | int 1–1440 | `15` | Idle threshold before hibernation. |
| `darkMode` | bool | `true` | Shell theme. |
| `minimizeToTray` | bool | `true` | Closing the window hides to tray instead of quitting. |
| `launchAtLogin` | bool | `false` | Register as a login item (Windows/macOS). |
| `globalShortcut` | accelerator | `CommandOrControl+Shift+A` | Show/hide the app from anywhere. |
| `autoUpdateServices` | bool | `true` | Background-refresh the catalogue when older than 7 days. |
| `useProxy` | bool | `false` | Route tab URLs through a web proxy (advanced). |
| `proxyUrl` | URL | proxysite gateway | Proxy endpoint; must be `http(s)`. |
| `enabledServices` | string[] | `["chatgpt","claude","gemini"]` | Services shown in the picker. |
| `lastActiveService` | string|null | `null` | Bookkeeping for the tray/deep links. |

## Read-only state

| Key | Meaning |
|-----|---------|
| `lastUpdate` | ISO timestamp of the last successful catalogue refresh. |
| `openTabs` | Persisted session (ordered). |
| `activeTabId` | Tab that was active on exit. |
| `remoteUrls` | Where the catalogue/rules are downloaded from. |

## Environment variables (development/tests)

| Variable | Effect |
|----------|--------|
| `AIHUB_DATA_DIR` | Override the writable data directory. |
| `AIHUB_BUNDLED_DIR` | Override the bundled (read-only) data directory. |
| `AIHUB_NO_RELOAD=1` | Disable `electron-reload` (used by `npm run dev`). |
| `NODE_ENV=test` | Disable hot reload in tests. |

The proxy host is automatically added to each tab's allow-list while
`useProxy` is on, otherwise the proxied traffic would be blocked.
