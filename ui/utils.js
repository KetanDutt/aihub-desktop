window.App = window.App || {};

window.showStatus = (message, type = 'info') => {
  const statusText = document.getElementById('status-text');
  if (statusText) statusText.textContent = message;

  const container = document.getElementById('status-message');
  if (container) container.className = `status-message ${type}`;

  const loadingIndicator = document.getElementById('loading-indicator');
  if (loadingIndicator) {
    if (type === 'loading') {
      loadingIndicator.classList.remove('hidden');
    } else {
      loadingIndicator.classList.add('hidden');
    }
  }

  setTimeout(() => {
    if (statusText) statusText.textContent = 'Ready';
    if (container) container.className = 'status-message';
    if (loadingIndicator) loadingIndicator.classList.add('hidden');
  }, 3000);
};

window.formatDate = (isoString) => {
  if (!isoString) return 'Never';
  return new Date(isoString).toLocaleString('en-US');
};

window.generateId = (name) => {
  return name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
};

window.updateBlockingUI = (enabled) => {
  if (window.elements && window.elements.blockingIndicator) {
    window.elements.blockingIndicator.className = enabled ? 'indicator active' : 'indicator inactive';
    window.elements.blockingText.textContent = enabled ? 'Blocking Active' : 'Blocking Disabled';
  }
};

window.applyDarkMode = (enabled) => {
  if (enabled) {
    document.body.classList.remove('light-mode');
  } else {
    document.body.classList.add('light-mode');
  }
};
