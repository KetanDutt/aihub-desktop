# One-click Windows scripts

Double-click any of these from File Explorer — no terminal knowledge required.
Each `.bat` is a thin launcher around a `.ps1` that does the real work
(toolchain detection, dependency installation, action, and a friendly report).

| Script      | What it does                                                                 |
|-------------|------------------------------------------------------------------------------|
| `Setup.bat` | Installs/verifies Node.js 20+ (via winget/choco/scoop), installs npm deps, downloads Electron, then runs the environment doctor. |
| `Run.bat`   | Verifies dependencies, then launches the app (`npm start`).                  |
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
npm start          # Run
npm run dev        # Dev
npm run check      # Test
npm run build:win  # Build
npm run doctor     # environment report
```
