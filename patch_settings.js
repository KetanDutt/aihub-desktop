const fs = require('fs');

let htmlCode = fs.readFileSync('ui/index.html', 'utf8');
htmlCode = htmlCode.replace(/<button id="btn-save-settings" class="btn btn-primary">Save Changes<\/button>/, '');
fs.writeFileSync('ui/index.html', htmlCode);

let rendererCode = fs.readFileSync('ui/renderer.js', 'utf8');
rendererCode = rendererCode.replace(/btnSaveSettings: document\.getElementById\('btn-save-settings'\),/, '');

// Debounce helper
const debounceCode = `
  let saveSettingsTimeout;
  const debouncedSaveSettings = () => {
    clearTimeout(saveSettingsTimeout);
    saveSettingsTimeout = setTimeout(() => {
      saveSettings();
    }, 500);
  };
`;
rendererCode = rendererCode.replace(/const saveSettings = async \(\) => \{/, `${debounceCode}\n  const saveSettings = async () => {`);

const newListeners = `
  elements.toggleBlocking.addEventListener('change', debouncedSaveSettings);
  elements.maxServicesInput.addEventListener('input', debouncedSaveSettings);
  elements.toggleDarkMode.addEventListener('change', debouncedSaveSettings);
`;
rendererCode = rendererCode.replace(/\/\/ Save settings\n\s*elements\.btnSaveSettings\.addEventListener\('click', saveSettings\);/, `// Auto-save settings\n${newListeners}`);

fs.writeFileSync('ui/renderer.js', rendererCode);
