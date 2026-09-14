/**
 * Motion layer: gliding active indicators and scroll-aware surfaces.
 *
 * Everything here is defensive — if an element is missing the helper simply
 * does nothing, so the shell keeps working even if the DOM changes. All
 * animations are transform/opacity based and are disabled entirely when the
 * user prefers reduced motion.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let tabGlide = null;
  let settingsGlide = null;

  function ensureIndicator(container, existing, className) {
    if (!container) return null;
    if (existing && existing.isConnected) return existing;
    const el = document.createElement('div');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    // Place behind tab/settings buttons so content paints above the pill.
    container.insertBefore(el, container.firstChild);
    return el;
  }

  /**
   * Move `indicator` under `target` (both must share a positioned ancestor).
   * First call snaps into place without animating.
   */
  function place(indicator, target, firstSeen) {
    if (!indicator) return;
    if (!target) {
      indicator.classList.add('glide-hidden');
      return;
    }
    indicator.classList.remove('glide-hidden');

    const x = target.offsetLeft;
    const y = target.offsetTop;
    const w = target.offsetWidth;
    const h = target.offsetHeight;

    if (firstSeen || reducedMotion) indicator.classList.add('no-anim');

    indicator.style.width = `${w}px`;
    indicator.style.height = `${h}px`;
    indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    if (firstSeen || reducedMotion) {
      // Flush, then re-enable transitions on the next frame.
      void indicator.offsetWidth;
      requestAnimationFrame(() => indicator.classList.remove('no-anim'));
    }
  }

  app.positionTabIndicator = function positionTabIndicator() {
    const list = app.elements && app.elements.tabsList;
    if (!list) return;
    tabGlide = ensureIndicator(list, tabGlide, 'tab-glide');
    const active = list.querySelector('.tab-item.active');
    place(tabGlide, active, tabGlide && tabGlide.dataset.seen !== '1');
    if (tabGlide) tabGlide.dataset.seen = '1';
  };

  app.positionSettingsIndicator = function positionSettingsIndicator() {
    const tabs = app.elements && app.elements.settingsTabs;
    if (!tabs || tabs.length === 0) return;
    const container = tabs[0].parentElement;
    settingsGlide = ensureIndicator(container, settingsGlide, 'settings-glide');
    const active = tabs.find((t) => t.classList.contains('active')) || null;
    place(settingsGlide, active, settingsGlide && settingsGlide.dataset.seen !== '1');
    if (settingsGlide) settingsGlide.dataset.seen = '1';
  };

  app.updateIndicators = function updateIndicators() {
    if (app.positionTabIndicator) app.positionTabIndicator();
    if (app.positionSettingsIndicator) app.positionSettingsIndicator();
  };

  // -- Scroll-aware surface density -----------------------------------------

  function bindScrollDensity(scroller, header, className) {
    if (!scroller || !header) return;
    let ticking = false;
    scroller.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          header.classList.toggle(className, scroller.scrollTop > 6);
          ticking = false;
        });
      },
      { passive: true }
    );
  }

  function initDensity() {
    const el = app.elements || {};
    bindScrollDensity(
      document.querySelector('.settings-content'),
      document.querySelector('.panel-header'),
      'is-scrolled'
    );
    bindScrollDensity(
      el.servicesList || document.querySelector('.services-list'),
      document.querySelector('.sidebar-header'),
      'is-scrolled'
    );

    // Header density when the main content (welcome) scrolls.
    const welcome = document.getElementById('welcome-screen');
    const header = document.querySelector('.app-header');
    if (welcome && header) {
      bindScrollDensity(welcome, header, 'is-dense');
    }
  }

  // -- Re-position on layout changes ----------------------------------------

  function initObservers() {
    const raf = window.AiHubUtils
      ? window.AiHubUtils.rafThrottle(() => app.updateIndicators())
      : null;
    if (!raf) return;

    window.addEventListener('resize', raf);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(raf);
      if (app.elements && app.elements.tabsList) ro.observe(app.elements.tabsList);
      const settingsTabs = document.querySelector('.settings-tabs');
      if (settingsTabs) ro.observe(settingsTabs);
    }
  }

  app.initMotion = function initMotion() {
    initDensity();
    initObservers();
    // Position once layout has settled.
    requestAnimationFrame(() => {
      app.updateIndicators();
      requestAnimationFrame(() => app.updateIndicators());
    });
  };
})(window.AiHub);
