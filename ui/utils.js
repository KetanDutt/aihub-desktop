/**
 * Renderer helpers.
 *
 * Written as a UMD module so the exact same code can be exercised by Jest
 * (`require('../ui/utils')`) and by the browser.
 */

(function umd(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AiHubUtils = api;
  if (typeof window !== 'undefined') {
    // Backwards compatible globals used by inline handlers and tests.
    Object.assign(window, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const STATUS_TIMEOUT_MS = 4000;
  let statusTimer = null;

  /**
   * Show a message in the status bar.
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'|'loading'} [type]
   */
  function showStatus(message, type = 'info') {
    if (typeof document === 'undefined') return;

    const statusText = document.getElementById('status-text');
    const container = document.getElementById('status-message');
    const loadingIndicator = document.getElementById('loading-indicator');

    if (statusText) statusText.textContent = message;
    if (container) container.className = `status-message ${type}`;
    if (loadingIndicator) loadingIndicator.classList.toggle('hidden', type !== 'loading');

    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (statusText) statusText.textContent = 'Ready';
      if (container) container.className = 'status-message';
      if (loadingIndicator) loadingIndicator.classList.add('hidden');
    }, STATUS_TIMEOUT_MS);
  }

  function formatDate(isoString) {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString();
  }

  /** "3 hours ago" style formatting for the About panel. */
  function relativeTime(isoString) {
    if (!isoString) return 'never';
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return 'never';
    const diff = Date.now() - then;
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /**
   * Stable service id (`Meta AI` -> `metaai`).
   * Mirrors `src/utils.js#slugify`; a test keeps the two in sync.
   */
  function generateId(name) {
    if (typeof name !== 'string') return '';
    return name.toLowerCase().trim().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  }

  // Keep the historical alias.
  const slugify = generateId;

  function updateBlockingUI(snapshot) {
    if (typeof document === 'undefined') return;
    const enabled = Boolean(snapshot && snapshot.enabled);
    const indicator = document.getElementById('blocking-indicator');
    const text = document.getElementById('blocking-text');
    if (indicator) indicator.className = enabled ? 'indicator active' : 'indicator inactive';
    if (text) {
      const blocked = snapshot && typeof snapshot.blocked === 'number' ? snapshot.blocked : null;
      text.textContent = enabled
        ? blocked
          ? `Blocking active · ${blocked} blocked`
          : 'Blocking active'
        : 'Blocking disabled';
    }
  }

  function applyDarkMode(enabled) {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('light-mode', enabled === false);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', enabled === false ? '#ffffff' : '#202124');
  }

  function debounce(fn, wait = 300) {
    let timer = null;
    const debounced = (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, wait);
    };
    debounced.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    debounced.flush = (...args) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        fn(...args);
      }
    };
    return debounced;
  }

  /** Coalesce calls into a single animation frame (used for view bounds). */
  function rafThrottle(fn) {
    let queued = false;
    let lastArgs = null;
    return (...args) => {
      lastArgs = args;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn(...lastArgs);
      });
    };
  }

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  /** Initials for the fallback avatar shown when no favicon exists. */
  function initials(name) {
    if (typeof name !== 'string' || !name.trim()) return '?';
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((part) => part[0].toUpperCase()).join('');
  }

  function isValidHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (e) {
      return false;
    }
  }

  return {
    showStatus,
    formatDate,
    relativeTime,
    generateId,
    slugify,
    updateBlockingUI,
    applyDarkMode,
    debounce,
    rafThrottle,
    clamp,
    hostnameOf,
    initials,
    isValidHttpUrl
  };
});
