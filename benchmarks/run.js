#!/usr/bin/env node
/**
 * Run every benchmark.
 *
 *   npm run benchmark
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const targets = ['blocking.js', 'tab_lookup.js', 'services_optimization.js'];

let failed = false;
for (const target of targets) {
  const result = spawnSync(process.execPath, [path.join(__dirname, target)], {
    stdio: 'inherit',
    cwd: __dirname
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
