// ui/settings.js
// Settings logic moved to main renderer to preserve state closures for now.


window.saveSettingsTimeout = null;
let saveSettingsTimeout = window.saveSettingsTimeout;

window.debouncedSaveSettings = () => {
  clearTimeout(saveSettingsTimeout);
  saveSettingsTimeout = setTimeout(() => {
    window.saveSettings();
  }, 500);
};

window.saveSettings = async () => {
  if (!window.elements) return;

  const useProxy = window.elements.toggleProxy ? window.elements.toggleProxy.checked : false;
  const proxyUrl = window.elements.proxyUrlInput ? window.elements.proxyUrlInput.value : '';

  // Validate proxy URL if enabled
  if (useProxy && proxyUrl) {
    try {
      const url = new URL(proxyUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        window.showStatus('Invalid Proxy Protocol', 'error');
        return;
      }
    } catch (e) {
      window.showStatus('Invalid Proxy URL', 'error');
      return;
    }
  }

  const newConfig = {
    blockingEnabled: window.elements.toggleBlocking.checked,
    maxActiveServices: parseInt(window.elements.maxServicesInput.value) || 3,
    darkMode: window.elements.toggleDarkMode.checked,
    useProxy: useProxy,
    proxyUrl: proxyUrl
  };

  try {
    window.config = await window.electronAPI.saveConfig(newConfig);
    window.showStatus('Settings saved', 'success');
    window.updateBlockingUI(window.config.blockingEnabled);
    window.applyDarkMode(window.config.darkMode);
  } catch (error) {
    window.showStatus('Error saving settings', 'error');
  }
};
