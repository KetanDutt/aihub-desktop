/**
 * Window geometry: remembering where the user left the window.
 *
 * A desktop app that reopens at 1200×800 in the corner every morning feels
 * broken, so the size / position / maximized state are persisted. The tricky
 * part is not saving them but *restoring* them: a laptop unplugged from a 4K
 * monitor would otherwise restore a window onto a display that no longer
 * exists, and the user sees nothing at all.
 *
 * All of that logic lives here as pure functions (no Electron import) so it can
 * be unit tested with plain rectangles. `src/window.js` supplies the real work
 * areas from the `screen` module.
 */

const { LAYOUT } = require('./constants');

/** Keep at least this much of the window on screen to be worth restoring. */
const MIN_VISIBLE_PX = 120;

function toInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

/**
 * Coerce anything into a usable rectangle.
 *
 * @param {unknown} value
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
function normalizeBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const width = toInt(value.width);
  const height = toInt(value.height);
  if (width === null || height === null) return null;
  if (width < LAYOUT.MIN_WIDTH || height < LAYOUT.MIN_HEIGHT) return null;

  return {
    x: toInt(value.x, 0),
    y: toInt(value.y, 0),
    width,
    height
  };
}

/** Area of the overlap between two rectangles (0 when they do not touch). */
function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

/**
 * Is enough of `bounds` inside one of the displays to be usable?
 *
 * A window whose title bar sits off-screen cannot be dragged back, so the test
 * is about a *visible* strip, not mere intersection.
 *
 * @param {{x: number, y: number, width: number, height: number}} bounds
 * @param {Array<{x: number, y: number, width: number, height: number}>} workAreas
 * @param {number} [minVisible]
 * @returns {boolean}
 */
function isVisibleOnAnyDisplay(bounds, workAreas, minVisible = MIN_VISIBLE_PX) {
  if (!Array.isArray(workAreas) || workAreas.length === 0) return true; // cannot tell
  const visible = (a, b) => {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return width >= Math.min(minVisible, a.width) && height >= Math.min(minVisible, a.height);
  };
  return workAreas.some((area) => visible(bounds, area));
}

/** Pull a rectangle fully inside `area`, shrinking it only when it must. */
function clampInto(bounds, area) {
  const width = Math.min(bounds.width, Math.max(LAYOUT.MIN_WIDTH, area.width));
  const height = Math.min(bounds.height, Math.max(LAYOUT.MIN_HEIGHT, area.height));
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), Math.max(area.x, maxX)),
    y: Math.min(Math.max(bounds.y, area.y), Math.max(area.y, maxY))
  };
}

/**
 * Turn a persisted rectangle into something safe to open a window with.
 *
 * @param {unknown} saved the value from the config store
 * @param {Array<{x: number, y: number, width: number, height: number}>} [workAreas]
 * @returns {{x: number, y: number, width: number, height: number}|null} null when
 *   the saved geometry is unusable and the caller should fall back to defaults
 */
function restoreBounds(saved, workAreas = []) {
  const bounds = normalizeBounds(saved);
  if (!bounds) return null;

  if (!Array.isArray(workAreas) || workAreas.length === 0) return bounds;

  // Prefer the display the window was mostly on; a window straddling two
  // monitors should stay where the user put it.
  const host = workAreas.reduce(
    (best, area) => {
      const area_ = overlapArea(bounds, area);
      return area_ > best.overlap ? { area, overlap: area_ } : best;
    },
    { area: null, overlap: 0 }
  );

  if (!host.area) return null;
  if (!isVisibleOnAnyDisplay(bounds, workAreas)) return null;
  return clampInto(bounds, host.area);
}

module.exports = {
  MIN_VISIBLE_PX,
  normalizeBounds,
  isVisibleOnAnyDisplay,
  clampInto,
  overlapArea,
  restoreBounds
};
