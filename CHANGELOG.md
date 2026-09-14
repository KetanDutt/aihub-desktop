# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-09-14

### Changed (visual — Liquid Glass v2)
- Full shell redesign against a refined **Liquid Glass** token system: quieter
  ambient backdrop, stronger type hierarchy, softer ambient shadows, clearer
  material tiers (primary / secondary / tinted / float / hover).
- Header, tab strip, drawers, cards, forms, toggles, dialogs, menus, toasts and
  empty states share one spatial language; welcome tips and toasts gain icon
  treatments; confirm dialogs ease out on dismiss.
- Layout metrics tightened (`54 / 44 / 30`) and window chrome colours match the
  dark/light tokens. Scroll-aware header density and gliding indicators retained.
- Docs: `docs/design.md` rewritten as the design-system source of truth.

### Fixed
- **Zoom steps were rounded away**: `clampNumber` always rounds to integers, so
  Ctrl+= / Ctrl+- collapsed every step to `1`. Zoom now uses `clampFloat` and
  keeps fractional factors (1.1, 0.9, …).
- **Tab-state ghost entries**: main-process `tab-state` payloads use `tabId`
  while the renderer stores `id`. `upsertTab` now normalises both shapes so
  updates merge into the existing tab instead of creating duplicates.
- **Proxy self-blocking**: when *Use Proxy* is on, the proxy hostname is now
  injected into each tab's domain allow-list (documented behaviour that was
  missing from the code path).
- **Layout fallback drift**: main-process header/tabs/status fallbacks now match
  the CSS tokens (`56 / 46 / 32`), so the first frames before the renderer
  reports bounds no longer clip the webview.
- **Context-menu keydown leak**: the Escape handler is removed when the menu
  closes, instead of stacking anonymous listeners.
- **Favicon selector injection**: service ids are CSS-escaped before being used
  in attribute selectors.

### Added
- **Find in page** (`Ctrl+F` / `⌘F`): floating find bar with next/previous
  match, live counter, and Esc to clear. Also available from the tab context
  menu.
- **Per-tab mute** (`Ctrl+M` / `⌘M`): mute state is persisted with the session
  and restored on relaunch; muted tabs show a subdued favicon/title.
- **Persist zoom**: per-tab `zoomFactor` survives restarts via `openTabs`.
- **WebRTC IP handling policy**: sessions use `disable_non_proxied_udp` to avoid
  leaking local IPs to peers.
- **One-click run for Windows + webapp**: root `RUN.bat` / `RUN.ps1` check and
  install Node.js 20+, npm dependencies and the Electron runtime, run the
  environment doctor, then launch. Cross-platform companion:
  `npm run one-click` (`scripts/one-click-run.js`).
- Block-log throttling on the request filter hot path (identical hosts within
  1.5s are counted but not re-logged).

### Changed
- Keyboard shortcut reference, docs and roadmap updated for find/mute/zoom.
- `withContents` returns real function results (needed by find-in-page).

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
- `docs/design.md` describing the Liquid Glass token/material system.
- `tests/renderer-boot.test.js`: a jsdom integration test that executes the
  real shell scripts end-to-end (boot, tab open/close, indicators, dialogs).

### Fixed
- The tab glide indicator now repositions on every active-tab paint (the
  `paintActiveTab` hook was missing, so it could stay hidden).
- `tabNode` guards `CSS.escape` with a safe fallback.

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
