# Design system — Liquid Glass

The shell UI (`ui/`) follows a single token-driven **Liquid Glass** language:
translucent surfaces that refract an ambient backdrop, a strict spatial
hierarchy, and motion that explains a state change instead of decorating it.

This document is the source of truth for extending it. Do not introduce ad-hoc
colours, radii, shadows or timings in component CSS.

## Principles

Calm, spatial, readable. Glass creates depth, not decoration:

- Content stays **opaque** and high-contrast; only surfaces are translucent
- Chrome (header, drawers, status bar, floating UI) **refracts** an ambient backdrop
- Depth comes from three things used together — fill density, blur strength and a
  soft ambient shadow — never from a heavy shadow alone
- Motion is fast in response, smooth in motion: 90–150ms micro, 240–360ms
  standard, ~440ms for dialogs
- Everything collapses under `prefers-reduced-motion`
- Restraint: soft edges, low-contrast ambient fields, no neon, no glow

The product should feel **premium and native**, not like generic glassmorphism.
Original artwork only — never copy another vendor's assets, icons or exact
component shapes.

## Tokens (`ui/styles.css` `:root`)

Every value the shell can express lives here. Component rules compose tokens.

| Group | Tokens | Notes |
|-------|--------|-------|
| Type | `--font-sans/--font-mono`, `--fs-display…--fs-meta`, `--lh-tight/body/relaxed`, `--tracking-tighter/tight/normal/wide` | SF/system stack |
| Radius | `--r-1…--r-6` (4–9px), `--r-sm…--r-2xl`, `--r-pill` | `--r-1…--r-6` cover nested geometry (avatars, favicons, chips, context items) so component rules never need a raw pixel radius. Inner radius ≈ outer − padding keeps corners concentric. |
| Space | `--sp-1…--sp-7` | |
| Motion | `--t-instant/fast/med/slow/modal`, `--t-ambient`, `--ease-out/inout/spring/soft/emphasized` | transform/opacity only |
| Layers | `--z-bg`, `--z-content`, `--z-panel`, `--z-nav`, `--z-popover`, `--z-dialog`, `--z-toast` | strictly increasing |
| Glass fill | `--glass-1/2/3/float/hover/active`, `--glass-sm/md/lg` | four strengths (see below) |
| Glass edge | `--glass-border(-strong)`, `--hairline`, `--glass-edge(-strong)` | 1px translucent border + top edge highlight |
| Blur | `--blur-1/2/3/veil/ambient/0`, `--blur-sm/md/lg` | `-sm/md/lg` are the named aliases, `-0` exists so a blur can be *animated in*; ambient field blur steps down on mobile |
| Depth | `--elev-1..--elev-4` (aliases `--shadow-1/2/3/float`) | ambient, never black-heavy |
| Field | `--field-bg`, `--field-bg-strong` | inputs, code, segmented controls |
| Colour | `--bg-0/1/2`, `--text-1/2/3`, `--accent`, `--accent-2`, `--accent-soft`, `--accent-line`, `--on-accent`, `--ok/--warn/--err` (+ `-soft`), `--separator`, `--scrim`, `--focus`, `--focus-ring` | dark by default, `body.light-mode` overrides |
| Backdrop | `--field-a/b/c`, `--grain-opacity` | ambient colour fields |
| Layout | `--header-height`, `--tabs-height`, `--status-height`, `--nav-height`, `--shell-pad`, `--shell-gap`, `--stage-top`, `--ctrl`, `--ctrl-sm`, `--ctrl-lg`, `--hit` | `--header-height`/`--tabs-height`/`--status-height` are the metrics reported to the main process by `src/constants.js#LAYOUT`; `--nav-height` is the whole floating bar and `--stage-top` is where the stage (and any edge-anchored drawer) begins below it |
| Runtime | `--px`, `--py` | written per card by `ui/services.js`, read by the card sheen |

Layout metric changes must be mirrored in `src/constants.js` and
`src/window.js`; both files compute window and view geometry from them.

## Materials

Four reusable strengths, plus the transient hover wash. Compose these instead of
inventing a fifth translucency:

| Material | Utility class | Tokens | Use |
|----------|---------------|--------|-----|
| **Small** | `.glass-sm` | `--glass-sm` + `--glass-edge` | light list chrome, chips, secondary fills |
| **Medium** | `.glass-md` | `--glass-md` + `--blur-md` + `--elev-2` | primary structural surfaces |
| **Large** | `.glass-lg` | `--glass-lg` + `--blur-lg` + `--elev-3` | floating objects: dialogs, menus, toasts |
| **Tinted** | `.glass-tint` | `--glass-3` + `--accent-line` | contextual accent surfaces |
| **Hover** | — | `--glass-hover` | transient pointer highlight on rows and buttons |

The utility classes exist for new components and for prototypes. The shipping
surfaces in this stylesheet declare the same tokens directly, because a static
utility cannot express the state-dependent parts of the language (the header
deepening on scroll, a card lifting on hover, a drawer animating in). If you add
a surface, express its states with tokens rather than adding a fifth utility.

