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
