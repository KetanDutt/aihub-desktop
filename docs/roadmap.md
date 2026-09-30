# Roadmap & suggested improvements

## Shipped recently (see `CHANGELOG.md`)

- Offline-first bundled data, real tab hibernation, hardened config/IPC
- Permission prompts, navigation / window-open guards, favicon resolution
- Liquid Glass redesign, search/toasts/context-menus, deep-link fixes
- One-click Windows scripts + root `RUN.bat` / `npm run one-click`
- Find in page, per-tab mute + zoom persistence, WebRTC IP policy
- Proxy host allow-list injection, zoom float fix, tab-state id normalisation
- Window geometry persistence, shortcuts forwarded from inside a tab,
  actionable toasts, one logging entry point, hostname-exact internal-URL match

## Suggested next, in rough priority order

1. **Per-service session partitions.** Shipped as an opt-in
   (`isolateSessions`) with "clear this service only"; cross-service sign-on is
   the trade-off, so it stays off by default. A migration aid (copy the default
   jar into a new partition instead of starting empty) would make it friendlier.
2. **Session health dashboard.** Chart expiry dates and keep-alive outcomes per
   service over time, so "this provider always drops me after 3 days" is a fact
   instead of a feeling.
3. **Adapter editor UI.** `data/adapters.json` is overrideable today by editing
   JSON; a form that validates selectors and endpoint paths in-app (with a
   "try it" button hitting `/v1/aihub/sessions`) would remove the manual step.
4. **Rule-set editor UI.** Let users add/remove allow-list domains per service
   and merge them over the remote rules, instead of editing JSON.
5. **Per-tab history menu.** Surface `webContents` navigation history in the
   tab context menu (back list / forward list). A first slice (back/forward/
   stop/reload/home) already exists there.
6. **Custom service entries.** Let power users pin arbitrary https URLs with a
   hand-written allow-list, stored locally and merged with the catalogue.
7. **i18n.** Extract UI strings into resource files; the shell is small enough
   to localise cheaply.
8. **Telemetry-free crash reporting.** Optionally dump `render-process-gone`
   details to the log with a user opt-in, to diagnose flaky services.
9. **Signed builds + notarization** for Windows/macOS so the installer is not
   flagged, and a proper auto-update channel.
10. **Picture-in-picture / always-on-top mode** for long-running chats.
11. **More test coverage where it pays.** `src/ipc.js` (≈25% lines),
    `src/api/engine.js` (≈25%) and `src/security.js` (≈8%) are the weakest
    files and the most sensitive ones. `ipc.js` is mostly handler bodies — the
    useful move is to extract each handler's logic into a pure function that the
    test drives directly, then assert the validation rules (ids, URLs,
    scopes) without an Electron stub. `security.js` needs a stub for
    `dialog`/`session`; the permission-policy table is the valuable part.
12. **A window-geometry escape hatch.** `windowBounds` / `windowMaximized` are
    restored automatically and only cleared by *Reset to defaults*. A "Forget
    window position" button (and a `--reset-window-geometry` flag for a
    corrupted config) would save a manual config edit.
13. **Batch tab actions.** "Reload every tab", "hibernate all but the active
    one", and "close all tabs of this service" are one context-menu entry away
    and would pair well with the existing tray tab list.
14. **A redacted diagnostic bundle.** One button that writes the log tail,
    `get-app-info` output and the *sanitised* config (no token, no cookies, no
    URLs with query strings) to a single file makes bug reports actionable
    without asking users to hand-hunt paths.

## Deliberately *not* done (and why)

- **Session partitioning by default** — it would sign users out of shared
  Google/Microsoft accounts across services; shipped as `isolateSessions`, off.
- **Credential storage or autofill** — the app never sees a password; sign-in
  always happens in the provider's page, and only the resulting cookies are cached.
- **Captcha solving / proxy rotation** — out of scope: hardening removes this app's
  own tells, it does not manufacture a new identity or beat a human check for you.
- **Streaming token-accurate usage from the local API** — the web sessions do not
  expose exact counts, so usage is estimated rather than pretending otherwise.
- **A bundler/framework for the UI** — the shell is intentionally dependency-
  free plain JS to keep the attack surface and build complexity minimal.
- **Cloud sync of settings** — privacy-first design; local store only.