Backdrop blur is applied to **structural surfaces** and **floating objects**
(header, drawers, status bar, menus, dialogs, toasts, find bar). The service
picker stays row-first: entries are clear at rest and receive a restrained
surface on hover or selection. Decision cards use translucent fills with an
edge highlight and no per-item blur, so a long list cannot turn into dozens of
animated blur layers.

## Spatial layers

```
0  .app-bg            ambient fields + grain          --z-bg
1  .app-container     shell, main row, content        --z-content
2  panels             sidebar, settings drawer (in-layout, not overlays)
3  .app-header        navigation + tab strip          --z-nav
4  popovers           context menus, find bar         --z-popover
5  dialogs            modal backdrop + dialog         --z-dialog
6  toasts             notifications                   --z-toast
```

**Important:** child `WebContentsView`s always paint above the shell
webContents, so nothing in the renderer can overlay the tab content. The sidebar
collapses its grid column instead of floating over the stage, and the settings
drawer is a fixed panel anchored to the stage — never a scrim over the service
you are reading.

Two rules keep those surfaces from fighting over the same pixels:

- **Grid placement is explicit.** `.sidebar` is `grid-column: 1` and
  `.main-content` is `grid-column: 2`. Auto-placement is not an option here: a
  collapsed drawer is `display: none`, which removes it as a grid item, and the
  stage would then be placed in the zero-width first column.
- **A drawer never covers the chrome.** Anything anchored to the window edge
  (settings drawer, find bar) starts at `--stage-top`, the line where the
  sidebar and the web view begin. The navigation bar stays visible and usable
  while the drawer is open. The one exception is the ≤640px phone layout, where
  the drawer becomes a full-bleed sheet and moves up to `--z-dialog` so the nav
  cannot paint over its header.
- **A closed dialog is inert.** `.modal-backdrop` fades out *and* sets
  `visibility: hidden` + `pointer-events: none`; `.visible` restores both.
  Transparency alone is not closed — an invisible sheet that still spans the
  window swallows every click on the shell behind it and leaves its buttons in
  the tab order.

## Backdrop

`.app-bg` holds:

1. A quiet dual radial wash on a deep gradient base
2. Three large, pre-blurred colour fields (`--blur-ambient`) that drift slowly (`--t-ambient`)
3. Near-invisible grain, blended to prevent banding

Fields stay below ~20% opacity: they should be almost invisible until a glass
surface moves over them. No saturated blobs, no animated gradients. The ambient
blur drops at the phone breakpoint to reduce compositor cost.

## Typography

- Display titles: 32px, weight 650, tight tracking (`--tracking-tighter`)
- Page titles: 21px (`--fs-headline`); section headings: 16px (`--fs-title`)
- Section labels: 11px uppercase, wide tracking, muted
- Body: 14px with 1.5 line-height; supporting copy: 13px
- Metadata: 12px, muted but still AA contrast

Never put translucent text on glass: text uses `--text-1/2/3` only, and
`--text-3` is tuned to measure ≥4.5:1 against the base surfaces in both themes.

## Motion

| Kind | Tokens | Easing |
|------|--------|--------|
| Micro (hover, press, focus) | `--t-instant` … `--t-fast` (90–150ms) | `--ease-out`, `--ease-spring` |
| Standard (tabs, drawers, popovers) | `--t-med` … `--t-slow` (240–360ms) | `--ease-spring`, `--ease-soft` |
| Dialog / page | `--t-modal` (440ms) | `--ease-spring` |
| Ambient backdrop | `--t-ambient` (26s) | `--ease-inout` |

Patterns:

- **Enter/exit asymmetry.** Entrance transitions live on the `.visible` state and
  exit transitions on the base state, so a surface can arrive softly and leave
  quickly. The JS removal timers (`ui/overlays.js`: 220ms for a toast, 180ms for
  a dialog) are deliberately shorter than nothing and longer than the exit
  transition — keep the two in sync if you change either.
- **Gliding indicators** (`.tab-glide`, `.settings-glide`) track the active item
  via `ui/motion.js`. They carry no `backdrop-filter`: a blur travelling on every
  tab switch costs more than it shows. `ui/motion.js` owns their transform and
  inserts them as the container's first child, so their CSS origin must stay at
  `0,0`.
- **Scroll density**: `is-scrolled` on `.sidebar-header` / `.panel-header`,
  `is-dense` on `.app-header` — the nav deepens as content passes under it.
- **Dialogs**: backdrop fade + blur in, dialog rises 12px and scales 0.96→1.
- **Menus / popovers / toasts**: fade + 4–8px translate + 0.97–0.98 scale.
- **Press**: scale ~0.97 with no bounce; **hover**: ≤1px lift plus a soft
  highlight.
- **Card sheen**: `--px`/`--py` follow the pointer inside a service card, written
  by one delegated, rAF-throttled listener for the whole list.
- No animation loops in JS, and no continuous animation over a large area: the
  backdrop drift is the only long-running animation, and it is transform-only.

## Dark & light

