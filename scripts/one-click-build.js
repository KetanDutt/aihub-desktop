#!/usr/bin/env node
/**
 * Cross-platform one-click build for the AI Hub Desktop installers.
 *
 *   npm run one-click-build              # build for the current OS
 *   npm run one-click-build -- --all     # every target this host can produce
 *   npm run one-click-build -- --win     # explicit target(s)
 *   npm run one-click-build -- --dir     # unpacked directory, no installer
 *   npm run one-click-build -- --fast    # skip lint + tests
 *
 * Everything a fresh machine needs happens here: Node check, dependency
 * install, Electron runtime download, a regenerated service catalogue (so the
 * shipped build has its icons and menu details cached), lint + tests, then
 * electron-builder. Failures stop the run and say what to do next.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const FAST = has('--fast') || has('--skip-tests');
const DIR_ONLY = has('--dir') || has('--pack');
const PUBLISH = has('--publish');

function log(level, message) {
  const colours = {
    step: '\x1b[36m',
    ok: '\x1b[32m',
    warn: '\x1b[33m',
    fail: '\x1b[31m',
    reset: '\x1b[0m'
  };
  const tags = { step: 'build', ok: ' ok ', warn: 'warn', fail: 'FAIL' };
  const colour = colours[level] || colours.reset;
  // eslint-disable-next-line no-console
  console.log(`${colour}[${tags[level] || level}]${colours.reset} ${message}`);
}

function run(command, args, { optional = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: process.env
  });
  if (result.error) {
    if (optional) {
      log('warn', `${command} ${args.join(' ')}: ${result.error.message}`);
      return false;
    }
    log('fail', result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (optional) {
      log('warn', `${command} ${args.join(' ')} exited with ${result.status} (continuing)`);
      return false;
    }
    log('fail', `${command} ${args.join(' ')} exited with code ${result.status}`);
    process.exit(result.status || 1);
  }
  return true;
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
    log('warn', 'Install it from https://nodejs.org and run this again.');
    process.exit(1);
  }
  log('ok', `Node.js v${process.versions.node}`);
}

function depsHealthy() {
  return (
    fs.existsSync(path.join(root, 'node_modules', 'electron', 'package.json')) &&
    fs.existsSync(path.join(root, 'node_modules', 'electron-builder', 'package.json'))
  );
}

function electronBinaryReady() {
  return fs.existsSync(path.join(root, 'node_modules', 'electron', 'path.txt'));
}

function ensureDependencies() {
  if (!depsHealthy()) {
    log('step', 'Installing npm dependencies (first run can take a minute)…');
    run(npmCmd, ['install', '--no-audit', '--no-fund']);
  }
  log('ok', 'Dependencies installed');

  if (!electronBinaryReady()) {
    log('step', 'Downloading the Electron runtime…');
    run(npmCmd, ['rebuild', 'electron']);
  }
  log('ok', 'Electron runtime ready');
}

/**
 * Which electron-builder platform flags to pass.
 * Cross-building an installer for another OS mostly does not work without extra
 * tooling, so the default is "this machine only".
 */
function targets() {
  const explicit = [];
  if (has('--win') || has('--windows')) explicit.push('--win');
  if (has('--mac') || has('--macos')) explicit.push('--mac');
  if (has('--linux')) explicit.push('--linux');

  if (has('--all')) {
    if (process.platform === 'darwin') return ['--mac', '--win', '--linux'];
    if (process.platform === 'win32') return ['--win'];
    return ['--linux', '--win'];
  }

  if (explicit.length > 0) return explicit;

  if (process.platform === 'darwin') return ['--mac'];
  if (process.platform === 'win32') return ['--win'];
  return ['--linux'];
}

function listArtifacts() {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) {
    log('warn', 'No dist/ directory was produced.');
    return;
  }
  const wanted = /\.(exe|dmg|zip|AppImage|deb|rpm|snap)$/i;
  const files = fs
    .readdirSync(dist)
    .filter((name) => wanted.test(name))
    .map((name) => {
      const size = fs.statSync(path.join(dist, name)).size;
      return `  ${name}  (${(size / 1024 / 1024).toFixed(1)} MB)`;
    });

  if (files.length === 0) {
    log('ok', `Build output is in ${dist}`);
    return;
  }
  log('ok', `Installers in ${dist}:`);
  // eslint-disable-next-line no-console
  files.forEach((line) => console.log(line));
}

function main() {
  // eslint-disable-next-line no-console
  console.log(`\n  AI Hub Desktop v${pkg.version} — one-click build\n`);

  checkNode();
  ensureDependencies();

  log('step', 'Refreshing the service catalogue and cached icons…');
  // Offline-safe: regenerates the menu catalogue from the bundled data. It is
  // optional so an audit hiccup can never block a release build.
  run(process.execPath, [path.join('scripts', 'audit-services.js')], { optional: true });

  if (FAST) {
    log('warn', 'Skipping lint and tests (--fast)');
  } else {
    log('step', 'Running lint and tests…');
    run(npmCmd, ['run', 'check']);
  }

  const args = ['exec', '--', 'electron-builder'];
  if (DIR_ONLY) {
    args.push('--dir');
    log('step', 'Packaging an unpacked build (--dir)…');
  } else {
    args.push(...targets());
    log('step', `Building installers: ${targets().join(' ')}`);
  }
  if (!PUBLISH) args.push('--publish', 'never');

  run(npmCmd, args);
  listArtifacts();
  log('ok', 'Done.');
}

main();
