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
    if (meta) meta.setAttribute('content', enabled === false ? '#e8ecf3' : '#080a0e');
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

  // -- Service filters -----------------------------------------------------
  //
  // Pure on purpose: the Services tab renders whatever this returns, so the
  // filtering/sorting rules are unit-testable without a DOM.

  const SERVICE_SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'type', label: 'Type' },
    { id: 'status', label: 'Enabled first' },
    { id: 'login', label: 'Sign-in state' },
    { id: 'access', label: 'Free first' },
    { id: 'recent', label: 'Recently used' },
    { id: 'cookies', label: 'Cached cookies' }
  ];

  const SERVICE_STATUS_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'enabled', label: 'Enabled' },
    { id: 'disabled', label: 'Disabled' },
    { id: 'open', label: 'Open in a tab' },
    { id: 'closed', label: 'Not open' }
  ];

  const SERVICE_LOGIN_FILTERS = [
    { id: 'all', label: 'Any' },
    { id: 'logged-in', label: 'Signed in' },
    { id: 'logged-out', label: 'Signed out' },
    { id: 'challenge', label: 'Verifying' },
    { id: 'unknown', label: 'Unknown' }
  ];

  // Free = usable with no account. Everything else wants a sign-in before the
  // API (or a tab) can do anything useful with it.
  const SERVICE_ACCESS_FILTERS = [
    { id: 'all', label: 'Any' },
    { id: 'free', label: 'No sign-in' },
    { id: 'signin', label: 'Sign-in required' }
  ];

  /** Does the catalogue say this service works without an account? */
  function requiresLogin(service) {
    if (!service || typeof service !== 'object') return true;
    return service.requiresLogin !== false;
  }

  const ACCESS_GROUPS = [
    { id: 'free', label: 'No sign-in needed' },
    { id: 'signin', label: 'Sign-in required' }
  ];

  /**
   * Split a list into the two access groups (free first), so the Services tab
   * can render them as separate sections instead of one mixed list.
   *
   * @param {object[]} services already filtered + sorted
   * @returns {{groups: {id: string, label: string, services: object[]}[], single: boolean}}
   */
  function groupServicesByAccess(services) {
    const list = Array.isArray(services) ? services.filter(Boolean) : [];
    const free = list.filter((service) => !requiresLogin(service));
    const signin = list.filter((service) => requiresLogin(service));

    const groups = [];
    if (free.length > 0) groups.push({ ...ACCESS_GROUPS[0], services: free });
    if (signin.length > 0) groups.push({ ...ACCESS_GROUPS[1], services: signin });

    return { groups, single: groups.length <= 1 };
  }

  const LOGIN_RANK = { 'logged-in': 0, challenge: 1, 'logged-out': 2, unknown: 3 };

  function normalizeServiceFilters(raw) {
    const filters = raw && typeof raw === 'object' ? raw : {};
    const oneOf = (value, options, fallback) =>
      options.some((option) => option.id === value) ? value : fallback;

    return {
      query: typeof filters.query === 'string' ? filters.query.slice(0, 120) : '',
      type: typeof filters.type === 'string' && filters.type ? filters.type.slice(0, 60) : 'all',
      status: oneOf(filters.status, SERVICE_STATUS_FILTERS, 'all'),
      login: oneOf(filters.login, SERVICE_LOGIN_FILTERS, 'all'),
      access: oneOf(filters.access, SERVICE_ACCESS_FILTERS, 'all'),
      sort: oneOf(filters.sort, SERVICE_SORTS, 'name'),
      direction: filters.direction === 'desc' ? 'desc' : 'asc'
    };
  }

  function serviceTypeKey(service) {
    const type = String((service && service.type) || 'AI Service').trim();
    return type || 'AI Service';
  }

  function matchesQuery(service, query) {
    const term = String(query || '').trim().toLowerCase();
    if (!term) return true;
    const haystack = [
      service.name,
      service.type,
      service.id,
      service.privacy,
      service.url
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return term.split(/\s+/).every((word) => haystack.includes(word));
  }

  /**
   * Filter + sort a service list, with facet counts for the chips.
   *
   * @param {object[]} services
   * @param {object} rawFilters `{query, type, status, login, sort, direction}`
   * @param {{enabledIds?: string[]|Set, openIds?: string[]|Set, loginStates?: object,
   *           usage?: object, cookieCounts?: object}} [context]
   * @returns {{services: object[], counts: object, activeCount: number}}
   */
  function applyServiceFilters(services, rawFilters, context) {
    const filters = normalizeServiceFilters(rawFilters);
    const ctx = context || {};
    const enabled = ctx.enabledIds instanceof Set ? ctx.enabledIds : new Set(ctx.enabledIds || []);
    const open = ctx.openIds instanceof Set ? ctx.openIds : new Set(ctx.openIds || []);
    const loginStates = ctx.loginStates || {};
    const usage = ctx.usage || {};
    const cookieCounts = ctx.cookieCounts || {};

    const list = Array.isArray(services) ? services.filter(Boolean) : [];
    const stateOf = (service) => (loginStates[service.id] && loginStates[service.id].state) || 'unknown';

    const counts = {
      total: list.length,
      shown: 0,
      enabled: 0,
      disabled: 0,
      open: 0,
      loggedIn: 0,
      loggedOut: 0,
      unknown: 0,
      challenge: 0,
      free: 0,
      signin: 0,
      byType: {}
    };

    for (const service of list) {
      const type = serviceTypeKey(service);
      counts.byType[type] = (counts.byType[type] || 0) + 1;
      if (enabled.has(service.id)) counts.enabled += 1;
      else counts.disabled += 1;
      if (open.has(service.id)) counts.open += 1;
      const state = stateOf(service);
      if (state === 'logged-in') counts.loggedIn += 1;
      else if (state === 'logged-out') counts.loggedOut += 1;
      else if (state === 'challenge') counts.challenge += 1;
      else counts.unknown += 1;
      if (requiresLogin(service)) counts.signin += 1;
      else counts.free += 1;
    }

    let result = list.filter((service) => {
      if (!matchesQuery(service, filters.query)) return false;
      if (filters.type !== 'all' && serviceTypeKey(service) !== filters.type) return false;
      if (filters.status === 'enabled' && !enabled.has(service.id)) return false;
      if (filters.status === 'disabled' && enabled.has(service.id)) return false;
      if (filters.status === 'open' && !open.has(service.id)) return false;
      if (filters.status === 'closed' && open.has(service.id)) return false;
      if (filters.login !== 'all' && stateOf(service) !== filters.login) return false;
      if (filters.access === 'free' && requiresLogin(service)) return false;
      if (filters.access === 'signin' && !requiresLogin(service)) return false;
      return true;
    });

    const direction = filters.direction === 'desc' ? -1 : 1;
    const nameOf = (service) => String(service.name || '').toLowerCase();
    const tie = (a, b) => (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0);

    result = result.slice().sort((a, b) => {
      let delta = 0;
      switch (filters.sort) {
        case 'type':
          delta =
            serviceTypeKey(a).localeCompare(serviceTypeKey(b)) || tie(a, b);
          break;
        case 'status':
          delta = (enabled.has(a.id) ? 0 : 1) - (enabled.has(b.id) ? 0 : 1) || tie(a, b);
          break;
        case 'login': {
          const rankA = LOGIN_RANK[stateOf(a)] === undefined ? 4 : LOGIN_RANK[stateOf(a)];
          const rankB = LOGIN_RANK[stateOf(b)] === undefined ? 4 : LOGIN_RANK[stateOf(b)];
          delta = rankA - rankB || tie(a, b);
          break;
        }
        case 'access': {
          // Free services first: they are callable right now.
          delta = (requiresLogin(a) ? 1 : 0) - (requiresLogin(b) ? 1 : 0) || tie(a, b);
          break;
        }
        case 'recent': {
          // "Ascending" means "most interesting first" throughout this list, so
          // for recency that is newest first; the toggle reverses it.
          delta = (Number(usage[b.id] || 0) - Number(usage[a.id] || 0)) || tie(a, b);
          break;
        }
        case 'cookies': {
          const countA = Number(cookieCounts[a.id] || 0);
          const countB = Number(cookieCounts[b.id] || 0);
          delta = countB - countA || tie(a, b);
          break;
        }
        default:
          delta = nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0;
      }
      return delta * direction;
    });

    counts.shown = result.length;
    const activeCount =
      (filters.query.trim() ? 1 : 0) +
      (filters.type !== 'all' ? 1 : 0) +
      (filters.status !== 'all' ? 1 : 0) +
      (filters.login !== 'all' ? 1 : 0) +
      (filters.access !== 'all' ? 1 : 0);

    return { services: result, counts, activeCount, filters };
  }

  /** Distinct types, alphabetically, for the type dropdown. */
  function serviceTypes(services) {
    const seen = new Map();
    for (const service of Array.isArray(services) ? services : []) {
      const type = serviceTypeKey(service);
      seen.set(type, (seen.get(type) || 0) + 1);
    }
    return [...seen.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }

  /** Human summary: `3 of 16 · type “Search” · signed in`. */
  function describeFilters(summary, filters) {
    const parts = [`${summary.shown} of ${summary.total}`];
    if (filters.query.trim()) parts.push(`“${filters.query.trim()}”`);
    if (filters.type !== 'all') parts.push(filters.type);
    if (filters.status !== 'all') {
      const found = SERVICE_STATUS_FILTERS.find((option) => option.id === filters.status);
      parts.push(found ? found.label.toLowerCase() : filters.status);
    }
    if (filters.login !== 'all') {
      const found = SERVICE_LOGIN_FILTERS.find((option) => option.id === filters.login);
      parts.push(found ? found.label.toLowerCase() : filters.login);
    }
    if (filters.access !== 'all') {
      const found = SERVICE_ACCESS_FILTERS.find((option) => option.id === filters.access);
      parts.push(found ? found.label.toLowerCase() : filters.access);
    }
    return parts.join(' · ');
  }

  return {
    SERVICE_SORTS,
    SERVICE_STATUS_FILTERS,
    SERVICE_LOGIN_FILTERS,
    SERVICE_ACCESS_FILTERS,
    ACCESS_GROUPS,
    requiresLogin,
    groupServicesByAccess,
    normalizeServiceFilters,
    applyServiceFilters,
    serviceTypes,
    serviceTypeKey,
    describeFilters,
    matchesQuery,
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
