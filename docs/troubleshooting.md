# Troubleshooting

## First step: read the log

Everything lands in an `electron-log` file.

- **Settings → About → "Copy log file path"** gives you the exact location.
- Windows: `%USERPROFILE%\AppData\Roaming\aihub-desktop\logs\main.log`
- macOS: `~/Library/Logs/aihub-desktop/main.log`
- Linux: `~/.config/aihub-desktop/logs/main.log`

Also run `npm run doctor` - it verifies Node, dependencies, the Electron binary,
the bundled data and the packaging icons in one go.

**Windows first-run:** double-click `RUN.bat` at the repository root. It installs
Node.js (if needed), dependencies and Electron, then launches the app.

## Common problems

**Blank tab / site keeps failing to load.**
The service probably changed its domains. Open **Settings → Privacy → Update
now** to refresh the rules, or check the log for lines like
`Blocked <domain> for webContents <id>` and add the domain to the rule set.

**"Tab limit reached".**
Each tab is a full Chromium renderer. Raise *Concurrent tab limit* in
Settings → General, or close/hibernate tabs. Right-click a tab → *Free memory*.

**App "disappeared" when I closed it.**
*Minimise to tray on close* is on by default: the app keeps running in the
system tray. Quit from the tray menu, or disable the setting.

**Global shortcut does nothing.**
Another app owns `Ctrl+Shift+A`. Change it in Settings → General; the log
records `Global shortcut unavailable` on conflict.

**Login/cookies keep vanishing.**
*Clear session data* wipes cookies for every service. Anti-tracking extensions
or the proxy can also interfere; try with *Use Proxy* off.

**Windows scripts say Node is missing after installing.**
The installer updated `PATH` for new terminals only. Close and reopen the
console window, or double-click `RUN.bat` again.

**Electron failed to install (`ELECTRON_SKIP_BINARY_DOWNLOAD`).**
Run `npm rebuild electron` (the Windows scripts and `npm run one-click` do
this automatically).

**`RUN.bat` / one-click fails with no package manager.**
Install Node.js 20+ from https://nodejs.org, then re-run. On Windows the
script tries winget, then Chocolatey, then Scoop.
## Reporting a bug

Attach the log file, your OS/arch (Settings → About) and the steps to
reproduce. See `SECURITY.md` for vulnerabilities.
