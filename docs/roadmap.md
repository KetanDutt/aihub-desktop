# Roadmap & suggested improvements

## Shipped recently (see `CHANGELOG.md`)

- Offline-first bundled data, real tab hibernation, hardened config/IPC
- Permission prompts, navigation / window-open guards, favicon resolution
- Liquid Glass redesign, search/toasts/context-menus, deep-link fixes
- One-click Windows scripts + root `RUN.bat` / `npm run one-click`
- Find in page, per-tab mute + zoom persistence, WebRTC IP policy
- Proxy host allow-list injection, zoom float fix, tab-state id normalisation

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
   tab context menu (back list / forward list).
6. **Custom service entries.** Let power users pin arbitrary https URLs with a
   hand-written allow-list, stored locally and merged with the catalogue.
7. **i18n.** Extract UI strings into resource files; the shell is small enough
   to localise cheaply.
8. **Telemetry-free crash reporting.** Optionally dump `render-process-gone`
   details to the log with a user opt-in, to diagnose flaky services.
9. **Signed builds + notarization** for Windows/macOS so the installer is not
   flagged, and a proper auto-update channel.
10. **Picture-in-picture / always-on-top mode** for long-running chats.

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
