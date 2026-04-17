const fs = require('fs');

// Patch index.html
let htmlCode = fs.readFileSync('ui/index.html', 'utf8');
const navButtons = `
      <!-- Navigation -->
      <div class="nav-controls">
        <button id="btn-nav-back" class="btn btn-icon" title="Go Back">◀</button>
        <button id="btn-nav-forward" class="btn btn-icon" title="Go Forward">▶</button>
        <button id="btn-nav-reload" class="btn btn-icon" title="Reload">↻</button>
      </div>
      <!-- Tabs Container -->`;
htmlCode = htmlCode.replace(/<!-- Tabs Container -->/, navButtons);
fs.writeFileSync('ui/index.html', htmlCode);

// Patch styles.css to ensure nav buttons display nicely inline
let cssCode = fs.readFileSync('ui/styles.css', 'utf8');
cssCode += `\n.nav-controls { display: flex; align-items: center; background-color: var(--bg-tertiary); border-top: 1px solid var(--border-color); padding-left: 8px; }\n.nav-controls button { font-size: 14px; padding: 4px; }\n`;
fs.writeFileSync('ui/styles.css', cssCode);

// Patch renderer.js
let rendererCode = fs.readFileSync('ui/renderer.js', 'utf8');
const domElements = `                          btnNavBack: document.getElementById('btn-nav-back'),
                          btnNavForward: document.getElementById('btn-nav-forward'),
                          btnNavReload: document.getElementById('btn-nav-reload'),`;
rendererCode = rendererCode.replace(/tabsList: document\.getElementById\('tabs-list'\),/, `tabsList: document.getElementById('tabs-list'),\n${domElements}`);

const listeners = `
  elements.btnNavBack.addEventListener('click', () => {
    if (currentTabId) try { window.electronAPI.navGoBack(currentTabId); } catch(e){}
  });
  elements.btnNavForward.addEventListener('click', () => {
    if (currentTabId) try { window.electronAPI.navGoForward(currentTabId); } catch(e){}
  });
  elements.btnNavReload.addEventListener('click', () => {
    if (currentTabId) try { window.electronAPI.navReload(currentTabId); } catch(e){}
  });
`;
rendererCode = rendererCode.replace(/\/\/ --- Initialization ---/, `${listeners}\n  // --- Initialization ---`);
fs.writeFileSync('ui/renderer.js', rendererCode);

// Patch preload.js
let preloadCode = fs.readFileSync('preload.js', 'utf8');
preloadCode = preloadCode.replace(
/onDeepLinkOpen: \(callback\) => ipcRenderer\.on\('deep-link-open', \(_event, serviceId\) => callback\(serviceId\)\)/,
`onDeepLinkOpen: (callback) => ipcRenderer.on('deep-link-open', (_event, serviceId) => callback(serviceId)),
    navGoBack: (serviceId) => ipcRenderer.send('nav-go-back', serviceId),
    navGoForward: (serviceId) => ipcRenderer.send('nav-go-forward', serviceId),
    navReload: (serviceId) => ipcRenderer.send('nav-reload', serviceId)`
);
fs.writeFileSync('preload.js', preloadCode);

// Patch ipc.js
let ipcCode = fs.readFileSync('src/ipc.js', 'utf8');
ipcCode = ipcCode.replace(
/ipcMain\.on\('close-tab', \(event, serviceId\) => \{/,
`  ipcMain.on('nav-go-back', (event, serviceId) => windowManager.navGoBack(serviceId));
  ipcMain.on('nav-go-forward', (event, serviceId) => windowManager.navGoForward(serviceId));
  ipcMain.on('nav-reload', (event, serviceId) => windowManager.navReload(serviceId));

  ipcMain.on('close-tab', (event, serviceId) => {`
);
fs.writeFileSync('src/ipc.js', ipcCode);

// Patch window.js
let windowCode = fs.readFileSync('src/window.js', 'utf8');
const windowNavCode = `
function navGoBack(serviceId) {
    if (views[serviceId] && views[serviceId].webContents.canGoBack()) {
        views[serviceId].webContents.goBack();
    }
}
function navGoForward(serviceId) {
    if (views[serviceId] && views[serviceId].webContents.canGoForward()) {
        views[serviceId].webContents.goForward();
    }
}
function navReload(serviceId) {
    if (views[serviceId]) {
        views[serviceId].webContents.reload();
    }
}
`;
windowCode = windowCode.replace(/module\.exports = \{/, `${windowNavCode}\nmodule.exports = {`);
windowCode = windowCode.replace(
/closeTab,/,
`closeTab,
  navGoBack,
  navGoForward,
  navReload,`
);
fs.writeFileSync('src/window.js', windowCode);
