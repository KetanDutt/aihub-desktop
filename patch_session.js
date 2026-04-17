const fs = require('fs');

let code = fs.readFileSync('ui/renderer.js', 'utf8');

// The initial replacement failed because the regex was slightly off due to the new deep link code added earlier.
// Let's do a more precise replacement.

const oldRestoreCode = `      // Restore Session Tabs
      if (config.openTabs && config.openTabs.length > 0) {
        for (const savedTab of config.openTabs) {
          // Find matching service metadata to get the title
          const serviceMeta = allServices.find(s => generateId(s[0]) === savedTab.id);
          const title = serviceMeta ? serviceMeta[0] : savedTab.id;
          await createTab(savedTab.id, savedTab.url, title);
        }

        // Restore active tab
        if (config.activeTabId && config.openTabs.find(t => t.id === config.activeTabId)) {
          switchToTab(config.activeTabId);
        } else {
          // Switch to the first tab if the last active was closed
          switchToTab(config.openTabs[0].id);
        }
      }`;

const newRestoreCode = `      // Restore Session Tabs
      if (config.openTabs && config.openTabs.length > 0) {
        let validTabs = [];
        for (const savedTab of config.openTabs) {
          // Find matching service metadata to get the title
          const serviceMeta = allServices.find(s => generateId(s[0]) === savedTab.id);
          if (serviceMeta) {
              const title = serviceMeta[0];
              await createTab(savedTab.id, savedTab.url, title);
              validTabs.push(savedTab);
          } else {
              console.warn(\`Skipping invalid saved tab: \${savedTab.id}\`);
              showStatus(\`Skipped deprecated service: \${savedTab.id}\`, 'warning');
          }
        }

        // Restore active tab
        if (config.activeTabId && validTabs.find(t => t.id === config.activeTabId)) {
          switchToTab(config.activeTabId);
        } else if (validTabs.length > 0) {
          // Switch to the first valid tab if the last active was closed
          switchToTab(validTabs[0].id);
        }
      }`;

code = code.replace(oldRestoreCode, newRestoreCode);

fs.writeFileSync('ui/renderer.js', code);
