/**
 * Restoring a remembered window position is only useful if it can fail safely:
 * unplugging the monitor a window was saved on must not produce an invisible
 * window. These tests pin the validation rules.
 */

jest.mock('electron', () => ({}), { virtual: true });

const {
  MIN_VISIBLE_PX,
  normalizeBounds,
  isVisibleOnAnyDisplay,
  clampInto,
  overlapArea,
  restoreBounds
} = require('../src/windowstate');
const { LAYOUT } = require('../src/constants');

/** 1920×1080 primary display, taskbar at the bottom. */
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
/** Secondary display to the right. */
const SECONDARY = { x: 1920, y: 0, width: 1280, height: 984 };

describe('normalizeBounds', () => {
  it('accepts a well-formed rectangle and rounds it', () => {
    expect(normalizeBounds({ x: 10.6, y: -20.2, width: 1000.4, height: 800.7 })).toEqual({
      x: 11,
      y: -20,
      width: 1000,
      height: 801
    });
  });

  it('rejects junk, missing sizes and windows below the minimum size', () => {
    expect(normalizeBounds(null)).toBeNull();
    expect(normalizeBounds('nope')).toBeNull();
    expect(normalizeBounds([1, 2, 3, 4])).toBeNull();
    expect(normalizeBounds({ x: 0, y: 0 })).toBeNull();
    expect(normalizeBounds({ x: 0, y: 0, width: 'wide', height: 600 })).toBeNull();
    expect(normalizeBounds({ width: LAYOUT.MIN_WIDTH - 1, height: LAYOUT.MIN_HEIGHT })).toBeNull();
  });

  it('defaults a missing origin to 0 rather than failing', () => {
    expect(normalizeBounds({ width: 1200, height: 800 })).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });
});

describe('overlapArea', () => {
  it('measures the shared rectangle', () => {
    expect(overlapArea({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 })).toBe(2500);
  });

  it('is zero when the rectangles only touch or miss', () => {
    expect(overlapArea({ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 100 })).toBe(0);
    expect(overlapArea({ x: 0, y: 0, width: 100, height: 100 }, { x: 500, y: 500, width: 10, height: 10 })).toBe(0);
  });
});

describe('isVisibleOnAnyDisplay', () => {
  it('needs a draggable strip, not a single pixel', () => {
    const barelyOn = { x: PRIMARY.width - 10, y: 100, width: 1200, height: 800 };
    expect(isVisibleOnAnyDisplay(barelyOn, [PRIMARY])).toBe(false);

    const usable = { x: PRIMARY.width - (MIN_VISIBLE_PX + 10), y: 100, width: 1200, height: 800 };
    expect(isVisibleOnAnyDisplay(usable, [PRIMARY])).toBe(true);
  });

  it('finds the display a straddling window lives on', () => {
    const straddling = { x: 1800, y: 40, width: 1200, height: 800 };
    expect(isVisibleOnAnyDisplay(straddling, [PRIMARY, SECONDARY])).toBe(true);
  });

  it('reports “cannot tell” when the display list is empty', () => {
    expect(isVisibleOnAnyDisplay({ x: 0, y: 0, width: 1200, height: 800 }, [])).toBe(true);
  });
});

describe('clampInto', () => {
  it('nudges a partly off-screen window back inside, keeping its size', () => {
    const clamped = clampInto({ x: -50, y: 5000, width: 1000, height: 800 }, PRIMARY);
    expect(clamped).toEqual({ x: 0, y: PRIMARY.height - 800, width: 1000, height: 800 });
  });

  it('shrinks a window that is larger than the display', () => {
    const clamped = clampInto({ x: 0, y: 0, width: 4000, height: 3000 }, PRIMARY);
    expect(clamped).toEqual({ x: 0, y: 0, width: PRIMARY.width, height: PRIMARY.height });
  });
});

describe('restoreBounds', () => {
  it('returns null when there is nothing saved', () => {
    expect(restoreBounds(null, [PRIMARY])).toBeNull();
    expect(restoreBounds(undefined, [PRIMARY])).toBeNull();
    expect(restoreBounds({}, [PRIMARY])).toBeNull();
  });

  it('keeps a window that is still on a known display', () => {
    const saved = { x: 100, y: 80, width: 1400, height: 900 };
    expect(restoreBounds(saved, [PRIMARY, SECONDARY])).toEqual(saved);
  });

  it('discards a window saved on a display that is gone', () => {
    // Sits comfortably on the second monitor, nowhere near the primary one.
    const saved = { x: 2200, y: 100, width: 900, height: 600 };
    expect(restoreBounds(saved, [PRIMARY])).toBeNull();
    expect(restoreBounds(saved, [PRIMARY, SECONDARY])).toEqual(saved);
  });

  it('pulls a window back when its display shrank', () => {
    const small = { x: 0, y: 0, width: 1280, height: 720 };
    const restored = restoreBounds({ x: 900, y: 400, width: 1000, height: 800 }, [small]);
    expect(restored).toEqual({ x: 280, y: 0, width: 1000, height: 720 });
    expect(isVisibleOnAnyDisplay(restored, [small])).toBe(true);
  });

  it('accepts the geometry when the display list is unavailable', () => {
    const saved = { x: 10, y: 10, width: 1200, height: 800 };
    expect(restoreBounds(saved, [])).toEqual(saved);
  });
});
