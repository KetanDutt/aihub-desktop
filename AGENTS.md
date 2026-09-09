# Agent instructions

Guidance for AI agents working in this repository.

## Verification before finishing

Always run, and make green, the project's own checks over the code you touch:

```bash
npm run check     # ESLint + Jest
npm run doctor    # environment sanity (optional, non-fatal warnings ok)
```

Tests live in `tests/`. Main-process code is unit-tested under an Electron stub
(`jest.mock`); keep new logic dependency-free so it stays testable that way.

## Non-negotiables

- Do not relax the CSP in `ui/index.html` or enable `nodeIntegration`.
- Never write dynamic data via `innerHTML`; build nodes with `createElement`.
- IPC channel names live only in `src/constants.js#IPC`; do not hand-type
  strings. Validate all IPC input in `src/ipc.js`.
- Keep Electron out of pure logic: `src/tabs.js` and `src/utils.js` must stay
  require-able without a display (tests and benchmarks import them directly).
- New user settings must be added to the `electron-store` schema, the
  `WRITABLE_KEYS` whitelist and `sanitizeConfig()` in `src/config.js`.
- Service/rule edits go in `data/services.json` + `data/rules.json` (ids are
  `slugify(name)`); a test verifies the two stay consistent.

## Layout map

- `main.js` entry/lifecycle; `preload.js` contextBridge.
- `src/` main process (see `docs/architecture.md`).
- `ui/` shell renderer (plain JS, no bundler).
- `scripts/` doctor/clean/icons + one-click Windows scripts.
- `docs/` user + developer documentation; `CHANGELOG.md` for releases.

## Style

- CommonJS in `src/`/`main.js`; browser globals under `window.AiHub` in `ui/`.
- `eslint:recommended` with `eqeqeq`, `prefer-const`, `no-var`; treat warnings
  as things to fix, not ignore.
- Update `docs/` and `CHANGELOG.md` for user-visible changes.
