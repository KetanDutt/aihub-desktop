window.App = window.App || {};

const svgClose = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

window.createTab = async (serviceId, url, title, savedTabId = null) => {
  if (window.activeTabs.length >= window.config.maxActiveServices) {
    window.showStatus(`Memory limit reached (${window.config.maxActiveServices} services). Close a tab first.`, 'warning');
    return;
  }

  const tabId = savedTabId || `${serviceId}-${Date.now()}`;

  // Create tab element
  const tab = document.createElement('div');
  tab.className = 'tab-item active';
  tab.dataset.id = tabId;
  tab.setAttribute('draggable', 'true');

  let faviconHostname = '';
  try {
      faviconHostname = new URL(url).hostname;
  } catch (e) {
      console.error('Invalid URL for favicon:', url);
  }

  const img = document.createElement('img');
  img.className = 'tab-favicon';
  if (faviconHostname) {
      img.src = `https://${faviconHostname}/favicon.ico`;
      img.onerror = function() { this.style.display = 'none'; };
  } else {
      img.style.display = 'none';
  }

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = title;

  const loadingSpan = document.createElement('span');
  loadingSpan.className = 'tab-loading spin hidden';
  loadingSpan.style.display = 'inline-flex';
  loadingSpan.style.alignItems = 'center';
  loadingSpan.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-close-tab';
  closeBtn.innerHTML = svgClose;

  tab.appendChild(img);
  tab.appendChild(titleSpan);
  tab.appendChild(loadingSpan);
  tab.appendChild(closeBtn);

  // Simple Drag and Drop
  tab.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', tabId);
      e.currentTarget.classList.add('dragging');
  });
  tab.addEventListener('dragend', (e) => {
      e.currentTarget.classList.remove('dragging');
  });
  tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.dragging');
      if (dragging && dragging !== tab) {
          const list = window.elements.tabsList;
          const children = Array.from(list.children);
          if (children.indexOf(dragging) < children.indexOf(tab)) {
              tab.after(dragging);
          } else {
              tab.before(dragging);
          }
      }
  });
  tab.addEventListener('drop', (e) => {
      e.preventDefault();
      // Update activeTabs array based on DOM order
      const newOrderIds = Array.from(window.elements.tabsList.children).map(el => el.dataset.id);
      window.activeTabs.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
  });

  // Add event listeners
  tab.addEventListener('click', (e) => {
    if (!e.target.closest('.btn-close-tab')) {
      window.switchToTab(tabId);
    }
  });

  tab.querySelector('.btn-close-tab').addEventListener('click', (e) => {
    e.stopPropagation();
    window.closeTab(tabId);
  });

  tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // A minimal context menu simulation
      if (confirm(`Close all OTHER tabs?`)) {
          const tabsToClose = window.activeTabs.filter(t => t.id !== tabId).map(t => t.id);
          tabsToClose.forEach(id => window.closeTab(id));
      }
  });

  // Add to DOM
  window.elements.tabsList.appendChild(tab);

  // Instead of <webview>, invoke main process WebContentsView
  try {
      const result = await window.electronAPI.createTab(tabId, serviceId, url, '');
      if (result && result.success === false) {
           window.showStatus(`Cannot create tab: ${result.error}`, 'error');
           tab.remove();
           return;
      }

      // Update state
      window.activeTabs.push({ id: tabId, serviceId, url, title });
      window.switchToTab(tabId);

      // Hide welcome screen
      window.elements.welcomeScreen.style.display = 'none';

      // Set active service for blocking
      try { window.electronAPI.setActiveService(serviceId); } catch(err) { console.error(err); }
  } catch(err) {
      window.showStatus(`Error creating tab: ${err}`, 'error');
      tab.remove();
  }
};

window.switchToNextTab = (direction) => {
  if (window.activeTabs.length < 2) return;
  const currentIndex = window.activeTabs.findIndex(t => t.id === window.currentTabId);
  let nextIndex = currentIndex + direction;
  if (nextIndex >= window.activeTabs.length) nextIndex = 0;
  if (nextIndex < 0) nextIndex = window.activeTabs.length - 1;
  window.switchToTab(window.activeTabs[nextIndex].id);
};

window.switchToTab = (id) => {
  // Update tabs UI
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.id === id);
  });

  window.currentTabId = id;

  // Ask main process to show specific WebContentsView
  try { window.electronAPI.switchTab(id); } catch(err) { console.error(err); }

  // Update nav buttons
  const tabData = window.activeTabs.find(t => t.id === id);
  if (tabData) {
      if (window.elements.btnNavBack) window.elements.btnNavBack.disabled = !tabData.canGoBack;
      if (window.elements.btnNavForward) window.elements.btnNavForward.disabled = !tabData.canGoForward;
  }

  // Update active service for blocking
  if (tabData) {
      try { window.electronAPI.setActiveService(tabData.serviceId); } catch(err) { console.error(err); }
  }
};

window.closeTab = (id) => {
  // Remove from DOM
  const tab = document.querySelector(`.tab-item[data-id="${id}"]`);
  if (tab) tab.remove();

  // Remove from state
  const index = window.activeTabs.findIndex(t => t.id === id);
  if (index !== -1) {
    window.activeTabs.splice(index, 1);
  }

  // Ask main process to destroy WebContentsView
  try { window.electronAPI.closeTab(id); } catch(err) { console.error(err); }

  // Switch to another tab or show welcome
  if (window.activeTabs.length > 0) {
    const newIndex = Math.min(index, window.activeTabs.length - 1);
    window.switchToTab(window.activeTabs[newIndex].id);
  } else {
    window.elements.welcomeScreen.style.display = 'flex';
    window.currentTabId = null;
  }
};

if (window.electronAPI.onTabLoading) {
    window.electronAPI.onTabLoading(({ tabId, isLoading }) => {
        const tab = document.querySelector(`.tab-item[data-id="${tabId}"]`);
        if (tab) {
            const spinner = tab.querySelector('.tab-loading');
            if (spinner) {
                if (isLoading) {
                    spinner.classList.remove('hidden');
                } else {
                    spinner.classList.add('hidden');
                }
            }
        }
    });
}

if (window.electronAPI.onTabNavState) {
    window.electronAPI.onTabNavState(({ tabId, canGoBack, canGoForward }) => {
        if (window.currentTabId === tabId) {
            if (window.elements.btnNavBack) window.elements.btnNavBack.disabled = !canGoBack;
            if (window.elements.btnNavForward) window.elements.btnNavForward.disabled = !canGoForward;
        }
        const tabData = window.activeTabs.find(t => t.id === tabId);
        if (tabData) {
            tabData.canGoBack = canGoBack;
            tabData.canGoForward = canGoForward;
        }
    });
}
