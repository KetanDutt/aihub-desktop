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
| Radius | `--r-xs…--r-2xl`, `--r-pill` | |
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

## Accessibility

- Visible `:focus-visible` rings (`--focus`)
- WCAG-minded contrast on text tokens
- Semantic roles on tabs, menus, dialogs
- `prefers-reduced-motion` kills decorative motion
- `forced-colors` fallbacks keep structure readable

## Extending

1. Prefer an existing material/utility over a new rule
2. Compose tokens; document new patterns here
3. Never hand-write `backdrop-filter` / `box-shadow` values — reuse tokens
4. Keep text opaque; only surfaces are translucent
5. Respect reduced motion and focus rings
6. Avoid glass-everywhere: if a surface doesn't need depth, keep it flat
