# Development

## Prerequisites

- Node.js **20 or newer** (Node 22 recommended)
- npm 9+

## Quick start

```bash
npm install        # or run scripts/windows/Setup.bat on Windows
npm start          # launch
npm run dev        # auto-restart on changes (nodemon)
npm run doctor     # diagnose this environment
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run the app (hot reload of the renderer). |
| `npm run dev` | Restart the whole app on any source change. |
| `npm test` | Jest suite (unit + integration smoke). |
| `npm run test:watch` | Jest watch mode. |
| `npm run coverage` | Coverage report. |
| `npm run lint` / `lint:fix` | ESLint. |
| `npm run check` | `lint` + `test` (what CI runs). |
| `npm run benchmark` | Performance micro-benchmarks. |
| `npm run doctor` | Environment/asset verification. |
| `npm run icons` | Regenerate `build/*.{png,ico}` from source. |
| `npm run clean` | Remove `dist/`, `coverage/` (`--deps` also node_modules). |
| `npm run build[:win|:mac|:linux]` | Package with electron-builder. |

## Testing

Tests live in `tests/`. Pure logic (`tabs`, `utils`, `data` normalisation,
`config` sanitisation, `blocking` decisions) is exercised directly; Electron is
stubbed with `jest.mock`. `tests/smoke.test.js` requires the entire main-process
module graph under a stub so a dangling import or IPC constant fails CI rather
than launch.

```bash
npm test
```

## Layout

```
main.js            entry point
preload.js         contextBridge surface
src/               main-process modules (see docs/architecture.md)
ui/                shell renderer (plain JS, no bundler)
data/              bundled offline catalogue + rules
build/             generated icons + vector source
scripts/           doctor/clean/icons + one-click Windows scripts
tests/             Jest suites
benchmarks/        performance micro-benchmarks
docs/              this documentation
```

## Conventions

- Main-process modules must stay require-able without a display (they are
  unit-tested under a stub). Keep Electron out of pure logic (`tabs.js`).
- Renderer modules are UMD-friendly only for `ui/utils.js` (shared with tests);
  everything else is a browser global on `window.AiHub`.
- IPC channel names live in `src/constants.js#IPC` - never hand-type a string.
- No `innerHTML` with dynamic data; build nodes with `createElement`.
