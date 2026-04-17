
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}
const { session } = require('electron');
const configStore = require('./config');
const dataStore = require('./data');
const log = require('electron-log');

function isDomainAllowed(hostname, serviceDomains, blockingEnabled, commonAuthDomains) {
  if (!blockingEnabled) return true;

  // Always allow common auth domains
  for (const domain of commonAuthDomains) {
    if (matchesDomain(hostname, domain)) {
      return true;
    }
  }

  // Check service whitelist
  if (serviceDomains && serviceDomains.length > 0) {
    for (const domain of serviceDomains) {
      if (matchesDomain(hostname, domain)) {
        return true;
      }
    }
  }

  return false;
}


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

        if (isDomainAllowed(hostname, blockingState.allowedDomains, blockingState.enabled, blockingState.commonAuthDomains)) {
          callback({}); // Allow
        } else {
          log.info(`Blocked: ${hostname} (Service: ${blockingState.activeServiceId || 'none'})`);
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
  updateBlockingState,
  isDomainAllowed,
  setupWebRequestBlocking
};
