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
- After changing `data/services.json` (or a login profile / adapter), run
  `npm run services:audit` and commit the regenerated `data/catalog.json` and
  `assets/icons/`; CI runs `npm run services:check` and fails when they drift.
  Never hand-edit those two — they are generated.
- Service/rule edits go in `data/services.json` + `data/rules.json` (ids are
  `slugify(name)`); a test verifies the two stay consistent. The same rule covers
  `data/logins.json` (login fingerprints) and `data/adapters.json` (chat
  adapters) — a tests file asserts every id resolves to a known service.
- Pure logic (classification, cookie math, fingerprint profiles, the OpenAI wire
  format, adapter validation) must not import Electron: `src/loginstate.js`,
  `src/cookies.js`, `src/fingerprint.js` and `src/api/{openai,template,queue,
  adapters,server}.js` are unit-tested without a display. Electron-facing glue
  lives in `src/logins.js`, `src/sessionstore.js`, `src/stealth.js` and
  `src/api/{engine,index}.js`.
- Cookie values are secrets: never send them over IPC to the renderer, never log
  them, and keep the on-disk snapshot behind `safeStorage` with `0600` perms.

## Layout map

- `main.js` entry/lifecycle; `preload.js` contextBridge.
- `src/` main process (see `docs/architecture.md`).
- `ui/` shell renderer (plain JS, no bundler).
- `scripts/` doctor/clean/icons/one-click-run/one-click-build/audit-services +
  Windows helpers; root `RUN.bat` launches, `BUILD.bat`/`BUILD.sh` build.
- `src/catalog.js` reads the generated catalogue + cached icons; like the other
  pure modules it must stay free of Electron and of network access.
- Use `clampFloat` (not `clampNumber`) for fractional values such as zoom.
- IPC channel names live only in `src/constants.js#IPC`; keep preload and
  renderer in sync when adding channels.
- `docs/` user + developer documentation; `CHANGELOG.md` for releases.

## Style

- CommonJS in `src/`/`main.js`; browser globals under `window.AiHub` in `ui/`.
- `eslint:recommended` with `eqeqeq`, `prefer-const`, `no-var`; treat warnings
  as things to fix, not ignore.
- Update `docs/` and `CHANGELOG.md` for user-visible changes.
