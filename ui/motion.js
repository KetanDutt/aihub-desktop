/**
 * Motion layer: gliding active indicators and scroll-aware surfaces.
 *
 * Everything here is defensive - if an element is missing the helper simply
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
    container.appendChild(el);
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
    app.positionTabIndicator && app.positionTabIndicator();
    app.positionSettingsIndicator && app.positionSettingsIndicator();
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
          header.classList.toggle(className, scroller.scrollTop > 8);
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
  }

  // -- Re-position on layout changes ----------------------------------------

  function initObservers() {
    const raf = window.AiHubUtils ? window.AiHubUtils.rafThrottle(() => app.updateIndicators()) : null;
    if (!raf) return;

    window.addEventListener('resize', raf);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(raf);
      if (app.elements && app.elements.tabsList) ro.observe(app.elements.tabsList);
    }
  }

  app.initMotion = function initMotion() {
    initDensity();
    initObservers();
    // Position once layout has settled.
    requestAnimationFrame(() => app.updateIndicators());
  };
})(window.AiHub);
