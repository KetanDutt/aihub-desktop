/**
 * Benchmarks the shipped domain allow-list (`src/blocking.js#isDomainAllowed`)
 * against the original O(allow-list) implementation.
 *
 *   node benchmarks/blocking.js
 */

'use strict';

const { installElectronStub, time, report } = require('./harness');

installElectronStub();

const { isDomainAllowed } = require('../src/blocking');

// The historical implementation: linear scan with endsWith() per entry.
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

function isDomainAllowedBaseline(hostname, serviceDomains, blockingEnabled, commonAuthDomains) {
  if (!blockingEnabled) return true;
  for (const domain of commonAuthDomains) {
    if (matchesDomain(hostname, domain)) return true;
  }
  if (serviceDomains && serviceDomains.length > 0) {
    for (const domain of serviceDomains) {
      if (matchesDomain(hostname, domain)) return true;
    }
  }
  return false;
}

const commonAuthDomains = new Set([
  'google.com',
  'accounts.google.com',
  'login.microsoft.com',
  'github.com',
  'okta.com',
  'auth0.com'
]);
const serviceDomains = new Set([
  'openai.com',
  'chat.openai.com',
  'cdn.openai.com',
  'oaistatic.com',
  'claude.ai',
  'anthropic.com'
]);

// Worst case for the baseline: a hostname that matches nothing.
const hostnames = [
  'notopenai.com',
  'sub.service99.example',
  'a.b.c.d.e.f.example.com',
  'cdn.openai.com' // best case
];

const ITERATIONS = 200000;

console.log('\nisDomainAllowed — baseline (array scan) vs shipped (set walk)\n');

const baseline = time(`baseline x${ITERATIONS}`, () => {
  for (let i = 0; i < ITERATIONS; i += 1) {
    for (const host of hostnames) {
      isDomainAllowedBaseline(host, [...serviceDomains], true, [...commonAuthDomains]);
    }
  }
});

const optimized = time(`shipped x${ITERATIONS}`, () => {
  for (let i = 0; i < ITERATIONS; i += 1) {
    for (const host of hostnames) {
      isDomainAllowed(host, serviceDomains, true, commonAuthDomains);
    }
  }
});

report('baseline', baseline, 'shipped', optimized);

// Correctness cross-check: the two implementations must agree.
const samples = [
  'openai.com',
  'api.openai.com',
  'notopenai.com',
  'accounts.google.com',
  'evil.com',
  'cdn.openai.com.evil.com'
];
let mismatches = 0;
for (const host of samples) {
  const a = isDomainAllowedBaseline(host, [...serviceDomains], true, [...commonAuthDomains]);
  const b = isDomainAllowed(host, serviceDomains, true, commonAuthDomains);
  if (a !== b) {
    mismatches += 1;
    console.error(`  MISMATCH for ${host}: baseline=${a} shipped=${b}`);
  }
}
console.log(`  correctness cross-check: ${samples.length - mismatches}/${samples.length} agree\n`);
if (mismatches > 0) process.exit(1);
