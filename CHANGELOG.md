# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Audited service catalogue with cached icons.** `scripts/audit-services.js`
  (`npm run services:audit`) "runs" every catalogue entry once and writes
  `data/catalog.json` plus `assets/icons/<id>.*`: the exact homepage, the
  sign-in page, whether an account is required, the allowed auth domains,
  whether a login fingerprint and an API adapter exist, and an icon. Both ship
  with the app, so the tab strip and the service picker paint complete and
  instantly — offline, on a first launch, with no per-service network request.
  The audit is offline-safe by default (deterministic brand-colour monograms);
  `--online` refreshes real favicons and post-redirect homepages, and `--check`
  fails CI when the catalogue is stale.
- **Service details menu.** Right-click a service card, a quick-start tile or a
  Services-tab row for what the audit knows: homepage, type, sign-in
  requirement and current session state, whether the local API can drive it,
  plus open, open the sign-in page, open in browser, copy URL and
  enable/disable.
- **Per-tab browser controls.** Stop and Home join Back/Forward/Reload; Reload
  swaps to Stop while a page is loading, and Home returns the tab to its
  audited service homepage. New shortcuts: `Ctrl+Shift+R` (reload ignoring the
  cache, also Shift-click on the reload button), `Esc` (stop loading),
  `Alt+←` / `Alt+→` (back / forward) and `Alt+Home`. The tab context menu gains
  back, forward, stop, reload-ignoring-cache and home.
- **One-click build scripts.** `npm run one-click-build` (plus `BUILD.bat` and
  `BUILD.sh` at the repository root) checks Node, installs dependencies and the
  Electron runtime, regenerates the service catalogue, runs lint + tests and
  builds the installer, listing the artefacts and their sizes. Flags: `--all`,
  `--win` / `--mac` / `--linux`, `--dir`, `--fast`, `--publish`.
  `scripts/windows/Build.ps1` now delegates to it.

- **Settings backup.** Export your preferences and enabled services to a JSON
  file, import them on another machine, or reset everything to defaults
  (**Settings ▸ Privacy ▸ Backup**). The export deliberately excludes the local
  API key, cookies and machine-specific state, and an imported file is
  sanitised like any other untrusted input.
- **Reopen closed tab** (`Ctrl+Shift+T`, also in the tab context menu), which
  restores the tab's URL, zoom and mute state. The last 10 are remembered.

### Fixed

- **`strictBlocking` silently disabled the local API.** The API's hidden windows
  never registered an allow-list with the request filter, so under strict mode —
  which is fail-closed for unattributed requests — every request they made was
  rejected. They now register the same allow-list a visible tab gets, so they
  are filtered rather than trusted.
- **Headless server exited 0 on failure.** `app.quit(1)` ignores its argument;
  a server that failed to start reported success to systemd, Docker and CI. Now
  uses `app.exit(1)`.
- **Favicon misses were cached forever.** A single failed lookup (offline at
  launch, a flaky CDN) meant the icon never returned until restart. Misses now
  expire after 6 hours.
- **Stale tab state after navigation.** `did-navigate` notified the renderer
  with the tab record captured at view creation, so a replaced record sent the
  old URL and back/forward flags.
- **Toast storm on blocked requests.** A tracker-heavy page produced one toast
  per blocked request; hosts are now coalesced into one summary toast.
- Accessibility: the status bar, blocking indicator and tab counter announce
  changes (`role="status"`, meaningful `aria-label`s), and the shortcuts dialog
  now moves focus into itself and restores it on close.

### Changed

- Migrated off the navigation APIs deprecated in Electron 30
  (`canGoBack`/`goBack` → `contents.navigationHistory`), with a fallback for
  older runtimes.
- Login-state events no longer rebuild the settings catalogue when the settings
  drawer is closed — repaints are scoped to what is actually on screen.
- `get-services` returns the service list enriched with catalogue data
  (homepage, login URL, auth domains, icon), and `get-favicon` serves the
  cached icon before falling back to the live fetcher.
- New IPC channels: `get-service-details`, `nav-reload-hard`, `nav-stop`,
  `nav-home`.

## [1.5.0] - 2026-09-15

### Added

- **More no-login services.** Duck.ai, Phind, Blackbox AI and DeepAI Chat join
  the catalogue with domain rules, login fingerprints and DOM adapters, each
  flagged `requiresLogin: false` — 20 services, 109 published models.
