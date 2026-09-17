# Design system — Liquid Glass

The shell UI (`ui/`) follows a single token-driven **Liquid Glass** language.
This document is the source of truth for extending it; do not introduce ad-hoc
colours, radii, shadows or timings in component CSS.

## Principles

Calm, spatial, readable. Glass creates depth, not decoration:

- Content stays **opaque** and high-contrast
- Chrome (header, drawers, status bar, floating UI) **refracts** an ambient backdrop
- Motion communicates state and is fast (90–240ms micro, ~440ms modals)
- Everything is disabled under `prefers-reduced-motion`
- Prefer restraint: soft edges, low-contrast ambient fields, no neon or heavy shadows

The product should feel **premium and native**, not like generic glassmorphism.

## Tokens (`ui/styles.css` `:root`)

| Group | Tokens | Notes |
|-------|--------|-------|
| Type | `--font-sans/--font-mono`, `--fs-display…--fs-meta`, `--lh-*`, `--tracking-*` | SF/system stack |
| Radius | `--r-1…--r-6` (4–9px), `--r-sm…--r-2xl`, `--r-pill` | `--r-1…--r-6` cover nested geometry (avatars, favicons, inner chips) so component rules never need a raw pixel radius. Inner radius ≈ outer − padding keeps corners concentric. |
| Space | `--sp-1…--sp-7` | |
| Motion | `--t-instant/fast/med/slow/modal`, `--ease-out/inout/spring/soft` | transform/opacity only |
| Layers | `--z-bg … --z-toast` | 7-level spatial hierarchy |
| Glass | `--glass-1/2/3/float/hover`, `--glass-border(-strong)`, `--glass-edge(-strong)`, `--blur-1/2/3/veil` | material strengths |
| Depth | `--shadow-1/2/3/float` | ambient, never black-heavy |
| Colour | `--bg-0/1`, `--text-1/2/3`, `--accent`, `--accent-2`, `--accent-soft`, `--ok/--warn/--err`, `--separator`, `--scrim` | dark + `body.light-mode` |
| Layout | `--header-height`, `--tabs-height`, `--status-height`, `--ctrl` | keep in sync with `src/constants.js` |

## Materials

| Material | Tokens | Use |
|----------|--------|-----|
| **Primary** | `--glass-1` + `--blur-1` | Header, settings drawer, status bar |
| **Secondary** | `--glass-2` + `--blur-2` | Sidebar list chrome, tabs area, cards, secondary buttons |
| **Tinted** | `--glass-3` / `--accent-soft` | Contextual accent chips, tip icons |
| **Float** | `--glass-float` + `--blur-3` + `--shadow-float` | Dialogs, menus, toasts, find bar |
| **Hover** | `--glass-hover` | Transient highlight on buttons/list rows |

Backdrop blur is applied to **structural surfaces** (header, drawers, floating
UI). Cards use translucent fills + edge highlight without per-card blur so the
UI stays performant.

## Spatial layers

```
0  .app-bg          ambient fields + grain
1  .app-container   main shell
2  drawers          sidebar / settings (in-layout, not overlays)
3  .app-header      navigation + tab strip + status
4  popovers         context menus, find bar
5  dialogs          confirm + shortcuts modal
6  toasts
```

**Important:** child `WebContentsView`s paint above the shell webContents.
Sidebar and settings are flex drawers that collapse width — never absolute
overlays over the tab content.

## Backdrop

`.app-bg` holds:

1. A quiet dual radial wash on a deep gradient base
2. Three large, heavily blurred colour fields that drift slowly
3. Near-invisible grain to prevent banding

Keep fields low-opacity. Content must remain the visual priority.

## Typography

- Display titles: large, tight tracking, weight 650–700
- Section labels: 11px uppercase, wide tracking, muted
- Body: 13.5px, comfortable line-height
- Metadata: 11px, muted

Never put translucent text on glass. Text uses `--text-1/2/3` only.

