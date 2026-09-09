# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-09-09

### Changed (visual redesign - no behaviour changes)
- Rebuilt the shell as a **Liquid Glass** design system: token-driven glass
  materials (primary/secondary/tinted/float), an ambient layered backdrop, soft
  ambient shadows, hairline edge highlights and a clear spatial z-hierarchy.
- New typography scale and spacing rhythm using the SF/system font stack;
  refined dark *and* light materials (light mode is a first-class theme).
- Tab strip and Settings tabs now use a **gliding glass indicator** that tracks
  the active item with spring easing; sidebar/settings headers gain density on
  scroll.
- Buttons, cards, inputs, toggles, dialogs, context menus and toasts share the
  same material language with quick, purposeful micro-interactions.
- All motion is transform/opacity based and disabled under
  `prefers-reduced-motion`. No functionality, IPC, or backend logic changed.

### Added
- `ui/motion.js` (gliding indicators + scroll-aware surfaces) and the
  `.app-bg` ambient backdrop layer.

## [1.1.0] - 2026-09-09

### Fixed
- **Packaged-build crash**: `electron-reload` (a devDependency) was required
  unconditionally at startup; it is now dev-only and guarded, so production
  builds boot.
- **First-launch / offline brick**: with no downloaded rules the request
  filter blocked *everything*. A validated catalogue + rule set now ships in
  `data/` and is used as the offline fallback, and unknown senders fail open
  unless Strict mode is on.
- **Stale rules**: a fresh download now takes effect immediately instead of
  only after a restart.
- **macOS reopen**: closing the window destroyed it with no way back; the
  `activate` event now recreates/restores the window.
- **Window close handling**: the close handler no longer returns a misleading
  value; `before-quit` drives a clean shutdown (shortcuts, views, tray).
- **Deep links**: `aihub://` now also parses the initial command line on
  Windows, queues links until the shell is ready and re-validates ids.
- **Proxy + blocking**: while `useProxy` is on the proxy host is added to each
  tab's allow-list so proxied traffic is not self-blocked.
- Tab favicons are fetched in the main process (the shell CSP forbids remote
  images), and the shell itself is trusted so its assets are never filtered.

### Added
- **Tab hibernation**: idle tabs' renderers are torn down and rebuilt on
  demand; configurable threshold plus a "hibernate now" action.
- **Permission prompts** (mic/camera/notifications) and a deny-by-default
  permission policy; navigation and `window.open` guards; "open in browser"
  with confirmation.
- **UI**: redesigned shell with sidebar search, welcome quick-start, settings
  tabs (General/Services/Privacy/About), toasts, confirm dialogs, tab context
  menus, drag-to-reorder, middle-click close, zoom, shortcut reference, and a
  light theme.
- **Settings**: strict mode, tab limit, hibernation, tray, launch-at-login,
  custom global shortcut, auto-refresh, proxy validation.
- **About/diagnostics**: versions, data provenance, blocking counters, log
  path, live update status.
- **Tooling**: `doctor`, `clean`, `icons` (dependency-free icon generator),
  benchmark runner, one-click Windows scripts (`scripts/windows/`), GitHub CI,
  this documentation set and a rewritten README.

### Changed
- Config writes are whitelisted/clamped in the main process (`sanitizeConfig`);
  all IPC input is validated (tab ids, service ids, URLs, accelerators).
- Data downloads are size/redirect/time-limited, validated before write and
  stored atomically; the loader normalises both tuple and object payloads.
- `electron` moved to devDependencies (electron-builder convention).
- Renderer refactored into focused modules with a shared `window.AiHub` state.

### Removed
- Unused/scratch files: `benchmark.js` (root), `summerize.py`, `config.json`,
  and the stale `benchmarks/blocking_benchmark.js`.

## [1.0.0] - initial release
