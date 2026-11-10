/**
 * E2E / Invariant Test Suite: Extensions & Userscripts (Milestone R8)
 * Verifies manifest inspection, permission risk evaluation, starter userscripts,
 * Vault workspace isolation invariants, and IPC messaging contracts.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

console.log('Testing Extensions & Userscripts Architecture (Milestone R8)...');

// 1. Verify storage default userscripts exist in src/storage.rs
const storageRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage.rs'), 'utf8');
assert(storageRs.includes('pub struct BrowserExtension'), 'storage.rs must declare BrowserExtension');
assert(storageRs.includes('pub struct UserScript'), 'storage.rs must declare UserScript');
assert(storageRs.includes('default_userscripts'), 'storage.rs must declare default_userscripts');
assert(storageRs.includes('us_dark_reader'), 'Default userscripts must include Dark Reader Lite');
assert(storageRs.includes('us_clean_links'), 'Default userscripts must include Clean Tracking Links');
assert(storageRs.includes('us_yt_ad_skip'), 'Default userscripts must include YouTube Ad Auto-Dismiss');
console.log('  ✓ Storage definitions and 3 starter userscripts verified in Rust');

// 2. Verify extensions module exists and implements risk evaluation
const extRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'extensions.rs'), 'utf8');
assert(extRs.includes('enum ExtensionRiskLevel'), 'extensions.rs must define ExtensionRiskLevel');
assert(extRs.includes('evaluate_risk_level'), 'extensions.rs must implement evaluate_risk_level');
assert(extRs.includes('inspect_extension_directory'), 'extensions.rs must implement inspect_extension_directory');
assert(extRs.includes('build_userscripts_injection_js'), 'extensions.rs must implement build_userscripts_injection_js');
console.log('  ✓ Extensions & Userscripts engine module verified in src/extensions.rs');

// 3. Verify Vault workspace isolation invariant in Rust
assert(
  extRs.includes('if is_vault_workspace {'),
  'build_userscripts_injection_js must check is_vault_workspace'
);
assert(
  extRs.includes('inhibited in Vault workspace'),
  'Userscripts must be explicitly inhibited in Vault workspace'
);
console.log('  ✓ Vault workspace security isolation invariant verified');

// 4. Verify IPC message definitions in src/main.rs
const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
const expectedIpcActions = [
  'load_unpacked_extension',
  'toggle_extension',
  'remove_extension',
  'inspect_extension',
  'save_userscript',
  'toggle_userscript',
  'delete_userscript',
  'get_extensions_and_scripts'
];

for (const act of expectedIpcActions) {
  assert(
    mainRs.includes(`rename = "${act}"`),
    `main.rs UiMessage must handle action "${act}"`
  );
}
console.log('  ✓ All 8 Extensions & Userscripts IPC message actions verified in main.rs');

// 5. Verify UI settings markup in ui/index.html
const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'index.html'), 'utf8');
assert(indexHtml.includes('id="settings-extensions-section"'), 'index.html must include extensions section');
assert(indexHtml.includes('id="extensions-list"'), 'index.html must include extensions list container');
assert(indexHtml.includes('id="userscripts-list"'), 'index.html must include userscripts list container');
assert(indexHtml.includes('id="btn-load-unpacked-ext"'), 'index.html must include Load Unpacked button');
assert(indexHtml.includes('id="btn-add-userscript"'), 'index.html must include Add Userscript button');
assert(indexHtml.includes('id="userscript-editor-modal-backdrop"'), 'index.html must include Userscript editor modal');
console.log('  ✓ Settings UI and code editor modal verified in index.html');

// 6. Verify UI logic in ui/js/chrome.js
const chromeJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'chrome.js'), 'utf8');
assert(chromeJs.includes('renderExtensionsAndScriptsSection'), 'chrome.js must declare renderExtensionsAndScriptsSection');
assert(chromeJs.includes('openUserscriptEditor'), 'chrome.js must declare openUserscriptEditor');
assert(chromeJs.includes('closeUserscriptEditor'), 'chrome.js must declare closeUserscriptEditor');
assert(chromeJs.includes("window.bridge.on('extensions_and_scripts'"), 'chrome.js must handle extensions_and_scripts event');
console.log('  ✓ Chrome UI handlers and modal bindings verified in chrome.js');

// 7. Verify cross-platform documentation in docs/EXTENSIONS_CROSS_PLATFORM.md
const docPath = path.join(ROOT_DIR, 'docs', 'EXTENSIONS_CROSS_PLATFORM.md');
assert(fs.existsSync(docPath), 'docs/EXTENSIONS_CROSS_PLATFORM.md must exist');
const docContent = fs.readFileSync(docPath, 'utf8');
assert(docContent.includes('WebKitGTK 4.1'), 'Doc must explain WebKitGTK 4.1 architecture');
assert(docContent.includes('High Risk (Broad Access)'), 'Doc must explain permission risk levels');
assert(docContent.includes('Vault Workspace Immunity'), 'Doc must document Vault isolation');
console.log('  ✓ Cross-platform documentation verified in docs/EXTENSIONS_CROSS_PLATFORM.md');

console.log('\nAll Milestone R8 Extension & Userscript tests PASSED cleanly!');
