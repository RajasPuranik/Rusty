#!/usr/bin/env node
/**
 * Rusty Browser E2E Test Suite Runner
 * Discovers and executes all E2E test suites with structured reporting and clean exit codes.
 *
 * Usage:
 *   node tests/e2e/runner.js
 *   node tests/e2e/runner.js --filter invariants
 *   node tests/e2e/runner.js --spec
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const E2E_DIR = __dirname;
const ROOT_DIR = path.resolve(E2E_DIR, '..', '..');

// Parse CLI flags
const args = process.argv.slice(2);
let filterPattern = null;
let isSpecMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--filter' && args[i + 1]) {
    filterPattern = new RegExp(args[i + 1], 'i');
    i++;
  } else if (args[i] === '--spec') {
    isSpecMode = true;
  }
}

// Locate test files
const allTestFiles = fs.readdirSync(E2E_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join(E2E_DIR, f));

const targetFiles = filterPattern
  ? allTestFiles.filter((f) => filterPattern.test(path.basename(f)))
  : allTestFiles;

if (targetFiles.length === 0) {
  console.error(`[E2E Runner] No test files matched filter: ${filterPattern || 'none'}`);
  process.exit(1);
}

console.log('='.repeat(70));
console.log('  RUSTY BROWSER E2E TEST RUNNER');
console.log(`  Found ${targetFiles.length} test suite(s) in tests/e2e/`);
console.log('='.repeat(70));
console.log();

let totalPassed = 0;
let totalFailed = 0;
let totalSuitesPassed = 0;
let totalSuitesFailed = 0;
const startTime = Date.now();

for (const testFile of targetFiles) {
  const relPath = path.relative(ROOT_DIR, testFile);
  console.log(`\x1b[36m▶ Running: ${relPath}\x1b[0m`);

  const nodeArgs = ['--test'];
  if (isSpecMode) {
    nodeArgs.push('--test-reporter', 'spec');
  }
  nodeArgs.push(testFile);

  const res = spawnSync(process.execPath, nodeArgs, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: process.env
  });

  if (res.status === 0) {
    totalSuitesPassed++;
    console.log(`\x1b[32m✔ PASS: ${relPath}\x1b[0m\n`);
  } else {
    totalSuitesFailed++;
    console.error(`\x1b[31m✖ FAIL: ${relPath} (exit code ${res.status})\x1b[0m\n`);
  }
}

const elapsedMs = Date.now() - startTime;
console.log('='.repeat(70));
console.log('  E2E TEST SUMMARY');
console.log(`  Suites:   ${totalSuitesPassed} passed, ${totalSuitesFailed} failed, ${targetFiles.length} total`);
console.log(`  Duration: ${(elapsedMs / 1000).toFixed(2)}s`);
console.log('='.repeat(70));

if (totalSuitesFailed > 0) {
  console.error(`\x1b[31m[E2E Runner] FAILED: ${totalSuitesFailed} test suite(s) encountered failures.\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[32m[E2E Runner] ALL TESTS PASSED SUCCESSFULLY (Exit 0)\x1b[0m`);
  process.exit(0);
}
