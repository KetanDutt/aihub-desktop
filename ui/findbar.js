/**
 * Find-in-page bar for the active tab.
 *
 * Ctrl+F opens it; Enter / buttons walk matches; Esc closes and clears the
 * selection. Results come back from the main process via `onTabFindResult`.
 */

window.AiHub = window.AiHub || {};

(function (app) {
  let bar = null;
  let input = null;
  let counter = null;
  let lastQuery = '';
  let lastMatches = 0;
  let lastActive = 0;

  function ensureBar() {
    if (bar) return bar;

    bar = document.createElement('div');
    bar.id = 'find-bar';
    bar.className = 'find-bar hidden';
    bar.setAttribute('role', 'search');
    bar.setAttribute('aria-label', 'Find in page');

    input = document.createElement('input');
    input.type = 'search';
    input.className = 'input-field find-bar-input';
    input.placeholder = 'Find in page…';
    input.setAttribute('aria-label', 'Find text');
    input.autocomplete = 'off';
    input.spellcheck = false;

    counter = document.createElement('span');
    counter.className = 'find-bar-counter';
    counter.textContent = '';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-icon';
    prevBtn.title = 'Previous match';
    prevBtn.setAttribute('aria-label', 'Previous match');
    prevBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="18 15 12 9 6 15"></polyline></svg>';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-icon';
    nextBtn.title = 'Next match';
    nextBtn.setAttribute('aria-label', 'Next match');
    nextBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="6 9 12 15 18 9"></polyline></svg>';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-icon';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close find bar');
    closeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" ' +
      'stroke-linecap="round" aria-hidden="true">' +
      '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    bar.append(input, counter, prevBtn, nextBtn, closeBtn);

    const host = document.querySelector('.app-container') || document.body;
    host.appendChild(bar);

    let inputTimer = null;
    input.addEventListener('input', () => {
      const query = input.value;
      if (inputTimer) clearTimeout(inputTimer);
      if (!query) {
        stopFind();
        counter.textContent = '';
        return;
      }
      // Debounce keystrokes so we don't spam findInPage on every character.
      inputTimer = setTimeout(() => {
        inputTimer = null;
        runFind(query, { findNext: false });
      }, 120);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runFind(input.value, { findNext: true, forward: !event.shiftKey });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        app.closeFindBar();
      }
    });

    prevBtn.addEventListener('click', () => runFind(input.value, { findNext: true, forward: false }));
    nextBtn.addEventListener('click', () => runFind(input.value, { findNext: true, forward: true }));
    closeBtn.addEventListener('click', () => app.closeFindBar());

    return bar;
  }

  function runFind(text, options) {
    const tabId = app.state.currentTabId;
    if (!tabId || !window.electronAPI.findInPage) return;
    lastQuery = text || '';
    window.electronAPI.findInPage(tabId, lastQuery, options || {}).catch(() => {});
  }

  function stopFind() {
    const tabId = app.state.currentTabId;
    if (!tabId || !window.electronAPI.stopFindInPage) return;
    window.electronAPI.stopFindInPage(tabId).catch(() => {});
    lastQuery = '';
    lastMatches = 0;
    lastActive = 0;
  }

  app.openFindBar = function openFindBar() {
    if (!app.state.currentTabId) {
      app.toast('Open a tab first to search its page', 'info');
      return;
    }
    ensureBar();
    bar.classList.remove('hidden');
    input.focus();
    input.select();
  };

  app.closeFindBar = function closeFindBar() {
    if (!bar) return;
    bar.classList.add('hidden');
    stopFind();
    if (counter) counter.textContent = '';
  };

  app.isFindBarOpen = function isFindBarOpen() {
    return Boolean(bar && !bar.classList.contains('hidden'));
  };

  app.initFindBar = function initFindBar() {
    if (window.electronAPI.onTabFindResult) {
      window.electronAPI.onTabFindResult((result) => {
        if (!result || result.tabId !== app.state.currentTabId) return;
        if (!counter) return;
        lastMatches = result.matches || 0;
        lastActive = result.activeMatchOrdinal || 0;
        if (!lastQuery) {
          counter.textContent = '';
          return;
        }
        counter.textContent =
          lastMatches > 0 ? `${lastActive} of ${lastMatches}` : 'No matches';
        counter.classList.toggle('no-matches', lastMatches === 0);
      });
    }
  };
})(window.AiHub);
