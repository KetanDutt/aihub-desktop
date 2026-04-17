const fs = require('fs');

let code = fs.readFileSync('src/blocking.js', 'utf8');

// Replace the inside of setupWebRequestBlocking

const blockingStateSetup = `
let blockingState = {
  enabled: true,
  activeServiceId: null,
  allowedDomains: [],
  commonAuthDomains: []
};

function updateBlockingState(config, rules, serviceId) {
  blockingState.enabled = config.blockingEnabled;
  blockingState.activeServiceId = serviceId;

  if (rules && rules.common_auth_domains) {
    blockingState.commonAuthDomains = rules.common_auth_domains;
  }

  if (serviceId && rules && rules.service_domains && rules.service_domains[serviceId]) {
    blockingState.allowedDomains = rules.service_domains[serviceId];
  } else {
    blockingState.allowedDomains = [];
  }
}
`;

code = code.replace(/function setupWebRequestBlocking\(\) \{/, `${blockingStateSetup}\nfunction setupWebRequestBlocking() {`);

const setupWebRequestBlockingOld = `        const url = new URL(details.url);
        const hostname = url.hostname;

        const config = configStore.getConfig();
        const serviceId = config.lastActiveService;
        let serviceDomains = [];

        if (serviceId) {
          const rules = dataStore.getRulesCache() || dataStore.loadRules();
          if (rules && rules.service_domains && rules.service_domains[serviceId]) {
            serviceDomains = rules.service_domains[serviceId];
          }
        }

        if (isDomainAllowed(hostname, serviceDomains, config.blockingEnabled, dataStore.getCommonAuthDomains())) {
          callback({}); // Allow
        } else {
          log.info(\`Blocked: \${hostname} (Service: \${serviceId || 'none'})\`);
          callback({ cancel: true }); // Block
        }`;

const setupWebRequestBlockingNew = `        const url = new URL(details.url);
        const hostname = url.hostname;

        if (isDomainAllowed(hostname, blockingState.allowedDomains, blockingState.enabled, blockingState.commonAuthDomains)) {
          callback({}); // Allow
        } else {
          log.info(\`Blocked: \${hostname} (Service: \${blockingState.activeServiceId || 'none'})\`);
          callback({ cancel: true }); // Block
        }`;

code = code.replace(setupWebRequestBlockingOld, setupWebRequestBlockingNew);
code = code.replace(/module\.exports = \{/, "module.exports = {\n  updateBlockingState,");

fs.writeFileSync('src/blocking.js', code);

// Update IPC and Window to call updateBlockingState when appropriate
let ipcCode = fs.readFileSync('src/ipc.js', 'utf8');
ipcCode = ipcCode.replace(
/ipcMain\.on\('set-active-service', \(event, serviceId\) => \{[\s\S]*?\}\);/,
`ipcMain.on('set-active-service', (event, serviceId) => {
    configStore.updateConfigItem('lastActiveService', serviceId);
    const { updateBlockingState } = require('./blocking');
    updateBlockingState(configStore.getConfig(), dataStore.getRulesCache(), serviceId);
  });`
);
ipcCode = ipcCode.replace(
/ipcMain\.handle\('save-config', \(event, newConfig\) => \{[\s\S]*?\}\);/,
`ipcMain.handle('save-config', (event, newConfig) => {
    const config = configStore.saveConfig(newConfig);
    const { updateBlockingState } = require('./blocking');
    updateBlockingState(config, dataStore.getRulesCache(), config.lastActiveService);
    return config;
  });`
);
fs.writeFileSync('src/ipc.js', ipcCode);

// initialize blocking in main
let mainCode = fs.readFileSync('main.js', 'utf8');
mainCode = mainCode.replace(
/blockingManager\.setupWebRequestBlocking\(\);/,
`blockingManager.updateBlockingState(require('./src/config').getConfig(), require('./src/data').getRulesCache(), require('./src/config').getConfig().lastActiveService);
    blockingManager.setupWebRequestBlocking();`
);
fs.writeFileSync('main.js', mainCode);
