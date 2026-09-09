#!/usr/bin/env node
/**
 * Environment doctor.
 *
 * Verifies everything needed to run, test and package the app, and exits
 * non-zero when something is actually broken.
 *
 *   node scripts/doctor.js
 *   npm run doctor
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

const results = [];

function record(level, label, detail) {
  results.push({ level, label, detail });
}

function ok(label, detail) {
  record('ok', label, detail);
}
function warn(label, detail) {
  record('warn', label, detail);
}
function fail(label, detail) {
  record('fail', label, detail);
}

// -- Node version -----------------------------------------------------------
(function checkNode() {
  const required = (pkg.engines && pkg.engines.node) || '>=20';
  const minimum = Number(String(required).replace(/[^\d.]/g, '').split('.')[0]) || 20;
  const current = process.versions.node;
  const major = Number(current.split('.')[0]);
  if (major >= minimum) ok(`Node.js ${current}`, `satisfies ${required}`);
  else fail(`Node.js ${current}`, `expected ${required}`);
})();

// -- Dependencies -----------------------------------------------------------
(function checkDependencies() {
  const required = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(required)) {
    const dir = path.join(root, 'node_modules', name);
    if (fs.existsSync(dir)) continue;
    fail(`dependency ${name}`, 'not installed — run npm install');
  }
  const missing = results.filter((r) => r.level === 'fail' && r.label.startsWith('dependency '));
  if (missing.length === 0) ok('Dependencies', `${Object.keys(required).length} packages installed`);
})();

// -- Electron binary --------------------------------------------------------
(function checkElectronBinary() {
  try {
    const electronIndex = path.join(root, 'node_modules', 'electron', 'index.js');
    if (!fs.existsSync(electronIndex)) {
      warn('Electron binary', 'package not installed');
      return;
    }
    // eslint-disable-next-line global-require
    const binaryPath = require(electronIndex);
    if (binaryPath && fs.existsSync(binaryPath)) {
      ok('Electron binary', path.basename(binaryPath));
    } else {
      warn('Electron binary', 'not downloaded — run: npm rebuild electron');
    }
  } catch (error) {
    warn('Electron binary', error.message);
  }
})();

// -- Bundled data -----------------------------------------------------------
(function checkBundledData() {
  const servicesFile = path.join(root, 'data', 'services.json');
  const rulesFile = path.join(root, 'data', 'rules.json');

  let services = null;
  let rules = null;

  try {
    services = JSON.parse(fs.readFileSync(servicesFile, 'utf8'));
    ok('Bundled catalogue', `${(services.ai_services || []).length} services`);
  } catch (error) {
    fail('Bundled catalogue', error.message);
  }

  try {
    rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    ok('Bundled rules', `${Object.keys(rules.service_domains || {}).length} rule sets`);
  } catch (error) {
    fail('Bundled rules', error.message);
  }

  if (!services || !rules) return;

  const slugify = (name) =>
    String(name).toLowerCase().trim().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');

  const ids = (services.ai_services || []).map((entry) => slugify(Array.isArray(entry) ? entry[0] : entry.name));
  const ruleIds = Object.keys(rules.service_domains || {});
  const missing = ids.filter((id) => !ruleIds.includes(id));
  const orphan = ruleIds.filter((id) => !ids.includes(id));

  if (missing.length === 0 && orphan.length === 0) {
    ok('Catalogue/rules consistency', 'every service has a rule set');
  } else {
    if (missing.length > 0) warn('Catalogue/rules consistency', `missing rules: ${missing.join(', ')}`);
    if (orphan.length > 0) warn('Catalogue/rules consistency', `unused rules: ${orphan.join(', ')}`);
  }
})();

// -- Icons ------------------------------------------------------------------
(function checkIcons() {
  const needed = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const file = path.join(root, 'build', needed);
  if (fs.existsSync(file)) ok(`Packaging icon (${needed})`, 'present');
  else warn(`Packaging icon (${needed})`, 'missing — electron-builder will fall back to the default icon');
})();

// -- Writable user data -----------------------------------------------------
(function checkWritable() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-doctor-'));
  fs.rmSync(dir, { recursive: true, force: true });
  ok('Temp directory', 'writable');
})();

// -- Optional: git ----------------------------------------------------------
(function checkGit() {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
    ok('Git checkout', out.trim());
  } catch (error) {
    warn('Git checkout', 'not a git repository');
  }
})();

// -- Report -----------------------------------------------------------------
const marks = { ok: ' ok ', warn: 'warn', fail: 'FAIL' };
console.log(`\nAI Hub Desktop doctor — ${process.platform} (${process.arch})\n`);
for (const result of results) {
  console.log(`  [${marks[result.level]}] ${result.label}${result.detail ? ` — ${result.detail}` : ''}`);
}

const failures = results.filter((r) => r.level === 'fail').length;
const warnings = results.filter((r) => r.level === 'warn').length;
console.log(`\n  ${results.length - failures - warnings} passed, ${warnings} warning(s), ${failures} failure(s)\n`);

process.exit(failures > 0 ? 1 : 0);
