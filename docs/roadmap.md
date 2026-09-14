# Roadmap & suggested improvements

## Shipped recently (see `CHANGELOG.md`)

- Offline-first bundled data, real tab hibernation, hardened config/IPC
- Permission prompts, navigation / window-open guards, favicon resolution
- Liquid Glass redesign, search/toasts/context-menus, deep-link fixes
- One-click Windows scripts + root `RUN.bat` / `npm run one-click`
- Find in page, per-tab mute + zoom persistence, WebRTC IP policy
- Proxy host allow-list injection, zoom float fix, tab-state id normalisation

## Suggested next, in rough priority order

1. **Per-service session partitions.** Give each service its own
   `persist:<id>` session so cookies never cross services and "clear data" can
   target one account. Trade-off: re-authenticating per service. Keep opt-in.
2. **Rule-set editor UI.** Let users add/remove allow-list domains per service
   and merge them over the remote rules, instead of editing JSON.
3. **Per-tab history menu.** Surface `webContents` navigation history in the
   tab context menu (back list / forward list).
4. **Custom service entries.** Let power users pin arbitrary https URLs with a
   hand-written allow-list, stored locally and merged with the catalogue.
5. **i18n.** Extract UI strings into resource files; the shell is small enough
   to localise cheaply.
6. **Telemetry-free crash reporting.** Optionally dump `render-process-gone`
   details to the log with a user opt-in, to diagnose flaky services.
7. **Signed builds + notarization** for Windows/macOS so the installer is not
   flagged, and a proper auto-update channel.
8. **Picture-in-picture / always-on-top mode** for long-running chats.

## Deliberately *not* done (and why)

- **Session partitioning by default** — it would sign users out of shared
  Google/Microsoft accounts across services; keep it opt-in.
- **A bundler/framework for the UI** — the shell is intentionally dependency-
  free plain JS to keep the attack surface and build complexity minimal.
- **Cloud sync of settings** — privacy-first design; local store only.
