# Roadmap & suggested improvements

Implemented this release (see `CHANGELOG.md`): offline-first bundled data,
real tab hibernation, hardened config/IPC, permission prompts, navigation and
window-open guards, favicon resolution, redesigned UI with search/toasts/
context-menus, deep-link fixes, one-click Windows scripts, docs and CI.

Suggested next, in rough priority order:

1. **Per-service session partitions.** Give each service its own
   `persist:<id>` session so cookies never cross services and "clear data" can
   target one account. Trade-off: re-authenticating per service.
2. **Rule-set editor UI.** Let users add/remove allow-list domains per service
   and merge them over the remote rules, instead of editing JSON.
3. **Find-in-page and per-tab history menu.** `webContents` already exposes
   `findInPage` and navigation history; surface them in the UI.
4. **Persist per-tab zoom and mute.** Store `zoomFactor`/`setAudioMuted` in the
   session record so they survive restarts.
5. **WebRTC IP-handling policy.** `setWebRTCIPHandlingPolicy` to avoid local IP
   leakage while using the proxy.
6. **i18n.** Extract UI strings into resource files; the shell is small enough
   to localise cheaply.
7. **Telemetry-free crash reporting.** Optionally dump `render-process-gone`
   details to the log with a user opt-in, to diagnose flaky services.
8. **Signed builds + notarization** for Windows/macOS so the installer is not
   flagged, and a proper auto-update channel.

Deliberately *not* done (and why):

- **Session partitioning by default** - it would sign users out of shared
  Google/Microsoft accounts across services; keep it opt-in.
- **A bundler/framework for the UI** - the shell is intentionally dependency-
  free plain JS to keep the attack surface and build complexity minimal.
