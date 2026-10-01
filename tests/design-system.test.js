/**
 * Design-system audit.
 *
 * The Liquid Glass language is only worth having if it stays consistent. These
 * tests are the guard against the slow drift that turns a design system back
 * into a pile of individually styled components: a magic radius here, a
 * hardcoded blur there, a third shade of "border white".
 *
 * They read the stylesheet as text on purpose. There is no CSSOM in this
 * environment, and the point is to police what is *written*, not what a browser
 * eventually computes.
 */

const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'ui');
const css = fs.readFileSync(path.join(UI_DIR, 'styles.css'), 'utf8');

/** Declarations inside `:root`/theme blocks are token definitions, not usage. */
function componentDeclarations() {
  // Everything after the token section: the first rule that is not a theme block.
  const start = css.indexOf('2. Base');
  return css.slice(start);
}

const body = componentDeclarations();

describe('tokens', () => {
  it('defines the full radius, blur, motion and layer scales', () => {
    for (const token of ['--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill']) {
      expect(css).toContain(`${token}:`);
    }
    for (const token of ['--blur-1', '--blur-2', '--blur-3', '--blur-veil']) {
      expect(css).toContain(`${token}:`);
    }
    for (const token of ['--t-instant', '--t-fast', '--t-med', '--t-slow', '--t-modal']) {
      expect(css).toContain(`${token}:`);
    }
    for (const token of ['--z-bg', '--z-content', '--z-panel', '--z-nav', '--z-popover', '--z-dialog', '--z-toast']) {
      expect(css).toContain(`${token}:`);
    }
  });

  it('keeps the spatial layers strictly ordered', () => {
    const layer = (name) => {
      const match = css.match(new RegExp(`${name}:\\s*(\\d+)`));
      return match ? Number(match[1]) : NaN;
    };
    const order = ['--z-bg', '--z-content', '--z-panel', '--z-nav', '--z-popover', '--z-dialog', '--z-toast'].map(layer);
    expect(order.every(Number.isFinite)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it('defines every token it uses', () => {
    const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((token) => !defined.has(token));
    expect(missing).toEqual([]);
  });
});

describe('no magic numbers in component rules', () => {
  it('uses radius tokens rather than raw pixel radii', () => {
    const offenders = [...body.matchAll(/border-radius:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      // 50% circles, CSS-wide keywords and the tiny focus-rail cap are
      // intentional and carry no design-token meaning.
      .filter(
        (value) =>
          !value.includes('var(--') &&
          value !== '50%' &&
          !['inherit', 'initial', 'unset', 'revert', '0'].includes(value) &&
          !value.includes('2px 2px')
      );
    expect(offenders).toEqual([]);
  });

  it('uses blur tokens rather than raw backdrop-filter values', () => {
    const offenders = [...body.matchAll(/backdrop-filter:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((value) => !value.includes('var(--') && value !== 'none');
    expect(offenders).toEqual([]);
  });

  it('uses motion tokens rather than raw transition durations', () => {
    const offenders = [...body.matchAll(/transition:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((value) => /\d+m?s/.test(value) && !value.includes('var(--'));
    expect(offenders).toEqual([]);
  });
});

describe('accessibility and performance guarantees', () => {
  it('honours prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    // Staged reveals use transition-delay; leaving it intact would keep content
    // hidden even with motion disabled.
    expect(block).toMatch(/transition-delay:\s*0ms\s*!important/);
  });

  it('survives forced-colors mode', () => {
    expect(css).toContain('@media (forced-colors: active)');
  });

  it('steps blur down on small screens so mobile GPUs keep up', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(mobile).toMatch(/--blur-1:/);
  });

  it('keeps core navigation controls available on small screens', () => {
    // Regression: `.nav-controls { display: none }` removed back/forward/reload
    // entirely on mobile instead of adapting them.
    expect(body).not.toMatch(/\.nav-controls\s*\{\s*display:\s*none/);
  });

  it('defines a visible focus treatment', () => {
    expect(css).toContain('--focus:');
    expect(body).toMatch(/:focus-visible/);
  });
});

/**
 * Overlap regressions.
 *
 * The shell is a stack of surfaces, and a handful of them have to share the
 * window without covering each other. Each assertion here pins a bug that
 * shipped: a collapsed stage, a drawer sitting under the navigation bar, a
 * dialog that swallowed every click while invisible, and a segmented control
 * squeezed until its labels clipped.
 */
describe('surfaces do not overlap', () => {
  /** Body of the first rule whose selector matches exactly. */
  function ruleBody(selector) {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    return match ? match[1] : '';
  }

  it('places the stage in its own column so a collapsed sidebar cannot collapse it', () => {
    // `display: none` takes the sidebar out of the grid entirely, so the stage
    // must be placed explicitly rather than auto-placed into column 1.
    expect(ruleBody('.main-content')).toMatch(/grid-column:\s*2/);
    expect(ruleBody('.sidebar')).toMatch(/grid-column:\s*1/);
    expect(ruleBody('.main-row')).toMatch(/grid-template-columns:\s*0 minmax\(0, 1fr\)/);
  });

  it('starts the settings drawer at the top of the stage, clear of the nav bar', () => {
    expect(css).toMatch(/--stage-top:\s*calc\(var\(--shell-pad\) \+ var\(--nav-height\) \+ var\(--shell-gap\)\)/);
    expect(ruleBody('.settings-panel')).toMatch(/top:\s*var\(--stage-top\)/);
  });

  it('outranks the nav bar when the drawer goes full-bleed on a phone', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
    // Several rules mention `.settings-panel` (it also appears in a grouped
    // selector), so look at every body in the block.
    const bodies = [...phone.matchAll(/\.settings-panel \{([^}]*)\}/g)].map((m) => m[1]);
    expect(bodies.some((body) => /z-index:\s*var\(--z-dialog\)/.test(body))).toBe(true);
  });

  it('keeps a closed dialog inert instead of merely transparent', () => {
    // An opacity-0 sheet that still spans the window eats every click on the
    // shell behind it, and leaves its buttons in the tab order.
    const closed = ruleBody('.modal-backdrop');
    expect(closed).toMatch(/visibility:\s*hidden/);
    expect(closed).toMatch(/pointer-events:\s*none/);
    const open = ruleBody('.modal-backdrop.visible');
    expect(open).toMatch(/visibility:\s*visible/);
    expect(open).toMatch(/pointer-events:\s*auto/);
  });

  it('closes and opens that dialog in lockstep with the class it toggles', () => {
    const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
    expect(html).toMatch(/class="modal-backdrop hidden"/);
    const shortcuts = fs.readFileSync(path.join(UI_DIR, 'shortcuts.js'), 'utf8');
    expect(shortcuts).toMatch(/classList\.toggle\('hidden', !shouldShow\)/);
    expect(shortcuts).toMatch(/classList\.toggle\('visible', shouldShow\)/);
  });

  it('never lets a horizontal scroller be squeezed out of its own height', () => {
    // `.settings-tabs` scrolls sideways, so its automatic minimum size is 0:
    // without an explicit flex basis the labels clip in a short window.
    expect(ruleBody('.settings-tabs')).toMatch(/flex:\s*0 0 auto/);
    expect(ruleBody('.panel-header')).toMatch(/flex:\s*0 0 auto/);
  });
});

describe('icon system', () => {
  const iconsJs = fs.readFileSync(path.join(UI_DIR, 'icons.js'), 'utf8');

  it('draws every glyph on one grid with one stroke weight', () => {
    expect(iconsJs).toContain("setAttribute('viewBox', '0 0 24 24')");
    expect(iconsJs).toContain("setAttribute('stroke-width', '1.75')");
    expect(iconsJs).toContain("setAttribute('stroke', 'currentColor')");
  });

  it('builds nodes without innerHTML, per the repo rule', () => {
    // Strip comments first: the rule is about executable code, and the module
    // legitimately *mentions* innerHTML in the comment explaining why it is
    // avoided.
    const code = iconsJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/innerHTML/);
    expect(code).toContain('createElementNS');
  });

  it('has no leftover hand-rolled SVG strings in any renderer script', () => {
    // These drift in stroke weight and size; icons.js is the only place raw SVG
    // geometry should live.
    const scripts = fs.readdirSync(UI_DIR).filter((f) => f.endsWith('.js') && f !== 'icons.js');
    const offenders = scripts.filter((file) =>
      /<svg\s/i.test(fs.readFileSync(path.join(UI_DIR, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('uses a single stroke weight everywhere, including static markup', () => {
    // The shell shipped four different weights (1.75/1.8/2/2.5), which is the
    // clearest tell that icons came from different sources.
    const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
    const weights = new Set([...html.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1]));
    expect([...weights]).toEqual(['1.75']);
  });
});

/**
 * Class coverage.
 *
 * A design system is only as good as its reach: a component that renders
 * unstyled looks "not redesigned yet" no matter how good the tokens are. This
 * block reads every class the renderer can put on an element and asserts the
 * stylesheet has a rule for it, so adding or renaming a component cannot
 * silently ship without styling.
 */
describe('class coverage', () => {
  const SHELL_FILES = [
    'index.html',
    ...fs.readdirSync(UI_DIR).filter((f) => f.endsWith('.js'))
  ];

  const read = (file) => fs.readFileSync(path.join(UI_DIR, file), 'utf8');

  /** Class strings from `class=`, `className =`, `classList.*()` and `setAttribute`. */
  function classStrings() {
    const out = [];
    for (const file of SHELL_FILES) {
      const source = read(file);
      const patterns = [
        /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
        /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
        // Only the first argument: the rest are booleans and comparisons.
        /classList\.(?:add|remove|toggle|contains)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g,
        /setAttribute\(\s*['"]class['"]\s*,\s*(?:"([^"]*)"|'([^']*)')/g
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const value = match[1] ?? match[2] ?? match[3] ?? '';
          for (const token of value.split(/\s+/)) {
            if (token) out.push(token);
          }
        }
      }
    }
    return out;
  }

  const declared = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

  /**
   * Values behind template fragments, read from their real source of truth so
   * this list cannot rot: login states from the pure module that classifies
   * them, toast types from the icon table, status types from the call sites,
   * group ids from the access groups, avatar sizes from the factory call.
   */
  function fragmentValues(prefix) {
    const utils = read('utils.js');

    switch (prefix) {
      case 'login-':
        // `login-${record.state}` — states come from the module that classifies them.
        return Object.values(require('../src/loginstate.js').STATE).map((state) => prefix + state);
      case 'toast-': {
        // `toast-${type}` — types are the keys of the toast icon table.
        const table = /TOAST_ICONS\s*=\s*\{([\s\S]*?)\}/.exec(read('overlays.js'));
        return [...(table ? table[1].matchAll(/(\w+)\s*:/g) : [])].map((m) => prefix + m[1]);
      }
      case 'is-':
        // `is-${group.id}` — the two access groups the picker splits into.
        return [...utils.matchAll(/id:\s*'(free|signin)'/g)].map((m) => prefix + m[1]);
      case 'service-avatar':
        return ['sm', 'md'].map((size) => `${prefix} ${size}`);
      default:
        return [];
    }
  }

  it('styles every class the shell can put on an element', () => {
    const fragments = new Set();
    const missing = [];

    for (const raw of classStrings()) {
      if (raw.includes('${')) {
        // `is-${group.id}` → remember the `is-` family, not the expression.
        const prefix = raw.split('${')[0];
        if (prefix) fragments.add(prefix);
        continue;
      }
      if (!/^[a-z][a-z0-9-]*$/.test(raw)) continue;
      if (!declared.has(raw)) missing.push(raw);
    }

    expect([...new Set(missing)].sort()).toEqual([]);
    expect([...fragments].sort()).toEqual(
      expect.arrayContaining(['is-', 'login-', 'toast-'])
    );
  });

  it('styles every value those fragments can take', () => {
    const missing = [];
    for (const prefix of ['login-', 'toast-', 'is-']) {
      const values = fragmentValues(prefix);
      expect(values.length).toBeGreaterThan(1);
      for (const value of values) {
        for (const cls of value.split(' ')) {
          if (!declared.has(cls)) missing.push(cls);
        }
      }
    }
    // State chips also come from the status bar's own type list.
    const statusTypes = [...read('utils.js').matchAll(/showStatus\(\s*[^,]+,\s*'([a-z]+)'/g)]
      .map((m) => m[1]);
    for (const type of new Set(statusTypes)) {
      if (!declared.has('status-message') || !declared.has(type)) missing.push(`status-message.${type}`);
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
