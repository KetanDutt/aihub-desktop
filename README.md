# AI Hub Desktop

<p align="center">
  <img src="build/icon.png" alt="AI Hub Desktop icon" width="96">
</p>

<p align="center">
  <strong>One window for every AI assistant.</strong><br>
  ChatGPT, Claude, Gemini and friends live side by side in sandboxed tabs,
  each behind its own domain allow-list, with automatic memory management.
</p>

<p align="center">
  <a href="https://github.com/SilentCoderHere/aihub-desktop/actions/workflows/ci.yml"><img src="https://github.com/SilentCoderHere/aihub-desktop/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/SilentCoderHere/aihub-desktop" alt="License"></a>
  <a href="https://www.electronjs.org"><img src="https://img.shields.io/badge/Electron-41-47848F?logo=electron" alt="Electron"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.3.0-blue" alt="Version"></a>
</p>

---

## Why?

Juggling a dozen browser profiles for your AI tools is noisy and leaky. AI Hub
Desktop gives every service its own **sandboxed `WebContentsView` tab** and a
**per-service network allow-list**, so each assistant only talks to the domains
it actually needs - stray trackers and pixels are dropped before they leave
your machine.

## Features

- **Multi-tab, multi-service** - open ChatGPT, Claude, Gemini, Copilot,
  Perplexity and more at once; drag to reorder, middle-click to close.
- **Domain filtering** - suffix-aware allow-lists per service, shared auth
  domains, an optional *Strict mode*, live blocked-request counters.
- **Memory aware** - a concurrent-tab limit plus **automatic hibernation** of
  idle tabs tears down background renderers and rebuilds them on demand.
- **Full browser controls per tab** - back, forward, reload (plus
  reload-ignoring-cache), stop and home, with reload swapping to stop while a
  page loads; `Ctrl+Shift+T` reopens the last closed tab.
- **Find in page** - `Ctrl+F` opens a floating find bar with match counter and
  next/previous navigation.
- **Per-tab mute & zoom** - mute noisy tabs (`Ctrl+M`); zoom steps and mute
  state survive restarts.
- **Offline-first** - a validated catalogue + rule set ships with the app; the
  remote list refreshes in the background and can never corrupt the cache. An
  audited menu catalogue (homepages, sign-in requirements, cached icons) means
  the first paint is complete with no network round trip.
- **Portable settings** - export your preferences and enabled services to JSON,
  import them on another machine, or reset to defaults. Secrets and sessions are
  never included.
- **Privacy controls** - deny-by-default permissions with prompts, session
  wipe, proxy support, WebRTC IP policy, "open in browser" instead of pop-up
  windows.
- **Stays signed in** - each service's login is detected from its own session
  cookies, cached across restarts (pinned + encrypted snapshots) and refreshed by
  a background keep-alive; an expired session reopens its sign-in page on launch.
- **Not obviously a bot** - the `Electron` UA token, automation flags and missing
  client hints are normalised from a stable fingerprint profile, challenges are
  waited out instead of farmed, and typed input keeps a human cadence.
- **Local OpenAI-compatible API** - `POST /v1/chat/completions` on loopback,
  **on by default** with a key generated on first launch, answered through your
  logged-in sessions (streaming included), bearer-keyed and rate limited. It
  publishes every model each service exposes, splits answers into
  reasoning/code/links/text, and can run **headless** with no window at all.
- **Free services, kept apart** - the catalogue knows which sites answer without
  an account (Perplexity, Copilot, You.com, Pi, Duck.ai, Phind, Blackbox AI,
  DeepAI Chat); they are marked *No sign-in*, grouped and filterable on their
  own, and callable through the API before you log into anything.
- **Filterable catalogue** - the Services tab filters by type, enabled state,
  sign-in state and *access* (no sign-in vs sign-in required), and sorts by name,
  type, recency, cached cookies or "free first".
- **System integration** - tray with open-tab menu, global show/hide shortcut,
  launch-at-login, `aihub://` deep links, auto-update.
- **Polished shell** - Liquid Glass dark/light themes, sidebar search, toasts,
  context menus, keyboard shortcuts and a shortcut reference (`?`).

## Quick start

### Windows — one click (recommended)

Double-click **`RUN.bat`** at the repository root.

It checks and installs Node.js 20+ (via winget / Chocolatey / Scoop), installs
npm dependencies and the Electron runtime, runs a quick environment doctor, then
launches the desktop app (the web UI shell runs inside Electron).

No terminal knowledge required. On failure the window stays open so you can
read the log.

