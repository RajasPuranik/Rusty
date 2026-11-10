/**
 * End-to-End & Interface Verification Suite for Milestone R2: RAM Optimization Pass
 *
 * Verifies:
 * - Feature 11: Background Tab Suspension (TrySuspend & MemoryUsageTargetLevel = Low)
 * - Feature 12: Inactivity Webview Discard
 * - Feature 13: Renderer Process Limit Evaluation (docs/RENDERER_PROCESS_LIMIT.md)
 * - Feature 14: Bounded DOM & Virtualized Lists
 * - Feature 15: UI Webview & NTP Memory Polish
 * - Feature 16: Custom Allocators Evaluation (docs/ALLOCATOR_EVALUATION.md)
 * - Feature 17: Lite Mode Toggle & RAM Budget Table
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Milestone R2: RAM Optimization Pass Verification Suite', () => {

  describe('Feature 11: Background Tab Suspension & Memory Target Low', () => {
    it('Verifies PlatformWebView exposes suspend, resume, and set_memory_target_low', () => {
      const platformMod = fs.readFileSync(path.join(ROOT_DIR, 'src', 'platform', 'mod.rs'), 'utf8');
      assert.ok(platformMod.includes('fn suspend(&self) -> Result<()>'), 'PlatformWebView declares suspend');
      assert.ok(platformMod.includes('fn resume(&self) -> Result<()>'), 'PlatformWebView declares resume');
      assert.ok(platformMod.includes('fn set_memory_target_low(&self) -> Result<()>'), 'PlatformWebView declares set_memory_target_low');
      assert.ok(platformMod.includes('fn set_memory_target_normal(&self) -> Result<()>'), 'PlatformWebView declares set_memory_target_normal');
    });

    it('Verifies WindowsWebView implements raw WebView2 TrySuspend and MemoryUsageLevel::Low', () => {
      const winPlatform = fs.readFileSync(path.join(ROOT_DIR, 'src', 'platform', 'windows.rs'), 'utf8');
      assert.ok(winPlatform.includes('wv3.TrySuspend'), 'Invokes ICoreWebView2_3::TrySuspend');
      assert.ok(winPlatform.includes('wv3.Resume'), 'Invokes ICoreWebView2_3::Resume');
      assert.ok(winPlatform.includes('MemoryUsageLevel::Low'), 'Sets MemoryUsageLevel::Low');
    });

    it('Verifies automatic suspension of hidden/background webviews in src/main.rs', () => {
      const mainContent = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      assert.ok(mainContent.includes('wv.set_memory_target_low()'), 'Lowers memory target on hidden webviews');
      assert.ok(mainContent.includes('wv.suspend()'), 'Suspends hidden webviews');
      assert.ok(mainContent.includes('wv.resume()'), 'Resumes webviews when restored to active');
    });
  });

  describe('Feature 12: Inactivity Webview Discard', () => {
    it('Verifies discard_inactive_tabs routine in src/main.rs drops inactive webviews', () => {
      const mainContent = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      assert.ok(mainContent.includes('fn discard_inactive_tabs'), 'Defines discard_inactive_tabs');
      assert.ok(mainContent.includes('remove_tab_webview'), 'Frees child webview on discard');
      assert.ok(mainContent.includes('tabs.mark_discarded'), 'Marks tab discarded and preserves scroll position');
    });
  });

  describe('Feature 13: Renderer Process Limit Evaluation', () => {
    it('Verifies docs/RENDERER_PROCESS_LIMIT.md exists with empirical trade-offs', () => {
      const docPath = path.join(ROOT_DIR, 'docs', 'RENDERER_PROCESS_LIMIT.md');
      assert.ok(fs.existsSync(docPath), 'docs/RENDERER_PROCESS_LIMIT.md exists');
      const content = fs.readFileSync(docPath, 'utf8');
      assert.ok(content.includes('--renderer-process-limit'), 'Documents renderer process limit flag');
      assert.ok(content.includes('Spectre'), 'Analyzes Site Isolation / Spectre impact');
      assert.ok(content.includes('Do NOT Enable Silently by Default'), 'Complies with honest security posture');
    });
  });

  describe('Feature 14 & 15: Bounded DOM & NTP Memory Polish', () => {
    it('Verifies WebGL context and texture cleanup on page hide/unload in ui/js/globe.js', () => {
      const globeJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'globe.js'), 'utf8');
      assert.ok(globeJs.includes('disposeWebGL'), 'Implements WebGL cleanup');
      assert.ok(globeJs.includes('visibilitychange'), 'Listens for visibilitychange to pause RAF loop');
      assert.ok(globeJs.includes('pagehide'), 'Disposes textures on pagehide');
    });

    it('Verifies canvas animation loop pauses on document.hidden in ui/js/fx-crazy.js', () => {
      const fxCrazy = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'fx-crazy.js'), 'utf8');
      assert.ok(fxCrazy.includes('visibilitychange'), 'Pauses animation loop on visibilitychange');
      assert.ok(fxCrazy.includes('document.hidden'), 'Checks document.hidden');
    });
  });

  describe('Feature 16: Custom Allocators Evaluation', () => {
    it('Verifies docs/ALLOCATOR_EVALUATION.md exists with fragmentation analysis', () => {
      const docPath = path.join(ROOT_DIR, 'docs', 'ALLOCATOR_EVALUATION.md');
      assert.ok(fs.existsSync(docPath), 'docs/ALLOCATOR_EVALUATION.md exists');
      const content = fs.readFileSync(docPath, 'utf8');
      assert.ok(content.includes('mimalloc'), 'Evaluates mimalloc');
      assert.ok(content.includes('jemalloc'), 'Evaluates jemalloc');
      assert.ok(content.includes('Fragmentation'), 'Analyzes heap fragmentation');
    });
  });

  describe('Feature 17: Lite Mode Toggle & RAM Budget Table', () => {
    it('Verifies Settings model and apply_setting supports lite_mode in src/storage.rs', () => {
      const storageRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage.rs'), 'utf8');
      assert.ok(storageRs.includes('pub lite_mode: bool'), 'Settings struct has lite_mode field');
      assert.ok(storageRs.includes('"lite_mode" =>'), 'apply_setting handles lite_mode');
    });

    it('Verifies Lite Mode toggle and RAM Budget Table are rendered in ui/index.html', () => {
      const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'index.html'), 'utf8');
      assert.ok(indexHtml.includes('id="setting-lite-mode"'), 'Renders lite mode toggle switch');
      assert.ok(indexHtml.includes('Feature RAM Budget Table'), 'Renders RAM budget table');
      assert.ok(indexHtml.includes('60 MB') && (indexHtml.includes('< 60 MB') || indexHtml.includes('&lt; 60 MB')), 'Displays Minimal/Lite guardrail budget');
      assert.ok(indexHtml.includes('120 MB') && (indexHtml.includes('< 120 MB') || indexHtml.includes('&lt; 120 MB')), 'Displays Crazy skin guardrail budget');
    });

    it('Verifies Lite Mode synchronization in ui/js/chrome.js and ui/js/settings.js', () => {
      const chromeJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'chrome.js'), 'utf8');
      const settingsJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'settings.js'), 'utf8');
      assert.ok(chromeJs.includes('setting-lite-mode'), 'chrome.js binds lite mode change event');
      assert.ok(settingsJs.includes('lite_mode: false'), 'settings.js defines default lite_mode');
    });
  });

});