## Motion

| Kind | Duration | Easing |
|------|----------|--------|
| Micro (hover, press) | 90–150ms | spring / out |
| Standard (tabs, drawers) | 150–360ms | spring / inout |
| Modal open/close | ~440ms | spring |

Patterns:

- **Gliding indicators** (`.tab-glide`, `.settings-glide`) track the active item via `ui/motion.js`
- **Scroll density**: `.is-scrolled` / `.is-dense` on headers
- **Dialogs**: backdrop fade + scale 0.97→1 + rise
- **Menus / toasts**: fade + slight translate/scale
- **Press**: scale ~0.97, no bounce

## Dark & light

Both themes are first-class. Light mode is not an invert: warmer neutrals,
softer shadows, stronger white edge highlights. Toggle via Settings → Dark mode
(`body.light-mode`).

## Icons

One family, defined in `ui/icons.js` and built with `createElementNS` (never
`innerHTML`, per the repo rule). Every glyph sits on a 24x24 grid with a 1.75
stroke, round caps and joins, and inherits `currentColor`.

```js
el.appendChild(app.icon('success', 16));   // name, pixel box
```

Call `app.icon()` rather than pasting SVG markup into a component: hand-rolled
strings drift in stroke weight and box size, which is exactly what makes an
interface look assembled from parts. `tests/design-system.test.js` fails the
build if raw `<svg` markup reappears in the renderer scripts.

## Loading and empty states

Skeletons (`.skeleton`, `.skeleton-row`) mirror the geometry of the content they
stand in for — avatar box plus two text lines for a service row — so the swap to
real content is a crossfade with no layout jump. Rows stagger by 80 ms so a list
reads as one surface settling rather than several independent pulses. The
sidebar paints them during boot, before the catalogue resolves.

Empty states pair one icon from the shared family, a short explanation and at
most one action.

## Responsive behaviour

Breakpoints are intentional, not a shrunken desktop:

- **≤900px** — the sidebar narrows, settings go full-width, the window title
  drops out of the header.
- **≤640px** — type and spacing step down; Home is dropped from the nav cluster
  (it is reachable from the sidebar) while back/forward/reload stay, because
  losing them leaves no way to navigate. Toasts and the find bar span the width.
- **Coarse pointers** — hover transforms are suppressed (they stick on touch)
  and hit targets grow to 40px.

Blur is the most expensive part of this language and the least affordable on
mobile GPUs, so `--blur-*` steps down at ≤640px rather than the material being
dropped — the design survives, the compositor keeps up.

## Accessibility

- Visible `:focus-visible` rings (`--focus`)
- WCAG-minded contrast on text tokens
- Semantic roles on tabs, menus, dialogs
- `prefers-reduced-motion` kills decorative motion — including
  `transition-delay`, or staged reveals would withhold content permanently
- `forced-colors` fallbacks keep structure readable

## Extending

1. Prefer an existing material/utility over a new rule
2. Compose tokens; document new patterns here
3. Never hand-write `backdrop-filter` / `box-shadow` values — reuse tokens
4. Keep text opaque; only surfaces are translucent
5. Respect reduced motion and focus rings
6. Avoid glass-everywhere: if a surface doesn't need depth, keep it flat
7. Use `app.icon()` for glyphs; never paste SVG markup into a component

## Enforcement

`tests/design-system.test.js` is the guard against drift — the slow slide from a
design system back into individually styled components. It asserts that:

- every token the stylesheet references is actually defined (no dangling `var()`)
- the seven spatial layers stay strictly ordered
- component rules use radius, blur and motion **tokens**, not magic numbers
- `prefers-reduced-motion` and `forced-colors` support is present
- core navigation controls are never `display: none` on small screens
- the icon family stays single-source and `innerHTML`-free

`tests/renderer-boot.test.js` additionally asserts the script list it boots
matches the one `index.html` loads, in order — that pair silently drifted once.