Both themes are first-class. Light mode is not an invert: brighter neutrals,
stronger white edge highlights, softer shadows, and reduced border contrast.
Toggle via Settings → Dark mode (`body.light-mode`). Glass must stay visible in
both — never a bright white panel in dark mode, never a grey slab in light mode.

## Icons

One family, defined in `ui/icons.js` and built with `createElementNS` (never
`innerHTML`, per the repo rule). Every glyph sits on a 24x24 grid with a 1.75
stroke, round caps and joins, and inherits `currentColor`.

```js
el.appendChild(app.icon('success', 16));   // name, pixel box
```

Call `app.icon()` rather than pasting SVG markup into a component: hand-rolled
strings drift in stroke weight and box size, which is exactly what makes an
interface look assembled from parts. The few icons in `ui/index.html` (brand
mark, nav cluster, tip glyphs) are static markup drawn to the same grid and
stroke weight; `tests/design-system.test.js` fails the build if raw `<svg`
markup appears in the renderer scripts or if an HTML glyph drifts off 1.75.

## Loading and empty states

Skeletons (`.skeleton`, `.skeleton-row`, `.skeleton-avatar`, `.skeleton-line`)
mirror the geometry of the content they stand in for — avatar box plus two text
lines for a service row — so the swap to real content costs no layout jump. The
pulse is opacity-only over a small area (cheap and calm, no shimmer sweep), and
each row offsets the cycle by its index so the list breathes in sequence. The
sidebar paints them during boot, before the catalogue resolves.

Empty states pair one icon from the shared family, a short explanation and at
most one action.

## Responsive behaviour

Breakpoints adapt behaviour, not just sizes:

- **≤1180px** — the sidebar narrows to 272px and tabs tighten.
- **≤900px** — shell padding drops, tab strip tightens, tips stack, the About
  grid narrows.
- **≤640px** — the service picker takes the whole row instead of leaving a
  sliver of web view; the settings drawer becomes an edge-to-edge sheet that
  outranks the nav bar (`--z-dialog`); dialogs stack their actions; the find bar
  moves to the bottom (thumb reach); the welcome stage safe-centres short copy
  and scrolls taller content from the top; the tab count and badges drop; radii
  step down one notch.
- **Coarse pointers / no hover** — hover-only affordances (close-tab, add
  service) become permanently visible and hit targets grow to 40px.

Blur is the most expensive part of this language and the least affordable on
mobile GPUs, so structural `--blur-*` levels and the ambient field blur step
down at ≤640px rather than the material being dropped: the design survives,
the compositor keeps up.

## Accessibility

- Visible `:focus-visible` rings (`--focus-ring`, `--focus` on inputs); inputs
  keep their own ring instead of stacking a second outline
- WCAG-minded text tokens: metadata measures ≥4.5:1 in both themes
- Keyboard reachable controls with `aria-label`s; native `<button>`/`<input>`
  elements so focus, Enter/Space and screen readers work without extra JS
- Semantic roles on tabs, menus, dialogs and the status region
- `prefers-reduced-motion` removes movement, keeps state changes: durations
  collapse to 0.01ms and transform-based effects (drift, press-scale) are
  switched off rather than merely shortened, while colour and opacity changes
  still land — including `transition-delay`, or staged reveals would withhold
  content permanently
- `forced-colors` swaps translucency for system colours so structure survives

## Reviewing your work

`npm run preview:shell` serves `ui/` over HTTP with a stubbed `window.electronAPI`
built from the real catalogue, so the shell can be inspected without launching
Electron: `?light` for the light theme, `?surface` to place a stand-in where the
native view paints. It is a preview only — it stubs IPC, opens no
`WebContentsView` and never touches config or sessions on disk. Check every
breakpoint (1440 / 1180 / 900 / 640 / 420 wide), both themes and every state you
touched: hover, focus, disabled, loading, empty, error.

## Extending

1. Prefer an existing material or utility over a new rule
2. Compose tokens; document new patterns here
3. Never hand-write `backdrop-filter`, `box-shadow`, radius or transition values
   — reuse tokens
4. Keep text opaque; only surfaces are translucent
5. Respect reduced motion and focus rings
6. Avoid glass-everywhere: if a surface does not need depth, keep it flat. Cards
   are for decisions; rows are for lists
7. Use `app.icon()` for glyphs; never paste SVG markup into a component
8. Build DOM with `createElement` — never `innerHTML` for dynamic data

## Enforcement

`tests/design-system.test.js` is the guard against drift — the slow slide from a
design system back into individually styled components. It asserts that:

- every token the stylesheet references is actually defined (no dangling `var()`)
- the seven spatial layers stay strictly ordered
- component rules use radius, blur and motion **tokens**, not magic numbers
- `prefers-reduced-motion` and `forced-colors` support is present, and the small
  screen block steps blur down
- core navigation controls are never `display: none` on small screens
- the icon family stays single-source, `innerHTML`-free and on one stroke weight

`tests/renderer-boot.test.js` additionally asserts the script list it boots
matches the one `index.html` loads, in order — that pair silently drifted once.
