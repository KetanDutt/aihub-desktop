#!/usr/bin/env node
/**
 * Remove build artefacts.
 *
 *   node scripts/clean.js           remove dist/, coverage/, .aihub/
 *   node scripts/clean.js --deps    also remove node_modules/
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const includeDeps = process.argv.includes('--deps');

const targets = ['dist', 'coverage', '.aihub', '.cache'];
if (includeDeps) targets.push('node_modules');

let removed = 0;
for (const target of targets) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) continue;
  fs.rmSync(full, { recursive: true, force: true });
  console.log(`removed ${target}/`);
  removed += 1;
}

if (removed === 0) console.log('nothing to clean');
