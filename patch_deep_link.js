const fs = require('fs');

let code = fs.readFileSync('main.js', 'utf8');

const handleDeepLink = `
function handleDeepLinkUrl(urlStr) {
    if (!urlStr || !urlStr.startsWith('aihub://')) return;
    try {
        const urlObj = new URL(urlStr);
        const serviceId = urlObj.hostname; // e.g. aihub://chatgpt -> chatgpt
        if (!serviceId) return;

        const mainWindow = windowManager.getMainWindow();
        if (mainWindow) {
            // Send IPC to renderer to create/switch tab because renderer manages state
            mainWindow.webContents.send('deep-link-open', serviceId);
        }
    } catch (e) {
        log.error('Failed to parse deep link:', e);
    }
}
`;

code = code.replace(/const gotTheLock = app\.requestSingleInstanceLock\(\);/, `${handleDeepLink}\nconst gotTheLock = app.requestSingleInstanceLock();`);

code = code.replace(
/if \(url\) \{\n\s*log\.info\('Opened via deep link:', url\);\n\s*\/\/ We could route this to switch to a specific tab\n\s*\}/,
`if (url) {\n        log.info('Opened via deep link:', url);\n        handleDeepLinkUrl(url);\n    }`
);

code = code.replace(
/event\.preventDefault\(\);\n\s*log\.info\('Opened via deep link \(macOS\):', url\);/,
`event.preventDefault();\n      log.info('Opened via deep link (macOS):', url);\n      handleDeepLinkUrl(url);`
);

fs.writeFileSync('main.js', code);

// Patch preload and renderer to handle deep-link-open
let preloadCode = fs.readFileSync('preload.js', 'utf8');
preloadCode = preloadCode.replace(
/setViewBounds: \(bounds\) => ipcRenderer\.send\('set-view-bounds', bounds\)/,
`onDeepLinkOpen: (callback) => ipcRenderer.on('deep-link-open', (_event, serviceId) => callback(serviceId))`
);
fs.writeFileSync('preload.js', preloadCode);

let rendererCode = fs.readFileSync('ui/renderer.js', 'utf8');
const listenerCode = `  // Deep link handling
  if (window.electronAPI.onDeepLinkOpen) {
      window.electronAPI.onDeepLinkOpen((serviceId) => {
          const service = allServices.find(s => generateId(s[0]) === serviceId);
          if (service) {
              const [name, url] = service;
              createTab(serviceId, url, name);
          } else {
              showStatus(\`Service \${serviceId} not found\`, 'warning');
          }
      });
  }

  init();`;
rendererCode = rendererCode.replace(/init\(\);\n\}\);/, `${listenerCode}\n});`);
fs.writeFileSync('ui/renderer.js', rendererCode);
