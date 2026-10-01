# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **The shell is a Liquid Glass interface.** `ui/styles.css` was rebuilt around a
  material system instead of per-component styling: four translucency strengths
  (`sm`/`md`/`lg` plus a tinted accent surface), a named blur ladder, an ambient
  backdrop the glass refracts, seven explicit depth layers (`--z-bg` …
  `--z-toast`) and one motion vocabulary (90ms micro to 440ms dialogs). Navigation
  is now a floating element that deepens as content scrolls beneath it, the
  active tab is a pill that glides between tabs, and floating UI opens from the
  control that owns it.
- **Every screen was redesigned, not just the first one.** Sidebar, service
  picker, welcome stage, settings drawer (all six tabs), services manager,
  sessions, API panel, About, status bar, find bar, context menus, dialogs and
  toasts share one visual language — lists are rows, cards are reserved for
  decisions, and metadata is grouped rather than boxed.
- **`npm run preview:shell`.** Serves `ui/` over HTTP with a stubbed
  `window.electronAPI` built from the real catalogue, so the renderer can be
  reviewed in a browser (`?light`, `?surface`) without launching Electron.
  Preview only: it stubs IPC and never touches config or sessions on disk.
- **Motion that explains state.** Pointer-tracked highlight inside service cards
  (one delegated, rAF-throttled listener), digit-roll on the tab counter, glide
  indicators on tabs and settings segments, skeleton rows that breathe in
  sequence, and enter/exit asymmetry so surfaces arrive softly and leave fast.
- **A reduced-motion path that keeps state changes.** Movement is switched off
  rather than merely shortened, while colour and opacity changes still land.

### Changed

- **Dark and light are both first-class.** Light mode is no longer an inversion:
  brighter neutrals, stronger white edge highlights, softer shadows and reduced
  border contrast, with glass visible in both themes.
- **Muted text meets WCAG AA.** `--text-3` measured ~2.9:1 against the base
  surfaces; it now measures ≥4.5:1 (`5.2:1` dark, `4.85:1` light) so hints,
  metadata and section labels stay readable.
- **Indicators no longer carry `backdrop-filter`.** A blur travelling on every tab
  switch cost more than it showed; the glide pill keeps its fill, border and edge
  highlight and drops the blur.
- **Mobile steps blur down instead of dropping the material** (`--blur-*` at
  ≤640px), the service picker takes the whole row rather than leaving a sliver of
  web view, the find bar moves to the bottom for thumb reach, and the settings
  drawer goes edge-to-edge.

### Fixed

- **The first painted frame no longer covers the navigation bar.** The view
  bounds fallback in `src/window.js` (used until the renderer reports the real
  `#webviews-container` box) assumed a full-bleed viewport: it ignored the shell
  padding, the gaps and the tab strip's hairlines, so the native view started
  22px too high and 50px too tall. It now derives the same stage rectangle the
  stylesheet builds, from `LAYOUT.SHELL_PAD`/`LAYOUT.NAV_HEIGHT`/`LAYOUT.SHELL_GAP`
  (a test pins the arithmetic).

- **The stage collapsed to a 2px sliver when no service was open.** The sidebar
  and the stage were grid-auto-placed, so a collapsed sidebar (`display: none`,
  and therefore not a grid item) pushed the stage into the zero-width first
  column. The welcome screen had 2px to render in and the window looked empty
  until you opened a tab. Both columns are now placed explicitly
  (`.sidebar` → column 1, `.main-content` → column 2), which also gives the
  renderer honest `#webviews-container` bounds to report to the main process.

- **The settings drawer overlapped the navigation bar and lost to it.** It was
  anchored to the window edge at `--z-panel`, *below* the nav's `--z-nav`, so
  the drawer's title, its close button and the top of its segmented control were
  painted under the header and tabs — visible only where the nav is translucent,
  and unclickable. The drawer now starts at `--stage-top`, clear of the chrome,
  alongside the sidebar and the web view. On phones, where it is deliberately a
  full-bleed sheet, it moves up to `--z-dialog` so its own header stays on top.

- **Clicking anywhere in the window did nothing once the shortcuts dialog had
  been opened and closed.** `ui/shortcuts.js` toggled `hidden` while the
  stylesheet only reacted to `visible`; the `hidden` rule was never written, so
  the closed backdrop stayed `display: flex` at full window size, transparent
  but hit-testable, and ate every click. Closing now also sets
  `visibility: hidden` and `pointer-events: none` (with `.visible` restoring
  both), so a closed dialog is inert instead of merely invisible — and its
  buttons are out of the tab order while it is closed.

- **The settings segmented control clipped its own labels in a short window.**
  It scrolls horizontally, so its automatic minimum size is 0 and the flex
  column squeezed it until the tab labels were cut in half. The header and the
  segmented control are now fixed-height furniture and only the scrollable
  content below them shrinks.

