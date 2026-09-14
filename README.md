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
- **Find in page** - `Ctrl+F` opens a floating find bar with match counter and
  next/previous navigation.
- **Per-tab mute & zoom** - mute noisy tabs (`Ctrl+M`); zoom steps and mute
  state survive restarts.
- **Offline-first** - a validated catalogue + rule set ships with the app; the
  remote list refreshes in the background and can never corrupt the cache.
- **Privacy controls** - deny-by-default permissions with prompts, session
  wipe, proxy support, WebRTC IP policy, "open in browser" instead of pop-up
  windows.
- **Session restore** - tabs, the active tab, zoom and mute survive restarts.
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
| `scripts/windows/Setup.bat` | Install Node.js + dependencies only |
| `scripts/windows/Run.bat` | Launch (installs deps if needed) |
| `scripts/windows/Build.bat` | Lint, test and build the installer into `dist\` |
| `scripts/windows/Test.bat` | Run lint + tests |
| `scripts/windows/Dev.bat` | Live-reload development loop |
| `scripts/windows/Clean.bat` | Remove `node_modules` and build artefacts |

See [scripts/windows/README.md](scripts/windows/README.md).

### macOS / Linux / any terminal

```bash
npm run one-click     # check/install deps, then launch
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
```

## Keyboard shortcuts

Press `?` in the app for the full list. Highlights:

| Keys | Action |
|------|--------|
| `Ctrl+T` | Open the service picker |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+W` | Close the active tab |
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
| [Development](docs/development.md) | setup, scripts, tests, conventions |
| [Packaging](docs/packaging.md) | electron-builder, auto-update, one-click scripts |
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
