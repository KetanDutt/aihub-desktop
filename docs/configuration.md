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
| `sessionPersistence` | bool | `true` | Cache cookies per service and re-stamp session cookies so a restart keeps you signed in. |
| `autoRelogin` | bool | `true` | On open, re-open the sign-in page for a service whose session expired. |
| `keepAliveSessions` | bool | `true` | Background ping that rolls a provider's own token forward. |
| `keepAliveMinutes` | int 5–720 | `45` | Keep-alive cadence. |
| `isolateSessions` | bool | `false` | `persist:aihub-<id>` per service. Disables cross-service sign-on; reopen tabs after changing it. |
| `antiBotHardening` | bool | `true` | UA/client-hint/renderer normalization. See [sessions.md](sessions.md). |
| `antiBotHumanize` | bool | `true` | Human-paced typing and jittered challenge backoff. |
| `antiBotCanvasNoise` | bool | `false` | Optional canvas read-back noise; can break fingerprint-based login persistence. |
| `apiEnabled` | bool | `true` | Serve the local OpenAI-compatible endpoint (on by default; the key is generated on first launch). See [local-api.md](local-api.md). |
| `apiPort` | int 1024–65535 | `8788` | Loopback port for that endpoint. |
| `apiExposeAllServices` | bool | `true` | Off: only `apiServices` is callable. |
| `apiServices` | string[] | `[]` | Service ids the endpoint may drive. |
| `apiMaxConcurrent` | int 1–8 | `2` | Simultaneous completions (each drives a renderer). |
| `apiRateLimitPerMinute` | int 1–600 | `60` | Sliding-window request budget. |
| `apiTimeoutSeconds` | int 5–900 | `180` | Per-request cap. |

## Backup: export, import, reset

**Settings ▸ Privacy ▸ Backup** writes the writable keys above to a JSON file
you can move to another machine, read back, or keep as a known-good baseline.

```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-09-17T09:00:00.000Z",
  "settings": { "maxActiveServices": 5, "enabledServices": ["chatgpt", "claude"], … }
}
```

What is deliberately *not* in the file:

- `apiToken` — a live credential; it stays on the machine that generated it.
- `openTabs`, `activeTabId`, `sessionStates`, `serviceUsage` — machine-specific
  state that would be meaningless (or wrong) elsewhere.
- Cookies and cached sessions. A settings file never signs you in anywhere.

Import treats the file as untrusted: it goes through the same `sanitizeConfig()`
as any renderer write, so unknown keys are dropped, values are coerced and
clamped, and a file cannot inject a token or internal state. **Reset to
defaults** restores every preference without touching cookies or sessions.

## Read-only state

| Key | Meaning |
|-----|---------|
| `lastUpdate` | ISO timestamp of the last successful catalogue refresh. |
| `openTabs` | Persisted session (ordered). |
| `activeTabId` | Tab that was active on exit. |
| `remoteUrls` | Where the catalogue/rules are downloaded from. |
| `apiToken` | Bearer key for the local endpoint. Generated on first launch and whenever it is missing/rotated; the renderer may only rotate it (`rotate-api-token`). |
| `sessionStates` | Last known login state per service — the evidence re-login-on-open acts on. |
| `serviceUsage` | `serviceId → timestamp`, used by "recently used" sorting in the Services tab. |

## Environment variables (development/tests)

| Variable | Effect |
|----------|--------|
| `AIHUB_DATA_DIR` | Override the writable data directory. |
| `AIHUB_BUNDLED_DIR` | Override the bundled (read-only) data directory. |
| `AIHUB_NO_RELOAD=1` | Disable `electron-reload` (used by `npm run dev`). |
| `AIHUB_HEADLESS=1` | Run the API server only, with no desktop window (same as `--headless`). |
| `NODE_ENV=test` | Disable hot reload in tests. |

The proxy host is automatically added to each tab's allow-list while
`useProxy` is on, otherwise the proxied traffic would be blocked.
