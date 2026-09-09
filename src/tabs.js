/**
 * Tab state machine.
 *
 * Deliberately free of Electron imports: it owns *what* tabs exist, their
 * order, which one is active and which are hibernated. `src/window.js` owns the
 * `WebContentsView` instances that back them. Keeping the two apart makes the
 * tricky parts (tab limits, ordering, activation, hibernation) unit testable.
 */

const { LIMITS, HIBERNATION } = require('./constants');
const { clampNumber, truncate } = require('./utils');

class TabManager {
  /**
   * @param {{ limit?: number, onChange?: (event: string, payload: object) => void }} [options]
   */
  constructor({ limit = LIMITS.DEFAULT_MAX_TABS, onChange = null } = {}) {
    /** @type {Map<string, object>} id -> tab record */
    this.tabs = new Map();
    /** Ordered list of tab ids (the tab strip order). */
    this.order = [];
    this.activeTabId = null;
    this.limit = clampNumber(limit, LIMITS.MIN_TABS, LIMITS.MAX_TABS, LIMITS.DEFAULT_MAX_TABS);
    this.onChange = onChange;
  }

  emit(event, payload) {
    if (typeof this.onChange === 'function') {
      try {
        this.onChange(event, payload);
      } catch (e) {
        // A broken listener must never break tab management.
      }
    }
  }

  // -- Queries --------------------------------------------------------------

  get(id) {
    return this.tabs.get(id) || null;
  }

  has(id) {
    return this.tabs.has(id);
  }

  get size() {
    return this.tabs.size;
  }

  /** @returns {object[]} tab records in strip order */
  list() {
    return this.order.map((id) => this.tabs.get(id)).filter(Boolean);
  }

  /** @returns {object[]} records safe to persist / send over IPC */
  toJSON() {
    return this.list().map((tab) => ({
      id: tab.id,
      serviceId: tab.serviceId,
      url: tab.url,
      title: tab.title
    }));
  }

  get activeTab() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  }

  getLimit() {
    return this.limit;
  }

  setLimit(limit) {
    this.limit = clampNumber(limit, LIMITS.MIN_TABS, LIMITS.MAX_TABS, LIMITS.DEFAULT_MAX_TABS);
    return this.limit;
  }

  // -- Mutations ------------------------------------------------------------

  /**
   * Reserve a slot for a new tab.
   * @returns {{ok: true, tab: object} | {ok: false, error: string}}
   */
  add({ id, serviceId, url, title, userAgent = '' }) {
    if (!id || typeof id !== 'string') return { ok: false, error: 'invalid_id' };
    if (!serviceId || typeof serviceId !== 'string') return { ok: false, error: 'invalid_service' };
    if (!url || typeof url !== 'string') return { ok: false, error: 'invalid_url' };
    if (this.tabs.has(id)) return { ok: false, error: 'duplicate' };
    if (this.tabs.size >= this.limit) return { ok: false, error: 'limit_reached' };

    const now = Date.now();
    const tab = {
      id,
      serviceId,
      url: truncate(url, 4096),
      title: truncate(title || serviceId, 120),
      userAgent,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      hibernated: false,
      zoomFactor: 1,
      createdAt: now,
      lastActiveAt: now
    };

    this.tabs.set(id, tab);
    this.order.push(id);
    this.emit('add', { tab });
    return { ok: true, tab };
  }

  /**
   * Activate a tab, returning the tab that was active before (if any).
   * @returns {object|null} the newly active tab
   */
  activate(id) {
    const tab = this.tabs.get(id);
    if (!tab) return null;

    const previous = this.activeTab;
    if (this.activeTabId === id) return tab;

    this.activeTabId = id;
    tab.lastActiveAt = Date.now();
    this.emit('activate', { tab, previous });
    return tab;
  }

  /** Update mutable state (title, url, loading, navigation flags, zoom). */
  update(id, patch) {
    const tab = this.tabs.get(id);
    if (!tab) return null;

    if (patch.title !== undefined) tab.title = truncate(patch.title, 120);
    if (patch.url !== undefined) tab.url = truncate(patch.url, 4096);
    if (patch.loading !== undefined) tab.loading = Boolean(patch.loading);
    if (patch.canGoBack !== undefined) tab.canGoBack = Boolean(patch.canGoBack);
    if (patch.canGoForward !== undefined) tab.canGoForward = Boolean(patch.canGoForward);
    if (patch.zoomFactor !== undefined) tab.zoomFactor = Number(patch.zoomFactor) || 1;
    if (patch.serviceId !== undefined) tab.serviceId = String(patch.serviceId);

    this.emit('update', { tab });
    return tab;
  }

  /** Remove a tab record (does not touch the view). */
  remove(id) {
    const tab = this.tabs.get(id);
    if (!tab) return null;

    const removedIndex = this.order.indexOf(id);
    this.tabs.delete(id);
    this.order = this.order.filter((tabId) => tabId !== id);

    if (this.activeTabId === id) {
      // Prefer the neighbour that slid into the closed tab's slot, falling back
      // to the last remaining tab.
      const nextIndex = Math.max(0, Math.min(removedIndex, this.order.length - 1));
      this.activeTabId = this.order.length > 0 ? this.order[nextIndex] : null;
      if (this.activeTabId) this.tabs.get(this.activeTabId).lastActiveAt = Date.now();
    }

    this.emit('remove', { tab, nextActiveId: this.activeTabId });
    return tab;
  }

  /** Ids of every tab except `id`. */
  others(id) {
    return this.order.filter((tabId) => tabId !== id);
  }

  /**
   * Apply a new strip order. Unknown ids are ignored, missing ids are appended
   * so the order array can never lose a tab.
   */
  reorder(ids) {
    if (!Array.isArray(ids)) return this.order;
    const requested = ids.filter((id) => this.tabs.has(id));
    const missing = this.order.filter((id) => !requested.includes(id));
    this.order = [...requested, ...missing];
    this.emit('reorder', { order: [...this.order] });
    return this.order;
  }

  /** Cycle to the next/previous tab. Returns the activated tab. */
  cycle(direction = 1) {
    if (this.order.length < 2) return this.activeTab;
    const index = this.order.indexOf(this.activeTabId);
    const base = index === -1 ? 0 : index;
    const next = (base + direction + this.order.length) % this.order.length;
    return this.activate(this.order[next]);
  }

  // -- Hibernation ----------------------------------------------------------

  markHibernated(id, hibernated = true) {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    tab.hibernated = hibernated;
    if (!hibernated) tab.lastActiveAt = Date.now();
    this.emit('hibernate', { tab, hibernated });
    return tab;
  }

  /**
   * Tabs that have been inactive for longer than `idleMs` and can therefore
   * have their renderer process torn down. The active tab is never a candidate.
   *
   * @param {number} [now] epoch ms (injectable for tests)
   * @param {number} [idleMs]
   * @returns {object[]}
   */
  hibernationCandidates(now = Date.now(), idleMs = HIBERNATION.DEFAULT_IDLE_MS) {
    return this.list().filter(
      (tab) =>
        tab.id !== this.activeTabId &&
        !tab.hibernated &&
        now - (tab.lastActiveAt || now) >= idleMs
    );
  }

  /**
   * Rebuild state from persisted records (session restore).
   * @param {object[]} records
   */
  restore(records) {
    if (!Array.isArray(records)) return;
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      this.add({
        id: record.id,
        serviceId: record.serviceId || record.id,
        url: record.url,
        title: record.title
      });
    }
  }
}

module.exports = { TabManager };
