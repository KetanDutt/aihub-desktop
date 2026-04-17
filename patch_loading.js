const fs = require('fs');

let code = fs.readFileSync('ui/renderer.js', 'utf8');

const updateListenerOld = `  // Update services
  elements.btnUpdate.addEventListener('click', async () => {
    showStatus('Updating services...', 'info');

    try {
      const result = await window.electronAPI.updateRemoteData();
      if (result.success) {
        await loadServices();
        elements.lastUpdate.textContent = formatDate(config.lastUpdate);
        showStatus('Update successful', 'success');
      } else {
        showStatus('Update failed: ' + result.error, 'error');
      }
    } catch (error) {
      showStatus('Update failed', 'error');
    }
  });`;

const updateListenerNew = `  // Update services
  elements.btnUpdate.addEventListener('click', async () => {
    elements.btnUpdate.disabled = true;
    const icon = elements.btnUpdate.querySelector('span');
    if (icon) icon.classList.add('spin');
    showStatus('Updating services...', 'loading');

    try {
      const result = await window.electronAPI.updateRemoteData();
      if (result.success) {
        await loadServices();
        elements.lastUpdate.textContent = formatDate(config.lastUpdate);
        showStatus('Update successful', 'success');
      } else {
        showStatus('Update failed: ' + result.error, 'error');
      }
    } catch (error) {
      showStatus('Update failed', 'error');
    } finally {
      elements.btnUpdate.disabled = false;
      if (icon) icon.classList.remove('spin');
    }
  });`;

code = code.replace(updateListenerOld, updateListenerNew);
fs.writeFileSync('ui/renderer.js', code);

let cssCode = fs.readFileSync('ui/styles.css', 'utf8');
cssCode += `\n.spin { display: inline-block; animation: spin 1s linear infinite; }\n@keyframes spin { 100% { transform: rotate(360deg); } }\n`;
fs.writeFileSync('ui/styles.css', cssCode);
