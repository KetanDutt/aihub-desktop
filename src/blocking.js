const { session } = require('electron');
const configStore = require('./config');
const dataStore = require('./data');
const log = require('electron-log');

function isDomainAllowed(hostname, serviceDomains, blockingEnabled, commonAuthDomains) {
  if (!blockingEnabled) return true;

  // Always allow common auth domains
  for (const domain of commonAuthDomains) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return true;
    }
  }

  // Check service whitelist
  if (serviceDomains && serviceDomains.length > 0) {
    for (const domain of serviceDomains) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }
  }

  return false;
}

function setupWebRequestBlocking() {
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      try {
        // Early return for local/internal protocols
        if (
          details.url.startsWith('devtools://') ||
          details.url.startsWith('file://') ||
          details.url.startsWith('chrome-extension://') ||
          details.url.startsWith('localhost') ||
          details.url.startsWith('127.0.0.1')
        ) {
          return callback({});
        }

        const url = new URL(details.url);
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
          log.info(`Blocked: ${hostname} (Service: ${serviceId || 'none'})`);
          callback({ cancel: true }); // Block
        }
      } catch (e) {
        log.error('Error in blocker:', e);
        callback({});
      }
    }
  );
}

module.exports = {
  isDomainAllowed,
  setupWebRequestBlocking
};
