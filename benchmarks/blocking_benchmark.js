// Mock electron and config store so we can run the test
const mockElectron = {
    session: { defaultSession: { webRequest: { onBeforeRequest: () => {} } } }
};
const mockConfig = { getConfig: () => ({ blockingEnabled: true }) };
const mockLog = { info: () => {}, error: () => {} };

const m = require('module');
const originalRequire = m.prototype.require;
m.prototype.require = function (path) {
    if (path === 'electron') return mockElectron;
    if (path === './config' || path === '../src/config') return mockConfig;
    if (path === './data') return {};
    if (path === 'electron-log') return mockLog;
    return originalRequire.apply(this, arguments);
};

// Reset modules so require() loads the updated code for "optimized" check
delete require.cache[require.resolve('../src/blocking')];
const { isDomainAllowed: isDomainAllowedOpt } = require('../src/blocking');

// Load an old version of isDomainAllowed for "baseline" check
const fs = require('fs');
const oldBlockingSrc = fs.readFileSync('./src/blocking.js', 'utf8')
    .replace('if (serviceDomains && (serviceDomains.length > 0 || serviceDomains.size > 0)) {', 'if (serviceDomains && serviceDomains.length > 0) {');

const Module = module.constructor;
const m2 = new Module();
m2._compile(oldBlockingSrc, 'old_blocking.js');
const isDomainAllowedBaseline = m2.exports.isDomainAllowed;

const commonAuthDomains = new Set(['google.com', 'accounts.google.com', 'login.microsoft.com']);
const serviceDomains = new Set(['openai.com', 'chat.openai.com', 'cdn.openai.com']);

const hostname = 'notopenai.com'; // worst case scenario, has to iterate through everything

const ITERATIONS = 1000000;

console.time('baseline');
for (let i = 0; i < ITERATIONS; i++) {
  // simulate current behavior of array copying
  const allowedDomainsArray = [...serviceDomains];
  isDomainAllowedBaseline(hostname, allowedDomainsArray, true, commonAuthDomains);
}
console.timeEnd('baseline');

console.time('optimized');
for (let i = 0; i < ITERATIONS; i++) {
  // simulate optimized behavior of passing set
  isDomainAllowedOpt(hostname, serviceDomains, true, commonAuthDomains);
}
console.timeEnd('optimized');
