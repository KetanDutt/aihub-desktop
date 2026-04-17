const fs = require('fs');

let code = fs.readFileSync('ui/renderer.js', 'utf8');

// Modify renderAllServicesInSettings toggle listener
//   const toggle = item.querySelector('input[type="checkbox"]');
//   toggle.addEventListener('change', async (e) => {
//     const serviceId = e.target.dataset.serviceId;
//     try {
//       const result = await window.electronAPI.toggleService(serviceId);
//       config.enabledServices = result;
//       renderEnabledServices();

const oldToggle = `      toggle.addEventListener('change', async (e) => {
        const serviceId = e.target.dataset.serviceId;
        try {
          const result = await window.electronAPI.toggleService(serviceId);
          config.enabledServices = result;
          renderEnabledServices();
          showStatus(\`Service \${e.target.checked ? 'enabled' : 'disabled'}\`, 'success');
        } catch (error) {
          console.error('Error toggling service:', error);
          showStatus('Error updating service', 'error');
          // Revert toggle
          e.target.checked = !e.target.checked;
        }
      });`;

const newToggle = `      toggle.addEventListener('change', async (e) => {
        const serviceId = e.target.dataset.serviceId;
        try {
          const result = await window.electronAPI.toggleService(serviceId);

          // Only re-render if the set actually changed lengths or elements
          const changed = result.length !== config.enabledServices.length ||
                          !result.every(val => config.enabledServices.includes(val));

          config.enabledServices = result;

          if (changed) {
              renderEnabledServices();
          }

          showStatus(\`Service \${e.target.checked ? 'enabled' : 'disabled'}\`, 'success');
        } catch (error) {
          console.error('Error toggling service:', error);
          showStatus('Error updating service', 'error');
          // Revert toggle
          e.target.checked = !e.target.checked;
        }
      });`;

code = code.replace(oldToggle, newToggle);

fs.writeFileSync('ui/renderer.js', code);
