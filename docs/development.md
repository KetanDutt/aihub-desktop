# Development

## Prerequisites

- Node.js **20 or newer** (Node 22 recommended)
- npm 9+

## Quick start

```bash
# Windows: double-click RUN.bat at the repo root (installs Node if needed)
npm run one-click  # check/install deps, then launch (any OS)
npm install        # or run scripts/windows/Setup.bat on Windows
npm start          # launch
npm run serve      # API server only, no window (headless)
npm run dev        # auto-restart on changes (nodemon)
npm run doctor     # diagnose this environment
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run one-click` | Check Node, install deps + Electron if needed, then launch. |
| `npm start` | Run the app (hot reload of the renderer). |
| `npm run serve` | Start the local API server headless (`-- --port 8081` to choose a port). |
| `npm run dev` | Restart the whole app on any source change. |
| `npm test` | Jest suite (unit + integration smoke). |
| `npm run test:watch` | Jest watch mode. |
| `npm run coverage` | Coverage report. |
| `npm run lint` / `lint:fix` | ESLint. |
| `npm run check` | `lint` + `test` (what CI runs). |
| `npm run benchmark` | Performance micro-benchmarks. |
| `npm run doctor` | Environment/asset verification. |
| `npm run preview:shell` | Design preview of the renderer with a stubbed main process (`?light`, `?surface`, `-- --port 5000`). |
| `npm run icons` | Regenerate `build/*.{png,ico}` from source. |
| `npm run clean` | Remove `dist/`, `coverage/` (`--deps` also node_modules). |
| `npm run build[:win|:mac|:linux]` | Package with electron-builder. |

Windows: double-click `RUN.bat` at the repo root for the all-in-one path.

## Testing

Tests live in `tests/`. Pure logic (`tabs`, `utils`, `data` normalisation,
`config` sanitisation, `blocking` decisions, accelerator mapping, window
geometry) is exercised directly; Electron is stubbed with `jest.mock`.

| Suite | What it protects |
|-------|------------------|
| `smoke.test.js` | Requires the whole main-process module graph under a stub; every IPC constant is unique and registered exactly once. |
| `window-manager.test.js` | Tab create/switch/close, the tab limit, bounds clamping, hibernation, shortcut forwarding and shutdown, against a stubbed `BrowserWindow`/`WebContentsView`. |
| `renderer-boot.test.js` | Boots the *real* `ui/index.html` with every shell script in order under jsdom, including the app-command replay path. |
| `blocking-internal.test.js` | Internal/loopback URL classification (the allow-list escape hatch). |
| `logger.test.js` | The logger survives a partial or throwing backend. |
| `accelerators.test.js` | Only app-owned accelerators are forwarded; site chords pass through. |
| `windowstate.test.js` | Geometry restore never lands off-screen. |
| `design-system.test.js`, `utils-parity.test.js` | Stylesheet tokens stay coherent; main/renderer helpers stay in lockstep. |

```bash
npm test           # everything
npm run coverage   # text report; the weakest files are ipc.js, api/engine.js
                   # and src/security.js — extend those first
```

## Layout

```
main.js            entry point
preload.js         contextBridge surface
src/               main-process modules (see docs/architecture.md)
ui/                shell renderer (plain JS, no bundler)
data/              bundled offline catalogue + rules
build/             generated icons + vector source
scripts/           doctor/clean/icons/preview-shell/one-click-run + helpers
RUN.bat / RUN.ps1  root one-click launcher (Windows)
RUN-SERVER.bat     root headless API-server launcher (Windows)
ui/findbar.js      find-in-page UI (Ctrl+F)
tests/             Jest suites
benchmarks/        performance micro-benchmarks
docs/              this documentation
```

## Conventions

- Main-process modules must stay require-able without a display (they are
  unit-tested under a stub). Keep Electron out of pure logic (`tabs.js`,
  `accelerators.js`, `windowstate.js`).
- Log through `src/logger.js`; never `require('electron-log')` in a module.
- Anything a key press can trigger goes in `src/accelerators.js` (pure mapping)
  and the renderer's dispatch table in `ui/shortcuts.js` — a shortcut must mean
  the same thing with the chrome focused and with a service tab focused.
- Renderer modules are UMD-friendly only for `ui/utils.js` (shared with tests);
  everything else is a browser global on `window.AiHub`.
- IPC channel names live in `src/constants.js#IPC` - never hand-type a string.
- No `innerHTML` with dynamic data; build nodes with `createElement`.
- UI changes go through the design system in `docs/design.md` (tokens, materials,
  layers, motion) — component CSS carries no raw radius, blur or duration.
  `tests/design-system.test.js` enforces that and checks that every class the
  shell can render has a rule; `ui/index.html` is the shell markup.