| Script | Action |
|--------|--------|
| **`RUN.bat`** (repo root) | **All-in-one**: deps + launch |
| **`RUN-SERVER.bat`** (repo root) | **API only**: deps + start the local API server, no window |
| **`BUILD.bat`** (repo root) | **One-click build**: deps + catalogue + checks + installer in `dist\` |
| `scripts/windows/Setup.bat` | Install Node.js + dependencies only |
| `scripts/windows/Run.bat` | Launch (installs deps if needed) |
| `scripts/windows/RunServer.bat` | Start the API server only (headless); `RunServer.bat --port 8081` |
| `scripts/windows/Build.bat` | Lint, test and build the installer into `dist\` |
| `scripts/windows/Test.bat` | Run lint + tests |
| `scripts/windows/Dev.bat` | Live-reload development loop |
| `scripts/windows/Clean.bat` | Remove `node_modules` and build artefacts |

See [scripts/windows/README.md](scripts/windows/README.md).

### macOS / Linux / any terminal

```bash
npm run one-click     # check/install deps, then launch
./BUILD.sh            # one-click build: installer for this OS into dist/
npm run serve         # API server only, no window (-- --port 8081 to choose one)
# or manually:
npm install
npm start
```

### Everything else

```bash
npm run doctor        # diagnose this environment
npm run dev           # auto-restart on changes
npm test              # unit + smoke tests
npm run check         # lint + tests (CI)
npm run benchmark     # performance micro-benchmarks
npm run build:win     # package (also :mac / :linux)
npm run one-click-build   # guided build: deps + catalogue + checks + installer
npm run build:all         # every target this host can produce
npm run services:audit    # refresh the menu catalogue + cached icons (offline)
```

## Local OpenAI-compatible API

Enable **Settings ▸ Local API** and the app serves the usual OpenAI shape on
loopback, answering from the sessions you are already signed into — no provider
key, streaming included:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H "Authorization: Bearer $AIHUB_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"aihub/chatgpt","stream":true,"messages":[{"role":"user","content":"Summarise my last chat"}]}'
```

Any SDK that takes a custom `base_url` works the same way. It is loopback-only,
bearer-keyed, rate limited and off by default - see
[docs/local-api.md](docs/local-api.md).

## Staying signed in

Each service's login is detected from its own session cookies and cached: session
cookies are re-stamped so Chromium persists them, snapshots are stored encrypted
where the OS keychain allows, and a background ping rolls a warm session forward.
If a service that *was* signed in has expired, its sign-in page is reopened on
launch instead of you finding out mid-task. Fingerprint hardening (UA, client
hints, automation flags, challenge handling) rides along - see
[docs/sessions.md](docs/sessions.md).

## Keyboard shortcuts

Press `?` in the app for the full list. Highlights:

| Keys | Action |
|------|--------|
| `Ctrl+T` | Open the service picker |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+W` | Close the active tab |
| `Ctrl+Shift+T` | Reopen the last closed tab |
| `Ctrl+R` / `Ctrl+Shift+R` | Reload / reload ignoring the cache |
| `Esc` | Stop loading the active tab |
| `Alt+←` / `Alt+→` / `Alt+Home` | Back / forward / service home page |
| `Ctrl+F` | Find in page |
| `Ctrl+M` | Mute / unmute the active tab |
| `Ctrl+=` / `-` / `0` | Zoom in / out / reset |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+A` (global) | Show / hide the app |

On macOS use `⌘` instead of `Ctrl`. Full reference:
[docs/keyboard-shortcuts.md](docs/keyboard-shortcuts.md).

## Documentation

| | |
|---|---|
| [Architecture](docs/architecture.md) | process model, IPC, tab lifecycle, hibernation |
| [Design system](docs/design.md) | Liquid Glass tokens, materials, motion |
| [Configuration](docs/configuration.md) | every setting and its effect |
| [Security model](docs/security.md) | what the filter does and does not do |
| [Sessions & anti-bot](docs/sessions.md) | login detection, cookie cache, re-login, hardening |
| [Local API](docs/local-api.md) | the OpenAI-compatible endpoint: models, keys, limits |
| [Development](docs/development.md) | setup, scripts, tests, conventions |
| [Packaging](docs/packaging.md) | electron-builder, auto-update, one-click scripts |
| [Production readiness](docs/production-readiness.md) | Release checklist, invariants, known limitations |
| [Troubleshooting](docs/troubleshooting.md) | reading the log, common problems |
| [API surface](docs/api.md) | IPC channels and preload bridge |
| [Roadmap](docs/roadmap.md) | suggested next improvements |

## Requirements

- **Node.js 20+** (22 recommended)
- Windows 10+, macOS 11+, or a modern Linux desktop
- ~200 MB free disk for Electron + dependencies

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities per
[SECURITY.md](SECURITY.md), not as public issues.

## License

[MIT](LICENSE)
