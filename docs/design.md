# Design system — Spatial Glass

AI Hub is a working environment for people switching between AI assistants, not
an analytics dashboard. The shell should orient users and then get out of the
way of the provider's content.

## Audit and direction

The previous Liquid Glass system already had a good SVG icon library, explicit
Electron stage geometry, keyboard focus, accessible dialogs, responsive drawers,
and a useful row-first catalogue. These are retained.

Prioritized findings in `ui/styles.css` and `ui/index.html`:

1. **Competing materials:** retain depth but concentrate actual backdrop blur on
   navigation, drawers and floating UI. Individual catalogue rows stay clear;
   launcher items use a translucent fill without per-item blur.
2. **Weak hierarchy:** sentence-case settings headings, higher text contrast and
   consistent group spacing are retained across all six settings sections.
3. **Unnecessary containers:** sessions remain separator-based lists, not a stack
   of glass cards. API logs and model IDs retain their readable dense formatting.
4. **Launcher hierarchy:** retain the concise heading, two-column launcher and
   comfortable targets, now with edge highlights and a restrained 1px hover lift.
5. **Readability:** inactive catalogue names remain opaque. Toggle state, not
   whole-row opacity, communicates whether a service is enabled.
6. **Decorative motion:** ambient fields are static. No continuous background
   drift or card pointer sheen. Existing tab glides, switch transitions, loading
   indicators and dialog transitions communicate actual state changes.

## Identity

**Personality:** calm, technical, spatial. A spatial workbench, not a glossy
AI landing page. **Signature:** the thin blue rule beside the workspace title,
paired with the solid existing hub mark. Real provider icons supply the remaining
visual richness; no stock or generated artwork is needed.

### Palette

| Role | Dark | Light |
| --- | --- | --- |
| Canvas | `#080a0e` | `#f2f4f7` |
| Structural surface | `#0d1016` | `#e9edf2` |
| Raised surface | `#121620` | `#ffffff` |
| Primary text | `#f6f7f9` | `#171a20` |
| Supporting text | `#a8afbb` | `#59616d` |
| Metadata | `#929baa` | `#646c78` |
| Interactive accent | `#91c5ff` | `#146bcf` |

Success, warning and error retain their existing green, amber and red tokens and
textual state labels. Color is never the only state indicator. Opaque surfaces
make text contrast predictable. Borders remain subtle; shadows are reserved for
floating menus, dialogs and notifications.

### Typography and spacing

Use the native system sans stack (no remote font requests), and the existing
monospace stack for endpoints, model IDs and code. Display 32px, page 21px,
section 16px, body 14px, supporting 13px, metadata 12px. Body line height is 1.5;
long helper text uses 1.58. Settings section labels use 14px semibold sentence
case. Numbers in session facts, timings and tab counts are tabular.

Spacing scale: 4, 8, 12, 16, 24, 36, 48px. Group related controls closely; use
24px padding between settings sections. Launcher rows use 16px padding (12px on
phones). Radius aliases are 14/20/28/28/36px; pills are for compact status only.

## Component rules

- Retain existing buttons, SVG icons, focus rings and input validation semantics.
- Primary interaction uses blue, secondary chrome stays neutral.
- Lists use separators and row hover, not a repeated elevated-card treatment.
- Launcher items show real provider icons and a quiet directional arrow.
- Dialogs, menus, toast actions, API controls and find bar retain shared tokens.
- `--glass-*` names are shared material tokens, not individual component colors.
  Text remains opaque and never inherits surface opacity.
- Hover communicates availability through border/fill, not a large lift.
- Transitions explain selection, opening or loading. Reduced-motion and
  forced-color rules remain mandatory. Backdrop fields remain static and deliberately low contrast.

## Material system

| Material | Fill dark / light | Blur | Usage |
| --- | --- | --- | --- |
| Primary (`--glass-1`) | 68% charcoal / 74% cool white | 22px, 145% saturation | Navigation, structural chrome |
| Secondary (`--glass-2`) | 4.5% white / 48% white | 12px when structural | Secondary controls, launcher surfaces |
| Tinted (`--glass-3`) | 10.5% blue / 7.5% blue | Inherits parent | Contextual emphasis |
| Floating (`--glass-float`) | 82% charcoal / 86% cool white | 36px, 155% saturation | Settings, menus, dialogs, toasts |

The `glass-sm/md/lg` utilities compose fill, border, highlight and elevation.
Avoid nested backdrop filters in repeating rows. The background uses broad,
low-opacity ice-blue, slate and warm-neutral fields. Grain remains hidden.
A solid hub mark and the workspace rule provide identity without copying Apple
assets or geometry. Existing SVG icons retain a 24px grid and 1.75px strokes.

Fast hover/press feedback uses 90–160ms; standard state changes use 280ms;
dialog entrances use 400ms. No overshooting bounce. Existing JS owns active-tab
indicators and scroll-density classes; CSS owns material and motion. Closing
timers remain unchanged. Never animate a large blur layer continuously.

Both themes have opaque text tokens and high-opacity floating surfaces. Browsers
without backdrop-filter get opaque surface fallbacks; reduced-transparency
preferences also suppress blur and ambient fields. Reduced motion and forced
colors keep their existing dedicated overrides. Mobile reduces structural blur
and uses a full settings sheet, not a shrunken desktop drawer.

## Electron layout invariants

Never casually change header, tab, status or stage metrics: native
WebContentsViews use those bounds. Keep `src/constants.js` and `src/window.js`
in sync if geometry changes. This refinement leaves those metrics unchanged.

The main stage remains explicitly in grid column 2 and the picker in column 1.
Settings starts at `--stage-top` on desktop, becomes a full sheet above navigation
on phones. Closed dialogs remain hidden and inert. Settings tabs scroll without
shrinking their labels. Phone navigation retains history/reload controls.

## Verification

`npm run check` validates ESLint and the Jest suite, including token completeness,
layering, motion, icon consistency and overlapping-surface regressions.
`npm run preview:shell` serves the complete renderer on port 4317 with explicitly
stubbed Electron APIs; `?light` previews the light theme. It is not a replacement
for a native Electron/provider integration check.

## Attribution

Design review methodology adapted from **Unslop by Damir Sokolovsky (@heydamir)**,
licensed under CC BY 4.0: https://github.com/heydamir/unslop . The workbench
palette, layouts and implementation are specific to AI Hub Desktop.

## User-supplied reference adaptation

The supplied “Ketan Dutt — spatial glass interface” CSS is the visual reference.
Its canvas, ink, blue/violet palette, four material fills, shadows and highlight
tokens are now defined centrally and mapped to AI Hub's existing CSS contracts.
The system uses `body.light-mode`, not `[data-theme="light"]`, because the
existing settings and persisted theme workflow own that class.

The silver hub mark echoes the reference's neutral metallic identity. Desktop
chrome uses generous rounded geometry; compact tabs, switches and favicons retain
smaller concentric radii. Native stage bounds, typography density and touch
navigation are preserved rather than importing a portfolio's 16px body, huge
hero titles, 50px buttons, 1200px shell or section spacing into a desktop tool.

The reference's dark tertiary text was raised from `#77808f` to `#929baa` for
metadata readability. Light danger text is darkened for contrast. Ambient blue,
violet and slate fields remain static for performance. Portfolio-only orbit,
marquee, portrait, timeline, project-grid and cursor-glow selectors are deliberately
not shipped. Opaque fallbacks, reduced motion and reduced transparency continue
to take precedence over decorative material effects.
