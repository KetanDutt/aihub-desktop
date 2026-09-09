/**
 * Restoring a session looks up every persisted tab in the service catalogue.
 * Benchmarks the old O(tabs x services) `Array.find` against the O(tabs) Map.
 *
 *   node benchmarks/tab_lookup.js
 */

'use strict';

const { time, report } = require('./harness');
const { generateId } = require('../ui/utils');

const allServices = [];
for (let i = 0; i < 1000; i += 1) {
  allServices.push({ id: generateId(`Service ${i}`), name: `Service ${i}`, url: `https://s${i}.example` });
}

const openTabs = [];
for (let i = 0; i < 500; i += 1) {
  openTabs.push({ id: generateId(`Service ${i * 2}`), serviceId: generateId(`Service ${i * 2}`) });
}

const ITERATIONS = 200;

console.log('\nSession-restore catalogue lookup (1000 services, 500 tabs)\n');

const baseline = time('Array.find', () => {
  for (let i = 0; i < ITERATIONS; i += 1) {
    for (const savedTab of openTabs) {
      // eslint-disable-next-line no-unused-vars
      const found = allServices.find((s) => s.id === savedTab.serviceId);
    }
  }
});

const optimized = time('Map.get', () => {
  const servicesMap = new Map(allServices.map((s) => [s.id, s]));
  for (let i = 0; i < ITERATIONS; i += 1) {
    for (const savedTab of openTabs) {
      // eslint-disable-next-line no-unused-vars
      const found = servicesMap.get(savedTab.serviceId);
    }
  }
});

report('Array.find', baseline, 'Map.get', optimized);
