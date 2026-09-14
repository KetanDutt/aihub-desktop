#!/usr/bin/env node
/**
 * Cross-platform one-click runner for AI Hub Desktop.
 *
 * Checks Node version, installs npm dependencies + Electron when needed,
 * then launches the app (`npm start`). Works on Windows, macOS and Linux.
 *
 *   node scripts/one-click-run.js
 *   npm run one-click
 *
 * On Windows, prefer double-clicking the root RUN.bat — it can also install
 * Node.js itself via winget/choco/scoop before calling into this flow.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function log(level, message) {
  const colours = {
    step: '\x1b[36m',
    ok: '\x1b[32m',
    warn: '\x1b[33m',
    fail: '\x1b[31m',
    reset: '\x1b[0m'
  };
  const tags = { step: 'aihub', ok: ' ok ', warn: 'warn', fail: 'FAIL' };
  const colour = colours[level] || colours.reset;
  // eslint-disable-next-line no-console
  console.log(`${colour}[${tags[level] || level}]${colours.reset} ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
    ...options
  });
  if (result.error) {
    log('fail', result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    log('fail', `${command} ${args.join(' ')} exited with code ${result.status}`);
    process.exit(result.status || 1);
  }
}

function requiredNodeMajor() {
  const required = (pkg.engines && pkg.engines.node) || '>=20';
  return Number(String(required).replace(/[^\d.]/g, '').split('.')[0]) || 20;
}

function checkNode() {
  const minimum = requiredNodeMajor();
  const major = Number(process.versions.node.split('.')[0]);
  if (major < minimum) {
    log('fail', `Node.js v${minimum}+ required (found v${process.versions.node}).`);
    log('warn', 'Install from https://nodejs.org — on Windows double-click RUN.bat to auto-install.');
    process.exit(1);
  }
  log('ok', `Node.js v${process.versions.node} detected`);
}

function depsHealthy() {
  const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json');
  const jestPkg = path.join(root, 'node_modules', 'jest', 'package.json');
  return fs.existsSync(electronPkg) && fs.existsSync(jestPkg);
}

function electronBinaryReady() {
  return fs.existsSync(path.join(root, 'node_modules', 'electron', 'path.txt'));
}

function ensureDependencies() {
  if (!depsHealthy()) {
    log('step', 'Installing npm dependencies (first run can take a minute)...');
    run(npmCmd, ['install', '--no-audit', '--no-fund']);
    log('ok', 'Dependencies installed');
  } else {
    log('ok', 'Dependencies already installed');
  }

  if (!electronBinaryReady()) {
    log('step', 'Downloading the Electron runtime...');
    run(npmCmd, ['rebuild', 'electron']);
    log('ok', 'Electron runtime ready');
  }
}

function main() {
  // eslint-disable-next-line no-console
  console.log('\n  AI Hub Desktop — one-click run\n');
  checkNode();
  ensureDependencies();
  log('step', 'Launching AI Hub Desktop (close the app window to stop)...');
  run(npmCmd, ['start']);
}

main();
