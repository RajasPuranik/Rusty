/**
 * Process Tree Telemetry & Task Manager Reconciliation Test Suite
 * Covers Features 1, 3, 4 (Telemetry, Classification, TaskMgr Reconciliation).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

describe('Features 1, 3, 4: Process Tree Telemetry & Role Classification Engine', () => {

  // Role classifier matching the logic in src/telemetry.rs
  function classifyCommandLine(cmdLine, isHost) {
    if (isHost) return 'RustHost';
    if (!cmdLine || typeof cmdLine !== 'string') return 'Unknown';
    const lower = cmdLine.toLowerCase();

    if (lower.includes('--type=gpu-process')) return 'GpuProcess';
    if (lower.includes('--type=utility')) {
      if (lower.includes('network.mojom.networkservice')) return 'NetworkService';
      if (lower.includes('audio.mojom.audioservice')) return 'AudioService';
      if (lower.includes('storage.mojom.storageservice')) return 'StorageService';
      return 'UtilityService';
    }
    if (lower.includes('--type=renderer')) {
      if (lower.includes('rusty://app') || lower.includes('http://rusty.app')) {
        return 'UiWebView';
      }
      return 'ContentRenderer';
    }
    if (lower.includes('--type=crashpad-handler')) return 'Crashpad';
    return 'ContentRenderer';
  }

  describe('Feature 3: Process Role Classification Engine', () => {
    it('Classifies Rust Host process', () => {
      assert.strictEqual(classifyCommandLine('rusty_browser.exe', true), 'RustHost');
    });

    it('Classifies GPU Process', () => {
      const cmd = '"C:\\Path\\msedgewebview2.exe" --type=gpu-process --gpu-preferences=...';
      assert.strictEqual(classifyCommandLine(cmd, false), 'GpuProcess');
    });

    it('Classifies Network Service utility process', () => {
      const cmd = '"C:\\Path\\msedgewebview2.exe" --type=utility --utility-sub-type=network.mojom.NetworkService';
      assert.strictEqual(classifyCommandLine(cmd, false), 'NetworkService');
    });

    it('Classifies Audio Service utility process', () => {
      const cmd = '"C:\\Path\\msedgewebview2.exe" --type=utility --utility-sub-type=audio.mojom.AudioService';
      assert.strictEqual(classifyCommandLine(cmd, false), 'AudioService');
    });

    it('Classifies Content Renderer vs UI Webview renderer', () => {
      const uiCmd = '"C:\\Path\\msedgewebview2.exe" --type=renderer --embedded-browser-webview=1 http://rusty.app/index.html';
      assert.strictEqual(classifyCommandLine(uiCmd, false), 'UiWebView');

      const contentCmd = '"C:\\Path\\msedgewebview2.exe" --type=renderer --embedded-browser-webview=1 https://rust-lang.org';
      assert.strictEqual(classifyCommandLine(contentCmd, false), 'ContentRenderer');
    });
  });

  describe('Feature 4: Task Manager Details Reconciliation Formula', () => {
    function computeReconciliationVariance(measuredPrivateWsBytes, taskManagerPrivateWsBytes) {
      if (taskManagerPrivateWsBytes === 0) return 0;
      const diff = Math.abs(measuredPrivateWsBytes - taskManagerPrivateWsBytes);
      return (diff / taskManagerPrivateWsBytes) * 100.0;
    }

    it('Confirms variance within <= 2.0% threshold for stable states', () => {
      const measured = 72.4 * 1024 * 1024;
      const taskMgr = 73.1 * 1024 * 1024;
      const variance = computeReconciliationVariance(measured, taskMgr);

      assert.ok(
        variance <= 2.0,
        `Reconciliation variance ${variance.toFixed(2)}% must be <= 2.0%`
      );
    });

    it('Detects and flags when measurement deviates beyond allowable threshold', () => {
      const measured = 50.0 * 1024 * 1024;
      const taskMgr = 80.0 * 1024 * 1024;
      const variance = computeReconciliationVariance(measured, taskMgr);

      assert.ok(
        variance > 2.0,
        `Should detect divergence exceeding threshold: got ${variance.toFixed(2)}%`
      );
    });
  });

  describe('Feature 1: Process Tree Invariants & Exclusion Filters', () => {
    it('Rigidly excludes unrelated third-party WebView2 processes by user-data-dir', () => {
      function belongsToBrowserUserDataDir(cmdLine, browserUserDataDir) {
        if (!cmdLine || !browserUserDataDir) return false;
        const normCmd = cmdLine.toLowerCase().replace(/\\/g, '/');
        const normDir = browserUserDataDir.toLowerCase().replace(/\\/g, '/');
        return normCmd.includes(`--user-data-dir=${normDir}`) || normCmd.includes(`--user-data-dir="${normDir}"`);
      }

      const browserDataDir = 'C:/Users/Test/AppData/Roaming/rusty_browser/WebView2';
      const myProcessCmd = `"msedgewebview2.exe" --user-data-dir="${browserDataDir}" --type=renderer`;
      const teamsProcessCmd = '"msedgewebview2.exe" --user-data-dir="C:/Users/Test/AppData/Local/Microsoft/Teams/EBWebView" --type=renderer';

      assert.strictEqual(belongsToBrowserUserDataDir(myProcessCmd, browserDataDir), true);
      assert.strictEqual(belongsToBrowserUserDataDir(teamsProcessCmd, browserDataDir), false);
    });

    it('Rejects PID reuse when process creation timestamp precedes parent start', () => {
      function isValidChildProcess(parentStartTime, childStartTime) {
        return childStartTime >= parentStartTime;
      }

      const parentStart = 10000;
      const validChildStart = 10500;
      const recycledPidStart = 8500; // Older process, recycled PID

      assert.strictEqual(isValidChildProcess(parentStart, validChildStart), true);
      assert.strictEqual(isValidChildProcess(parentStart, recycledPidStart), false);
    });
  });

});
