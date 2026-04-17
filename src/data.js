const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const configStore = require('./config');
const log = require('electron-log');

let dataDir = null;
let servicesPath = null;
let rulesPath = null;

function initPaths() {
  if (!dataDir) {
    dataDir = path.join(app.getPath('userData'), 'data');
    servicesPath = path.join(dataDir, 'remote_services.json');
    rulesPath = path.join(dataDir, 'remote_rules.json');
  }
}

let rulesCache = null;
let commonAuthDomains = new Set();

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (response.headers.location) {
          return fetchUrl(response.headers.location).then(resolve).catch(reject);
        }
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP Status ${response.statusCode}`));
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function updateRemoteData() {
  initPaths();
  try {
    const config = configStore.getConfig();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    log.info("Downloading services...");
    const servicesData = await fetchUrl(config.remoteUrls.services);
    fs.writeFileSync(servicesPath, servicesData);

    log.info("Downloading rules...");
    const rulesData = await fetchUrl(config.remoteUrls.rules);
    fs.writeFileSync(rulesPath, rulesData);

    // Clear cache
    rulesCache = null;

    configStore.updateConfigItem('lastUpdate', new Date().toISOString());

    loadRules();
    return { success: true };
  } catch (error) {
    log.error('Error updating data:', error);
    return { success: false, error: error.message };
  }
}

function loadServices() {
  initPaths();
  try {
    if (fs.existsSync(servicesPath)) {
      const data = fs.readFileSync(servicesPath, 'utf8');
      if (!data) return null;
      return JSON.parse(data);
    }
  } catch (error) {
    log.error('Error loading services:', error);
  }
  return null;
}

function loadRules() {
  initPaths();
  try {
    if (rulesCache) return rulesCache;

    if (fs.existsSync(rulesPath)) {
      const data = fs.readFileSync(rulesPath, 'utf8');
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
}

function getCommonAuthDomains() {
  if (!rulesCache) {
    loadRules();
  }
  return commonAuthDomains;
}

function getRulesCache() {
    return rulesCache;
}

module.exports = {
  updateRemoteData,
  loadServices,
  loadRules,
  getCommonAuthDomains,
  getRulesCache
};
