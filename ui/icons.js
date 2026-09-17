/**
 * Shared icon system.
 *
 * One geometric, single-stroke family for the whole shell, so a toast, an empty
 * state and a toolbar button never look like they came from different kits.
 *
 * Icons are built with `createElementNS` rather than `innerHTML` — the repo
 * rule against `innerHTML` exists to keep untrusted data out of the parser, and
 * building nodes directly means these helpers stay safe even if a caller passes
 * a name that came from data.
 *
 * Every glyph is drawn on a 24x24 grid with a 1.75 stroke, round caps and round
 * joins, and inherits `currentColor` so it takes the colour of its context.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const NS = 'http://www.w3.org/2000/svg';

  /**
   * Path data only — shape is data, presentation is applied uniformly below.
   * Keep these simple and geometric; detail does not survive at 16px.
   */
  const PATHS = {
    info: ['M12 16v-5', 'M12 8h.01', 'M12 21a9 9 0 100-18 9 9 0 000 18z'],
    success: ['M20 6L9 17l-5-5'],
    warning: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L2.4 17a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'],
    error: ['M18 6L6 18', 'M6 6l12 12'],
    search: ['M11 18a7 7 0 100-14 7 7 0 000 14z', 'M20 20l-3.5-3.5'],
    sparkle: ['M12 3l2.1 5.4L19.5 10.5l-5.4 2.1L12 18l-2.1-5.4L4.5 10.5l5.4-2.1L12 3z'],
    inbox: ['M3 13h4l2 3h6l2-3h4', 'M5.5 5h13l2.5 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5l2.5-8z'],
    shield: ['M12 21s7-3.6 7-9V6l-7-3-7 3v6c0 5.4 7 9 7 9z'],
    plug: ['M9 3v6', 'M15 3v6', 'M6 9h12v3a6 6 0 01-12 0V9z', 'M12 18v3'],
    key: ['M14.5 9.5a4.5 4.5 0 10-4.2 4.5L9 15.3l1.5 1.5L9 18.3l1.6 1.6 2.4-2.4v-3.5a4.5 4.5 0 001.5-4.5z'],
    plus: ['M12 5v14', 'M5 12h14'],
    check: ['M20 6L9 17l-5-5'],
    close: ['M18 6L6 18', 'M6 6l12 12'],
    'chevron-up': ['M18 15l-6-6-6 6'],
    'chevron-down': ['M6 9l6 6 6-6'],
    // Spoke ring: reads as motion when the host element spins.
    spinner: [
      'M12 2v4', 'M12 18v4', 'M4.93 4.93l2.83 2.83', 'M16.24 16.24l2.83 2.83',
      'M2 12h4', 'M18 12h4', 'M4.93 19.07l2.83-2.83', 'M16.24 7.76l2.83-2.83'
    ]
  };

  /**
   * Build an icon element.
   *
   * @param {string} name   Key of `PATHS`; unknown names fall back to `info`.
   * @param {number} [size] Pixel box (width and height).
   * @returns {SVGSVGElement}
   */
  app.icon = function icon(name, size = 16) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    // Decorative by default: callers that need a label set one themselves.
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('icon');

    for (const d of PATHS[name] || PATHS.info) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  };

  app.iconNames = () => Object.keys(PATHS);
})(window.AiHub);