- **Unstyled component classes.** `service-group-title`, `services-manager` and
  the `is-signin` group modifier were rendered by the shell with no rules behind
  them; every class the renderer can produce now has a definition.

- **The window remembers where it was.** Size, position and maximized state are
  persisted and restored on the next launch — validated against the attached
  displays first, so a window saved on a monitor you have since unplugged opens
  at the default size instead of off-screen (`src/windowstate.js`).
- **App shortcuts work inside a service tab.** A `WebContentsView` owns the
  keyboard, so `Ctrl+W`, `Ctrl+Tab`, `Ctrl+F`, `Ctrl+R` and friends used to stop
  working the moment you clicked into a chat. Recognised accelerators are now
  replayed against the shell over the new `app-command` channel
  (`src/accelerators.js`); everything a site owns — typing, `Esc`, `Ctrl+A/C/V`,
  editor chords — is left untouched.
- **Actionable toasts.** Toasts can carry one button, and a crashed tab now
  offers **Reload** instead of only reporting the crash; the tab is flagged in
  the strip until it loads again.
- **`src/logger.js` as the single logging entry point.** One place configures
  levels, the 5 MB rotation cap and the file permissions, with a no-op fallback
  for a partial backend.

### Fixed

- **Domain-filter bypass through a look-alike hostname.** The "internal URL"
  test (the escape hatch for the app shell, `blob:`/`data:` and loopback) used
  `String.startsWith`, so `http://localhost.evil.com/` — a public domain that
  merely begins with `localhost` — was classified as internal and skipped the
  per-tab allow-list entirely. It now compares the parsed hostname, and
  `127.0.0.0/8` / `.localhost` are recognised as loopback.
- **Logging could break the domain filter.** Thirteen modules imported
  `electron-log` directly instead of `src/logger.js`, so any backend that was
  missing a level (an offline install, a unit-test mock, an older runtime) made
  `updateTabDomains()` throw a `TypeError` instead of returning an allow-list.
  Everything now goes through the wrapper, which forwards a level only when it
  exists and never lets the backend break the caller. This was why the project's
  own Jest suite was red on `main`.
- **IPv6 loopback clients were rejected by the local API.** `Host: [::1]:8788`
  was split on the first colon, leaving `"["` to compare against the allow-list.
- `get-favicon` accepted any URL from the renderer; only `http(s)` is fetched
  now, which keeps the main process from opening a socket on the renderer's
  behalf.
- `get-limits` reported the open tab count under the key `maxTabs`; it now
  returns `{ openTabs, limit, minTabs, hardMax }`.
- Removed the duplicate `.toast-*` tint rules from the stylesheet and the
  unused `tab-loading` / `app-log` IPC constants.
- A stale blocking test asserted that a destroyed tab's requests are blocked;
  the documented policy is fail-open for unattributed webContents (fail-closed
  under `strictBlocking`), and the test now pins both behaviours.

### Changed

- **Less disk churn while browsing.** The tab record list is serialized and
  compared before writing, so a navigation that does not change the persisted
  shape skips the synchronous store write; the tray menu is only rebuilt when
  the open tabs actually change.
- Window geometry is written on close/hide as well as on quit, so the position
  survives even when `will-quit` runs after the window is gone.
- The log file is created `0600` on POSIX (it names services, hosts and paths),
  and native widgets follow the theme via `color-scheme`.

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

- **Shared icon system** (`ui/icons.js`). One geometric family on a 24px grid
  with a single stroke weight, built with `createElementNS`. Replaces the text
  characters that stood in for toast icons (`i`, `✓`, `×`) and the hand-rolled
  SVG strings that had drifted apart in size and weight.
- **Skeleton loading states** for the service sidebar, shaped like the rows they
  replace so the first paint has structure and content lands without a jump.
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
- `prefers-reduced-motion` now zeroes `transition-delay` as well as duration.
  Staged reveals would otherwise withhold content permanently instead of simply
  appearing without animation.
- Accessibility: the status bar, blocking indicator and tab counter announce
  changes (`role="status"`, meaningful `aria-label`s), and the shortcuts dialog
  now moves focus into itself and restores it on close.

### Changed

- **Design-system polish.** Every remaining raw pixel radius is now a token
  (`--r-1…--r-6` cover nested geometry), modal content fades in a beat after the
  surface, and toast badges tint to match their meaning.
- **Intentional mobile behaviour.** Back/forward/reload are no longer hidden at
  ≤640px — they were `display: none`, which left no way to navigate; only Home
  drops, since the sidebar covers it. Touch targets grow to 40px on coarse
  pointers, hover transforms are suppressed there, and `--blur-*` steps down on
  small screens so mobile GPUs keep up without losing the material.
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
