const Store = require('electron-store');

const schema = {
  lastUpdate: {
    type: ['string', 'null'],
    default: null
  },
  blockingEnabled: {
    type: 'boolean',
    default: true
  },
  maxActiveServices: {
    type: 'number',
    default: 3
  },
  darkMode: {
    type: 'boolean',
    default: true
  },
  enabledServices: {
    type: 'array',
    items: {
      type: 'string'
    },
    default: ['chatgpt', 'claude', 'gemini']
  },
  lastActiveService: {
    type: ['string', 'null'],
    default: null
  },
  remoteUrls: {
    type: 'object',
    properties: {
      services: {
        type: 'string'
      },
      rules: {
        type: 'string'
      }
    },
    default: {
      services: "https://raw.githubusercontent.com/SilentCoderHere/aihub-config-data/main/ai_services_list.json",
      rules: "https://raw.githubusercontent.com/SilentCoderHere/aihub-config-data/main/domain_filtering_rules.json"
    }
  },
  openTabs: {
    type: 'array',
    default: []
  },
  activeTabId: {
    type: ['string', 'null'],
    default: null
  }
};

const store = new Store({ schema });

function getConfig() {
  return store.store;
}

function saveConfig(newConfig) {
  // Merge with existing config
  if (newConfig.enabledServices) {
    newConfig.enabledServices = [...new Set(newConfig.enabledServices)]; // Remove duplicates
  }

  store.set(newConfig);
  return store.store;
}

function updateConfigItem(key, value) {
  store.set(key, value);
}

function toggleService(serviceId) {
  let enabledServices = store.get('enabledServices', []);
  const index = enabledServices.indexOf(serviceId);
  if (index === -1) {
    enabledServices.push(serviceId);
  } else {
    enabledServices.splice(index, 1);
  }
  store.set('enabledServices', enabledServices);
  return enabledServices;
}

module.exports = {
  getConfig,
  saveConfig,
  updateConfigItem,
  toggleService
};
