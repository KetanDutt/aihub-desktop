# One-click Windows scripts

Double-click any of these from File Explorer — no terminal knowledge required.
Each `.bat` is a thin launcher around a `.ps1` that does the real work
(toolchain detection, dependency installation, action, and a friendly report).

## Fastest path

From the **repository root**, double-click:

| Script | What it does |
|--------|----------------|
| **`RUN.bat`** | **All-in-one**: checks/installs Node.js 20+, npm deps + Electron, runs the doctor, then launches the desktop app (web UI shell). |
| **`RUN-SERVER.bat`** | **API only**: same checks, then starts just the local OpenAI-compatible server with no window (`npm run serve`). Stays in the foreground; Ctrl+C stops it. Extra switches pass through, e.g. `RUN-SERVER.bat --port 8081 --print-key`. PowerShell equivalent: `RUN-SERVER.ps1 -Port 8081 -PrintKey`. |

`RUN.bat` is all most people need. `RUN-SERVER.bat` is for turning the machine
into an endpoint host (SSH box, CI, or simply no UI wanted). The scripts below
live in this folder for finer-grained control.

## Scripts in this folder

| Script      | What it does                                                                 |
|-------------|------------------------------------------------------------------------------|
| `Setup.bat` | Installs/verifies Node.js 20+ (via winget/choco/scoop), installs npm deps, downloads Electron, then runs the environment doctor. |
| `Run.bat`   | Verifies dependencies, runs doctor, then launches the app (`npm start`).     |
| `RunServer.bat` | Verifies dependencies, then starts **only** the local API server — no desktop window (`npm run serve`). Stays in the foreground; Ctrl+C stops it. Extra switches pass through, e.g. `RunServer.bat --port 8081 --print-key`. |
| `Dev.bat`   | Starts the live-reload development loop (`npm run dev` via nodemon).         |
| `Test.bat`  | Installs what is needed, then runs ESLint + the Jest suite (`npm run check`).|
| `Build.bat` | Verifies toolchain, runs lint + tests, then builds the NSIS installer into `dist\` (`npm run build:win`). |
| `Clean.bat` | Removes `node_modules` and build artefacts.                                  |

## Behaviour notes

- If Node.js is missing or older than v20 the scripts try, in order:
  `winget`, `choco`, then `scoop`. If none exist you are pointed at
  <https://nodejs.org>.
- Dependencies are installed automatically the first time; afterwards the
  scripts skip straight to the action.
- If a step fails the console window stays open (and shows the exit code) so
  you can read the error. Successful `Run`/`Dev` leave the app running in the
  foreground; `Build`/`Test`/`Setup`/`Clean` close on a key press.
- PowerShell runs with `-ExecutionPolicy Bypass` for this single invocation,
  so a restrictive machine policy does not block you. Nothing changes your
  system-wide policy.

## Cross-platform equivalents

The same actions exist as npm scripts (see the root `README.md`):

```
npm run one-click  # check deps + launch (any OS; Node must already be installed)
npm start          # Run
npm run serve      # Headless: API server only, no window (add -- --port 8081)
npm run dev        # Dev
npm run check      # Test
npm run build:win  # Build
npm run doctor     # environment report
```

On Windows, `RUN.bat` / `RUN.ps1` at the repo root can also install Node.js
itself when winget, Chocolatey or Scoop is available.