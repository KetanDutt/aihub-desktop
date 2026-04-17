const fs = require('fs');

// Patch data.js
let code = fs.readFileSync('src/data.js', 'utf8');
code = code.replace(/const fs = require\('fs'\);/, "const fs = require('fs');\nconst fsPromises = fs.promises;");

code = code.replace(
/function loadServices\(\) \{[\s\S]*?return null;\n\}/,
`async function loadServices() {
  initPaths();
  try {
    if (fs.existsSync(servicesPath)) {
      const data = await fsPromises.readFile(servicesPath, 'utf8');
      if (!data) return null;
      return JSON.parse(data);
    }
  } catch (error) {
    log.error('Error loading services:', error);
  }
  return null;
}`
);

code = code.replace(
/function loadRules\(\) \{[\s\S]*?return null;\n\}/,
`async function loadRules() {
  initPaths();
  try {
    if (rulesCache) return rulesCache;

    if (fs.existsSync(rulesPath)) {
      const data = await fsPromises.readFile(rulesPath, 'utf8');
      if (!data) return null;

      const rules = JSON.parse(data);
      rulesCache = rules;

      if (rules.common_auth_domains) {
        commonAuthDomains = new Set(rules.common_auth_domains);
        log.info('Common Auth Domains Updated:', rules.common_auth_domains);
      }

      return rules;
    }
  } catch (error) {
    log.error('Error loading rules:', error);
  }
  return null;
}`
);

code = code.replace(
/fs\.writeFileSync\(servicesPath, servicesData\);/,
"await fsPromises.writeFile(servicesPath, servicesData);"
);
code = code.replace(
/fs\.writeFileSync\(rulesPath, rulesData\);/,
"await fsPromises.writeFile(rulesPath, rulesData);"
);

code = code.replace(
/loadRules\(\);\n\s*return \{ success: true \};/,
"await loadRules();\n    return { success: true };"
);

fs.writeFileSync('src/data.js', code);

// Patch main.js to await loadRules
let mainCode = fs.readFileSync('main.js', 'utf8');
mainCode = mainCode.replace(/dataStore\.loadRules\(\);/, "await dataStore.loadRules();");
mainCode = mainCode.replace(/app\.whenReady\(\)\.then\(\(\) => \{/, "app.whenReady().then(async () => {");
fs.writeFileSync('main.js', mainCode);

// Patch ipc.js
let ipcCode = fs.readFileSync('src/ipc.js', 'utf8');
ipcCode = ipcCode.replace(/ipcMain\.handle\('get-services', \(\) => \{[\s\S]*?\}\);/, "ipcMain.handle('get-services', async () => {\n    return await dataStore.loadServices();\n  });");
ipcCode = ipcCode.replace(/ipcMain\.handle\('get-rules', \(\) => dataStore\.loadRules\(\)\);/, "ipcMain.handle('get-rules', async () => await dataStore.loadRules());");
fs.writeFileSync('src/ipc.js', ipcCode);
