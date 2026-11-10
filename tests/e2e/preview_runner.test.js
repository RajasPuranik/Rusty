/**
 * Standalone Mock Bridge Preview & Browser Render Test Suite
 * Verifies that the preview runner and mock bridge execute cleanly without errors.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Helper to find installed Edge or Chrome
function getBrowserBinary() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

// Sandbox builder simulating browser window without window.ipc
function createMockWindowContext() {
  const localStorageStore = new Map();
  const context = {
    console: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: (...args) => {
        // Collect console errors to detect invariant violations
        context.__errors.push(args.join(' '));
      }
    },
    __errors: [],
    setTimeout: (fn, ms) => {
      if (typeof fn === 'function' && (!ms || ms <= 50)) {
        setImmediate(fn);
      }
      return { unref: () => {} };
    },
    clearTimeout: () => {},
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    Date: Date,
    Math: Math,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    Map: Map,
    Set: Set,
    JSON: JSON,
    localStorage: {
      getItem: (key) => localStorageStore.get(key) || null,
      setItem: (key, val) => localStorageStore.set(key, String(val)),
      removeItem: (key) => localStorageStore.delete(key),
      clear: () => localStorageStore.clear()
    },
    document: {
      readyState: 'complete',
      body: {
        classList: {
          contains: () => false
        }
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: (tag) => ({
        tagName: tag,
        setAttribute: () => {},
        getAttribute: () => null,
        style: {},
        appendChild: () => {},
        addEventListener: () => {}
      })
    }
  };
  context.window = context;
  context.global = context;
  return vm.createContext(context);
}

describe('Mock Bridge Preview & Standalone Verification', () => {

  describe('Mock Bridge State & Event Handling (Isolated Sandbox)', () => {
    it('Initializes Bridge in mock mode when window.ipc is absent', () => {
      const sandbox = createMockWindowContext();
      const bridgeCode = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'bridge.js'), 'utf8');

      vm.runInContext(bridgeCode, sandbox);

      const bridge = sandbox.bridge || sandbox.Bridge;
      assert.ok(bridge, 'Bridge must be attached to window/root');
      assert.strictEqual(bridge.isMock, true, 'Bridge.isMock must be true without window.ipc');
      assert.strictEqual(sandbox.__errors.length, 0, 'No console errors during Bridge init');
    });

    it('Dispatches mock tab creation (new_tab) and updates active tab', () => {
      const sandbox = createMockWindowContext();
      const bridgeCode = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'bridge.js'), 'utf8');
      vm.runInContext(bridgeCode, sandbox);
      const bridge = sandbox.bridge || sandbox.Bridge;

      let latestState = null;
      bridge.on('state_update', (data) => {
        latestState = data;
      });

      bridge.send('new_tab', { url: 'https://rust-lang.org', title: 'Rust', background: false });

      assert.ok(latestState, 'Must receive state_update event');
      assert.ok(Array.isArray(latestState.tabs), 'Payload must contain tabs array');
      const createdTab = latestState.tabs.find((t) => t.url === 'https://rust-lang.org');
      assert.ok(createdTab, 'Created tab must be present in tabs array');
      assert.strictEqual(createdTab.active, true, 'Created foreground tab must be active');
      assert.strictEqual(sandbox.__errors.length, 0, 'No console errors');
    });

    it('Handles tab switching (switch_tab)', () => {
      const sandbox = createMockWindowContext();
      const bridgeCode = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'bridge.js'), 'utf8');
      vm.runInContext(bridgeCode, sandbox);
      const bridge = sandbox.bridge || sandbox.Bridge;

      let latestState = null;
      bridge.on('state_update', (data) => {
        latestState = data;
      });

      // Add tab to ensure at least 2
      bridge.send('new_tab', { url: 'https://example.com', background: false });
      assert.ok(latestState && latestState.tabs.length >= 2);

      const targetTab = latestState.tabs[0];
      bridge.send('switch_tab', { tab_id: targetTab.id });

      const updated = latestState.tabs.find((t) => t.id === targetTab.id);
      assert.strictEqual(updated.active, true, 'Target tab must become active');
      assert.strictEqual(sandbox.__errors.length, 0, 'No console errors');
    });

    it('Handles tab closure (close_tab) and retains valid active state', () => {
      const sandbox = createMockWindowContext();
      const bridgeCode = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'bridge.js'), 'utf8');
      vm.runInContext(bridgeCode, sandbox);
      const bridge = sandbox.bridge || sandbox.Bridge;

      let latestState = null;
      bridge.on('state_update', (data) => {
        latestState = data;
      });

      // Add a known tab then close it
      bridge.send('new_tab', { url: 'https://to-close.com', background: false });
      const initialCount = latestState.tabs.length;
      const tabToClose = latestState.tabs.find((t) => t.url === 'https://to-close.com');
      assert.ok(tabToClose);

      bridge.send('close_tab', { tab_id: tabToClose.id });

      assert.strictEqual(latestState.tabs.length, initialCount - 1, 'Tab count must decrease by 1');
      assert.strictEqual(latestState.tabs.some((t) => t.id === tabToClose.id), false, 'Closed tab must be gone');
      assert.ok(latestState.tabs.some((t) => t.active), 'An active tab must remain designated');
      assert.strictEqual(sandbox.__errors.length, 0, 'No console errors');
    });

    it('Handles split view toggle (split_view) seamlessly', () => {
      const sandbox = createMockWindowContext();
      const bridgeCode = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'bridge.js'), 'utf8');
      vm.runInContext(bridgeCode, sandbox);
      const bridge = sandbox.bridge || sandbox.Bridge;

      let latestState = null;
      bridge.on('state_update', (data) => {
        latestState = data;
      });

      bridge.send('split_view', { enabled: true });

      assert.ok(latestState && latestState.split_view, 'Must receive state_update with split_view');
      assert.strictEqual(latestState.split_view.enabled, true, 'Split view must be enabled');
      assert.ok(latestState.split_view.left_tab_id !== null, 'Left pane must be assigned');
      assert.strictEqual(sandbox.__errors.length, 0, 'No console errors');
    });

    it('Handles tab properties (pin_tab, mute_tab, set_tab_group)', () => {
      const sandbox = createMockWindowContext();
      const bridgeCode = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'bridge.js'), 'utf8');
      vm.runInContext(bridgeCode, sandbox);
      const bridge = sandbox.bridge || sandbox.Bridge;

      let latestState = null;
      bridge.on('state_update', (data) => {
        latestState = data;
      });

      bridge.send('new_tab', { url: 'https://props-test.com', background: false });
      const testTab = latestState.tabs.find((t) => t.url === 'https://props-test.com');

      // Pin tab
      bridge.send('pin_tab', { tab_id: testTab.id });
      const pinnedTab = latestState.tabs.find((t) => t.id === testTab.id);
      assert.strictEqual(pinnedTab.pinned, true, 'Tab must be pinned');

      // Mute tab
      bridge.send('mute_tab', { tab_id: testTab.id });
      const mutedTab = latestState.tabs.find((t) => t.id === testTab.id);
      assert.strictEqual(mutedTab.muted, true, 'Tab must be muted');

      // Set group
      bridge.send('set_tab_group', { tab_id: testTab.id, group_id: 'dev' });
      const groupedTab = latestState.tabs.find((t) => t.id === testTab.id);
      assert.strictEqual(groupedTab.group_id, 'dev', 'Tab group must be set');

      assert.strictEqual(sandbox.__errors.length, 0, 'No console errors');
    });
  });

  describe('Headless Browser Real Render Verification', () => {
    const browserBin = getBrowserBinary();

    it('Headless Edge/Chrome renders ui/index.html with valid DOM structure', (t) => {
      if (!browserBin) {
        t.skip('No Edge/Chrome binary available in environment');
        return;
      }

      const indexUrl = `file:///${path.join(ROOT_DIR, 'ui', 'index.html').replace(/\\/g, '/')}`;
      const res = require('node:child_process').spawnSync(browserBin, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-crash-reporter',
        '--dump-dom',
        indexUrl
      ], { encoding: 'utf8', timeout: 10000 });

      const stdout = res.stdout || '';
      assert.ok(stdout.includes('<!DOCTYPE html>'), 'Output must be valid HTML');
      assert.ok(stdout.includes('id="omnibox"') || stdout.includes('id="url-input"') || stdout.includes('omnibox'), 'DOM must contain omnibox element');
      assert.ok(stdout.includes('data-skin='), 'DOM must have active skin attribute set by boot.js');
      assert.ok(stdout.includes('id="content-viewport"'), 'DOM must contain content viewport');
    });

    it('Headless Edge/Chrome renders ui/newtab.html with valid NTP structure', (t) => {
      if (!browserBin) {
        t.skip('No Edge/Chrome binary available in environment');
        return;
      }

      const newtabUrl = `file:///${path.join(ROOT_DIR, 'ui', 'newtab.html').replace(/\\/g, '/')}`;
      const res = require('node:child_process').spawnSync(browserBin, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-crash-reporter',
        '--dump-dom',
        newtabUrl
      ], { encoding: 'utf8', timeout: 10000 });

      const stdout = res.stdout || '';
      assert.ok(stdout.includes('<!DOCTYPE html>'), 'Output must be valid HTML');
      assert.ok(stdout.includes('ntp-body'), 'NTP body class must be present');
      assert.ok(stdout.includes('data-skin='), 'Skin attribute initialized on NTP');
      assert.ok(stdout.includes('weather') || stdout.includes('search'), 'NTP must contain weather/search components');
    });
  });

});
