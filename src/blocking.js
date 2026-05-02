
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
  if (serviceDomains && (serviceDomains.length > 0 || serviceDomains.size > 0)) {
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
  commonAuthDomains: []
};

const tabDomainMap = new Map(); // webContentsId -> Set of allowed domains

function updateTabDomains(webContentsId, serviceId, rules) {
  const allowed = rules?.service_domains?.[serviceId] || [];
  tabDomainMap.set(webContentsId, new Set(allowed));
}

function removeTabDomains(webContentsId) {
  tabDomainMap.delete(webContentsId);
}

function updateBlockingState(config, rules, serviceId) {
  blockingState.enabled = config.blockingEnabled;

  if (rules && rules.common_auth_domains) {
    blockingState.commonAuthDomains = rules.common_auth_domains;
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

        // Find allowed domains for this specific webContents
        let allowedDomains = null;
        if (details.webContentsId !== undefined) {
          allowedDomains = tabDomainMap.get(details.webContentsId);
        }

        if (isDomainAllowed(hostname, allowedDomains, blockingState.enabled, blockingState.commonAuthDomains)) {
          callback({}); // Allow
        } else {
          log.info(`Blocked: ${hostname} for webContents ${details.webContentsId}`);
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
  setupWebRequestBlocking,
  updateTabDomains,
  removeTabDomains
};
