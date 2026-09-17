/**
 * Keyboard shortcuts and the shortcut reference modal.
 *
 * These apply while the app chrome has focus. Once you click inside a service,
 * keystrokes belong to that site (that is exactly what a browser tab should do);
 * press Ctrl+Tab, or click the tab strip, to get back to the chrome.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const MOD = IS_MAC ? '⌘' : 'Ctrl';

  const SHORTCUTS = [
    { keys: [`${MOD}+T`], description: 'Open the service picker' },
    { keys: [`${MOD}+B`], description: 'Toggle the service sidebar' },
    { keys: [`${MOD}+Tab`], description: 'Next tab' },
    { keys: [`${MOD}+Shift+Tab`], description: 'Previous tab' },
    { keys: [`${MOD}+1…9`], description: 'Jump to tab n' },
    { keys: [`${MOD}+W`], description: 'Close the active tab' },
    { keys: [`${MOD}+Shift+T`], description: 'Reopen the last closed tab' },
    { keys: [`${MOD}+R`, 'F5'], description: 'Reload the active tab' },
    { keys: [`${MOD}+Shift+R`], description: 'Reload, ignoring the cache' },
    { keys: ['Esc'], description: 'Stop loading the active tab' },
    { keys: ['Alt+Home'], description: 'Back to the service home page' },
    { keys: ['Alt+←', 'Alt+→'], description: 'Back / forward' },
    { keys: [`${MOD}+F`], description: 'Find in page' },
    { keys: [`${MOD}+M`], description: 'Mute / unmute the active tab' },
    { keys: [`${MOD}+=`, `${MOD}+-`, `${MOD}+0`], description: 'Zoom in, out, reset' },
    { keys: [`${MOD}+,`], description: 'Open settings' },
    { keys: ['Esc'], description: 'Close dialogs and panels' },
    { keys: ['?'], description: 'Show this list' }
  ];

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function renderShortcutsModal() {
    const modal = app.elements.shortcutsModal;
    if (!modal) return;

    const list = modal.querySelector('.shortcut-list');
    if (!list || list.childElementCount > 0) return;

    for (const shortcut of SHORTCUTS) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';

      const keys = document.createElement('div');
      keys.className = 'shortcut-keys';
      for (const key of shortcut.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        keys.appendChild(kbd);
      }

      const description = document.createElement('span');
      description.textContent = shortcut.description;

      row.append(keys, description);
      list.appendChild(row);
    }
  }

  /** Element that had focus before the modal opened, so it can be restored. */
  let focusBeforeModal = null;

  app.toggleShortcutsModal = function toggleShortcutsModal(force) {
    const modal = app.elements.shortcutsModal;
    if (!modal) return;
    renderShortcutsModal();

    const wasHidden = modal.classList.contains('hidden');
    const shouldShow = force === undefined ? wasHidden : force;
    if (shouldShow === !wasHidden) return; // already in the requested state

    modal.classList.toggle('hidden', !shouldShow);
    modal.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');

    // The dialog declares aria-modal, so focus has to actually go into it —
    // otherwise a keyboard or screen-reader user is left behind it.
    if (shouldShow) {
      focusBeforeModal = document.activeElement;
      const close = app.elements.btnCloseShortcuts;
      if (close && typeof close.focus === 'function') close.focus();
    } else if (focusBeforeModal && typeof focusBeforeModal.focus === 'function') {
      focusBeforeModal.focus();
      focusBeforeModal = null;
    }
  };

  app.initShortcuts = function initShortcuts() {
    document.addEventListener('keydown', (event) => {
      const mod = IS_MAC ? event.metaKey : event.ctrlKey;
      const key = event.key;

      // Alt-based navigation mirrors a browser: Alt+arrows, Alt+Home.
      if (event.altKey && !mod) {
        if (key === 'ArrowLeft') {
          event.preventDefault();
          if (app.state.currentTabId) window.electronAPI.navGoBack(app.state.currentTabId);
          return;
        }
        if (key === 'ArrowRight') {
          event.preventDefault();
          if (app.state.currentTabId) window.electronAPI.navGoForward(app.state.currentTabId);
          return;
        }
        if (key === 'Home') {
          event.preventDefault();
          if (app.state.currentTabId) window.electronAPI.navHome(app.state.currentTabId);
          return;
        }
      }

      // Escape always closes the top-most overlay.
      if (key === 'Escape') {
        if (app.isFindBarOpen && app.isFindBarOpen()) {
          app.closeFindBar();
          return;
        }
        if (!app.elements.shortcutsModal || app.elements.shortcutsModal.classList.contains('hidden')) {
          app.closeSettings();
          if (app.elements.sidebar) app.elements.sidebar.classList.add('hidden');
        }
        app.toggleShortcutsModal(false);
        app.closeContextMenu();

        // Nothing left to dismiss: Esc stops a load in progress, like a browser.
        const active = app.getActiveTab();
        if (active && active.loading) window.electronAPI.navStop(active.id);
        return;
      }

      if (!mod) {
        if (key === '?' && !isTypingTarget(event.target)) {
          event.preventDefault();
          app.toggleShortcutsModal();
        }
        if (key === 'F5') {
          event.preventDefault();
          if (app.state.currentTabId) window.electronAPI.navReload(app.state.currentTabId);
        }
        return;
      }

      if (isTypingTarget(event.target) && key !== 'Tab') return;

      const lower = key.toLowerCase();

      if (key === 'Tab') {
        event.preventDefault();
        app.switchToNextTab(event.shiftKey ? -1 : 1);
        return;
      }

      if (lower === 't') {
        event.preventDefault();
        // Shift+T reopens what you just closed, like a browser.
        if (event.shiftKey) app.reopenClosedTab();
        else app.openSidebar();
        return;
      }

      if (lower === 'b') {
        event.preventDefault();
        app.toggleSidebar();
        return;
      }

      if (lower === 'w') {
        event.preventDefault();
        if (app.state.currentTabId) app.closeTab(app.state.currentTabId);
        return;
      }

      if (lower === 'r') {
        event.preventDefault();
        if (!app.state.currentTabId) return;
        if (event.shiftKey) window.electronAPI.navReloadHard(app.state.currentTabId);
        else window.electronAPI.navReload(app.state.currentTabId);
        return;
      }

      if (lower === 'f') {
        event.preventDefault();
        if (app.openFindBar) app.openFindBar();
        return;
      }

      if (lower === 'm') {
        event.preventDefault();
        app.toggleMuteActiveTab();
        return;
      }

      if (lower === ',') {
        event.preventDefault();
        app.openSettings();
        return;
      }

      if (key === '=' || key === '+') {
        event.preventDefault();
        app.adjustZoom(0.1);
        return;
      }

      if (key === '-') {
        event.preventDefault();
        app.adjustZoom(-0.1);
        return;
      }

      if (key === '0') {
        event.preventDefault();
        app.adjustZoom(0, true);
        return;
      }

      if (/^[1-9]$/.test(key)) {
        event.preventDefault();
        const tab = app.state.tabs[Number(key) - 1];
        if (tab) app.switchToTab(tab.id);
      }
    });

    if (app.elements.btnShortcuts) {
      app.elements.btnShortcuts.addEventListener('click', () => app.toggleShortcutsModal());
    }
    if (app.elements.btnCloseShortcuts) {
      app.elements.btnCloseShortcuts.addEventListener('click', () => app.toggleShortcutsModal(false));
    }
  };

  app.adjustZoom = async function adjustZoom(delta, reset = false) {
    const tab = app.getActiveTab();
    if (!tab) return;
    const next = reset ? 1 : (tab.zoomFactor || 1) + delta;
    try {
      const applied = await window.electronAPI.setZoom(tab.id, next);
      if (applied) tab.zoomFactor = applied;
    } catch (e) {
      /* non fatal */
    }
  };

  app.toggleMuteActiveTab = async function toggleMuteActiveTab() {
    const tab = app.getActiveTab();
    if (!tab || !window.electronAPI.setMuted) return;
    const next = !tab.muted;
    try {
      await window.electronAPI.setMuted(tab.id, next);
      tab.muted = next;
      const node = app.tabNode ? app.tabNode(tab.id) : null;
      if (node) node.classList.toggle('is-muted', next);
      app.toast(next ? 'Tab muted' : 'Tab unmuted', 'info');
    } catch (e) {
      /* non fatal */
    }
  };

  app.SHORTCUTS = SHORTCUTS;
})(window.AiHub);
