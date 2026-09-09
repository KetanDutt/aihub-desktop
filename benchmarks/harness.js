/**
 * Shared benchmark helpers.
 *
 * `installElectronStub()` lets plain Node scripts `require()` main-process
 * modules (which import `electron`) so the benchmarks measure the *real*
 * shipped code instead of a copy.
 */

'use strict';

const Module = require('module');
const os = require('os');

function installElectronStub() {
  const stubElectron = {
    session: {
      defaultSession: {
        webRequest: { onBeforeRequest() {} }
      }
    },
    app: {
      isPackaged: false,
      getPath: () => os.tmpdir(),
      getVersion: () => '0.0.0-bench'
    }
  };
  const stubLog = {
    info() {},
    warn() {},
    debug() {},
    error() {}
  };

  const originalLoad = Module._load;
  Module._load = function load(request, _parent, _isMain) {
    if (request === 'electron') return stubElectron;
    if (request === 'electron-log') return stubLog;
    return originalLoad.apply(this, arguments);
  };
}

function time(label, fn) {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(2).padStart(9)} ms`);
  return ms;
}

function report(baselineLabel, baseline, optimizedLabel, optimized) {
  const improvement = ((baseline - optimized) / Math.max(baseline, 1e-9)) * 100;
  console.log(`  ${baselineLabel}: ${baseline.toFixed(2)} ms`);
  console.log(`  ${optimizedLabel}: ${optimized.toFixed(2)} ms`);
  console.log(`  improvement: ${improvement.toFixed(1)}%`);
  if (optimized > baseline * 1.5) {
    console.error('  WARNING: "optimized" version is slower than the baseline!');
  }
}

module.exports = { installElectronStub, time, report };
