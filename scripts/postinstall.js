/**
 * Post-install sanity check.
 *
 * Never fails the install: it only reports what it finds, so a machine without
 * a GUI stack can still `npm install` successfully (CI, servers, containers).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function check(label, fn) {
  try {
    const result = fn();
    if (result === false) return { label, ok: false, detail: 'missing' };
    return { label, ok: true, detail: result === true ? '' : String(result) };
  } catch (error) {
    return { label, ok: false, detail: error.message };
  }
}

const checks = [
  check('Electron binary', () => {
    try {
      const electronPath = require(path.join(root, 'node_modules', 'electron', 'index.js'));
      return electronPath ? path.basename(electronPath) : false;
    } catch (error) {
      return false;
    }
  }),
  check('Bundled service catalogue', () => {
    const file = path.join(root, 'data', 'services.json');
    if (!fs.existsSync(file)) return false;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return `${(parsed.ai_services || []).length} services`;
  }),
  check('Bundled domain rules', () => {
    const file = path.join(root, 'data', 'rules.json');
    if (!fs.existsSync(file)) return false;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return `${Object.keys(parsed.service_domains || {}).length} rule sets`;
  })
];

console.log('\nAI Hub Desktop — install check');
for (const result of checks) {
  const mark = result.ok ? 'ok  ' : 'warn';
  const detail = result.detail ? ` (${result.detail})` : '';
  console.log(`  [${mark}] ${result.label}${detail}`);
}

const missingElectron = !checks[0].ok;
console.log('');
if (missingElectron) {
  console.log('  The Electron binary was not downloaded (offline install or');
  console.log('  ELECTRON_SKIP_BINARY_DOWNLOAD). The app cannot start without it:');
  console.log('    npm rebuild electron');
}
console.log('  Next steps:  npm start        launch the app');
console.log('               npm run doctor   diagnose this environment');
console.log('               npm test         run the test suite\n');