- **Free services are separated from sign-in ones.** The catalogue now carries a
  `requiresLogin` flag (6th tuple slot, or `requiresLogin: false` on an object
  entry); services that answer without an account are badged *No sign-in* in the
  sidebar and the Services tab, get their own **Sign-in needed** filter
  (`free` / `signin`, with facet counts) and a "Free first" sort.
- **Headless API server.** `RUN-SERVER.bat` (repo root),
  `scripts/windows/RunServer.bat` and `npm run serve` start the local API with no
  window, no tray and no updater: `--headless` / `--api-only` / `--no-gui`,
  `--port <n>`, `--print-key`, `--quiet`, `AIHUB_HEADLESS=1`, Ctrl+C to stop. The
  console prints the base URL, the key and a ready-to-paste `curl` example.
- **Every model is published.** `GET /v1/models` lists one entry per service
  *and* one per upstream model (`aihub/gemini:gemini-2.5-flash`), each with
  `owned_by` (openai, google, anthropic, …) and a one-line `description`. Bare
  upstream names (`gpt-5`, `claude-sonnet-4-5`) route to the service that owns
  them. Free services are listed and are `ready` before you sign in to anything.
- **Typed answers.** Responses now describe what an answer is made of:
  `aihub.content.segments` splits it into `thinking`, `code` (with language),
  `link` (with url + label), `table`, `list`, `heading`, `quote` and `text`;
  reasoning is mirrored to `reasoning_content`; streaming annotates each delta
  (`aihub.segment`, `aihub.segmentEvent`) and sends reasoning deltas to
  `reasoning_content` instead of `content`.

### Changed

- Adapter overrides now merge `dom`/`api` field by field with the `default`
  entry, so a partial override (only `answer`, say) keeps the inherited
  `composer` instead of silently losing the driver.
- **The local API is on by default** (`apiEnabled: true`) and a random
  `aihub-<hex>` key is generated the first time the config is read, so the
  endpoint works immediately instead of after a settings detour.
- Free services no longer need a session: the engine drives them anonymously
  instead of failing with `session_unavailable`.

## [1.4.0] - 2026-09-14

### Added

- **Login detection and stable sessions.** Each service's sign-in state is now
  classified from its own session cookies (with URL and page hints), kept in sync
  live as cookies change, and surfaced in the sidebar, the Services tab and a new
  Sessions settings tab.
- **Re-login on open.** A service that was signed in last session but has since
  expired gets its sign-in page reopened at launch instead of failing silently.
- **Cookie and browser-data cache.** Session cookies are re-stamped so Chromium
  persists them across restarts, snapshots are kept per service (`0600`,
  encrypted via `safeStorage` when available) and replayed before the first
  navigation. A background keep-alive ping rolls warm sessions forward.
- **Per-service profiles (opt-in).** `persist:aihub-<id>` partitions, plus
  "clear this service only" without touching anyone else's login.
- **Anti-bot hardening.** `AutomationControlled` is disabled at the Blink level;
  the Electron/app UA tokens are stripped and aligned with `Sec-CH-UA*` client
  hints and `Accept-Language`; a main-world patch (CDP, before page scripts)
  normalises `navigator.webdriver`, `userAgentData`, plugins, `window.chrome`,
  WebGL vendor strings and screen metrics from a *stable* seeded profile; bot
  challenges are waited out with jittered backoff, and typed input uses a human
  cadence. Canvas noise exists but is off by default.
- **Local OpenAI-compatible API** (off by default): `GET /v1/models`,
  `POST /v1/chat/completions` (buffered + SSE streaming) and the legacy
  `POST /v1/completions` on `127.0.0.1`, answered by the logged-in sessions —
  either by replaying a service's own endpoint with its cookies or by driving a
  hidden, sandboxed window. Loopback-only, bearer-key guarded, no CORS, rate and
  concurrency limited, cancellable, adapter data overrideable in
  `data/adapters.json`.
- **Filters and sorting in Settings ▸ Services.** Search now spans name, type, id,
  privacy note and URL, with type/status/sign-in facets (each showing live counts),
  sorting by name, type, enabled state, sign-in state, recency or cached cookies,
  a direction toggle and a clear-filters control. The choice persists.

### Changed

- "Clear session data" in Settings ▸ Privacy now clears *caches* and leaves you
  signed in; signing out of everything moved to Sessions, where it also removes
  the cached snapshots.
- The service picker shows a per-service sign-in dot; rows in the Services tab
  show cached cookie counts and token expiry, with a Sign in shortcut.

### Docs

- New [sessions.md](../docs/sessions.md) and [local-api.md](../docs/local-api.md);
  configuration, IPC, architecture and security pages updated.

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
