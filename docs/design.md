# Design system — Liquid Glass

The shell UI (`ui/`) follows a single token-driven "Liquid Glass" language.
This document is the source of truth for extending it; do not introduce ad-hoc
colours, radii, shadows or timings in component CSS.

## Principles

Calm, spatial, readable. Glass is used to create depth, not decoration: content
stays opaque and high-contrast, while chrome (header, drawers, status bar,
floating UI) refracts an ambient backdrop. Motion communicates state and is
fast (120–220ms) with spring easing for interactive elements; everything is
disabled under `prefers-reduced-motion`.

## Tokens (`ui/styles.css` `:root`)

| Group | Tokens | Notes |
|-------|--------|-------|
| Type | `--font-sans/--font-mono`, `--fs-display…--fs-meta` | SF/system stack; strong hierarchy |
| Radius | `--r-xs…--r-xl`, `--r-pill` | |
| Space | `--sp-1…--sp-6` | |
| Motion | `--t-fast/med/slow/modal`, `--ease-out/inout/spring` | transform/opacity only |
| Layers | `--z-bg … --z-toast` | spatial hierarchy, 7 levels |
| Glass | `--glass-1/2/3/float`, `--glass-border(-strong)`, `--glass-edge`, `--blur-1/2/3` | material strengths |
| Colour | `--bg-0`, `--text-1/2/3`, `--accent`, `--accent-2`, `--ok/--warn/--err` | dark + `body.light-mode` overrides |

## Materials

- **Primary** (`--glass-1` + `--blur-1`): header, settings drawer, status bar.
- **Secondary** (`--glass-2` + `--blur-2`): sidebar, tabs, cards, secondary buttons.
- **Tinted** (`--glass-3`): contextual/accent surfaces.
- **Float** (`--glass-float` + `--blur-3` + `--shadow-3`): dialogs, menus, toasts.

Backdrop blur is applied **only to structural surfaces** (never per-card) to
keep it performant. Cards use translucent backgrounds + edge highlight instead.

## Backdrop

`.app-bg` (layer 0) holds three large, near-invisible drifting radial fields
plus faint grain. It is what gives glass something to refract; keep it subtle.

## Motion

- Gliding glass indicators (`.tab-glide`, `.settings-glide`) track the active
  item via `ui/motion.js` (transform/width/height, spring easing).
- Scroll-aware density: `.is-scrolled` on drawer headers adds blur + border.
- Dialogs scale 0.96→1 and rise; menus/toasts fade + translate.

## Extending

1. Prefer an existing material/utility over a new rule.
2. New component? Compose tokens; add it here if it introduces a new pattern.
3. Never hand-write `backdrop-filter`/`box-shadow` values — reuse tokens.
4. Keep text opaque; only surfaces are translucent.
5. Respect reduced motion and `:focus-visible` (uses `--focus`).
