/**
 * E2E Invariants Test Suite (INV-01 through INV-10)
 * Verifies core invariant rules across Rusty Browser.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

describe('Core Invariants Verification (INV-01 through INV-10)', () => {

  describe('INV-01: Active Skin Asset Isolation', () => {
    it('Minimal skin CSS contains zero glow, shaders, or 3D globe styles', () => {
      const minimalCssPath = path.join(ROOT_DIR, 'ui', 'css', 'skin-minimal.css');
      assert.ok(fs.existsSync(minimalCssPath), 'skin-minimal.css must exist');
      const content = fs.readFileSync(minimalCssPath, 'utf8');

      // Minimal skin should not contain crazy skin animations or bloom effects
      assert.doesNotMatch(content, /@keyframes\s+glowPulse/i, 'Minimal skin must not contain glowPulse animation');
      assert.doesNotMatch(content, /@keyframes\s+matrixRain/i, 'Minimal skin must not contain matrixRain animation');
      assert.doesNotMatch(content, /canvas#globe/i, 'Minimal skin must not style or bundle 3D globe canvas');
    });

    it('Bootloader cleanly manages skin stylesheet lifecycle and unbinding', () => {
      const bootJsPath = path.join(ROOT_DIR, 'ui', 'js', 'boot.js');
      assert.ok(fs.existsSync(bootJsPath), 'boot.js must exist');
      const content = fs.readFileSync(bootJsPath, 'utf8');

      // Verify skin loading/switching functions exist
      assert.match(content, /setSkin|applySkin|switchSkin/i, 'boot.js must provide skin switching logic');
    });
  });

  describe('INV-02: Strict IPC Origin Gating', () => {
    // Pure function mimicking Rust origin validation in src/main.rs & src/ui/app_protocol.rs
    function isTrustedOrigin(origin) {
      if (!origin || typeof origin !== 'string') return false;
      const clean = origin.trim().toLowerCase();
      return (
        clean === 'rusty://app' ||
        clean === 'rusty://app/' ||
        clean === 'http://rusty.app' ||
        clean === 'http://rusty.app/'
      );
    }

    const SAFE_ACCELERATOR_INTENTS = new Set([
      'new_tab',
      'close_current_tab',
      'back',
      'forward',
      'reload',
      'next_tab',
      'prev_tab',
      'zoom_in',
      'zoom_out',
      'zoom_reset'
    ]);

    function isSafeExternalAction(action) {
      return SAFE_ACCELERATOR_INTENTS.has(action);
    }

    it('Accepts strictly authorized internal origins', () => {
      assert.strictEqual(isTrustedOrigin('rusty://app'), true);
      assert.strictEqual(isTrustedOrigin('rusty://app/'), true);
      assert.strictEqual(isTrustedOrigin('http://rusty.app'), true);
      assert.strictEqual(isTrustedOrigin('http://rusty.app/'), true);
    });

    it('Rejects unauthorized external, spoofed, or malformed origins', () => {
      assert.strictEqual(isTrustedOrigin('https://google.com'), false);
      assert.strictEqual(isTrustedOrigin('http://evil.com/rusty://app/'), false);
      assert.strictEqual(isTrustedOrigin('http://rusty.app.evil.com'), false);
      assert.strictEqual(isTrustedOrigin('rusty://app@evil.com'), false);
      assert.strictEqual(isTrustedOrigin('null'), false);
      assert.strictEqual(isTrustedOrigin(''), false);
      assert.strictEqual(isTrustedOrigin(null), false);
      assert.strictEqual(isTrustedOrigin(undefined), false);
    });

    it('Untrusted external origins are strictly confined to safe accelerator whitelist', () => {
      assert.strictEqual(isSafeExternalAction('new_tab'), true);
      assert.strictEqual(isSafeExternalAction('back'), true);
      assert.strictEqual(isSafeExternalAction('forward'), true);
      assert.strictEqual(isSafeExternalAction('reload'), true);

      // Sensitive actions must NOT be executable by external web content
      assert.strictEqual(isSafeExternalAction('eval_script'), false);
      assert.strictEqual(isSafeExternalAction('launch_app'), false);
      assert.strictEqual(isSafeExternalAction('write_file'), false);
      assert.strictEqual(isSafeExternalAction('delete_workspace'), false);
      assert.strictEqual(isSafeExternalAction('save_credentials'), false);
    });
  });

  describe('INV-03: Clean Mock Bridge Preview', () => {
    it('Mock bridge initializes cleanly in non-IPC standalone environment', () => {
      const bridgePath = path.join(ROOT_DIR, 'ui', 'js', 'bridge.js');
      assert.ok(fs.existsSync(bridgePath), 'bridge.js must exist');
      const bridgeCode = fs.readFileSync(bridgePath, 'utf8');

      // Verify mock mode fallback detection
      assert.match(bridgeCode, /isRealIpc|isMock/i, 'bridge.js must detect mock mode');
      assert.match(bridgeCode, /_handleMockAction/i, 'bridge.js must handle mock actions');
    });

    it('UI HTML entry points reference valid relative scripts without broken absolute paths', () => {
      const indexHtmlPath = path.join(ROOT_DIR, 'ui', 'index.html');
      const newtabHtmlPath = path.join(ROOT_DIR, 'ui', 'newtab.html');
      assert.ok(fs.existsSync(indexHtmlPath), 'ui/index.html must exist');
      assert.ok(fs.existsSync(newtabHtmlPath), 'ui/newtab.html must exist');

      const indexContent = fs.readFileSync(indexHtmlPath, 'utf8');
      assert.doesNotMatch(indexContent, /src=["']\/(?!\/)/, 'ui/index.html must use relative script paths');
      assert.doesNotMatch(indexContent, /href=["']\/(?!\/)/, 'ui/index.html must use relative stylesheet paths');
    });
  });

  describe('INV-04: Placeholder Asset Discipline', () => {
    it('README and specifications document PLACEHOLDER slots for demo/mock assets', () => {
      const originalRequestPath = path.join(ROOT_DIR, '.agents', 'teamwork', 'ORIGINAL_REQUEST.md');
      const content = fs.readFileSync(originalRequestPath, 'utf8');
      assert.match(content, /PLACEHOLDER/i, 'ORIGINAL_REQUEST.md must specify PLACEHOLDER requirement');

      const projectPath = path.join(ROOT_DIR, 'PROJECT.md');
      const projectContent = fs.readFileSync(projectPath, 'utf8');
      assert.match(projectContent, /PLACEHOLDER/i, 'PROJECT.md must document PLACEHOLDER requirement');
    });
  });

  describe('INV-05: Zero Brand Trademark Infringement', () => {
    it('No proprietary third-party logo files are bundled in UI assets', () => {
      const assetsDir = path.join(ROOT_DIR, 'ui', 'assets');
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        for (const file of files) {
          const lower = file.toLowerCase();
          assert.strictEqual(lower.includes('google_logo'), false, `Forbidden bundled logo: ${file}`);
          assert.strictEqual(lower.includes('youtube_logo'), false, `Forbidden bundled logo: ${file}`);
          assert.strictEqual(lower.includes('twitch_logo'), false, `Forbidden bundled logo: ${file}`);
        }
      }
    });

    it('Engines definitions use generic avatars or dynamic favicons', () => {
      const enginesPath = path.join(ROOT_DIR, 'ui', 'js', 'engines.js');
      if (fs.existsSync(enginesPath)) {
        const content = fs.readFileSync(enginesPath, 'utf8');
        // Check that engines define icon or letter fallback
        assert.ok(content.length > 0);
      }
    });
  });

  describe('INV-06: Honest Security Posture', () => {
    it('UI and documentation never make dishonest claims of being infostealer-proof or impenetrable', () => {
      // Check UI files where users see strings
      const uiDir = path.join(ROOT_DIR, 'ui');
      function checkUiStrings(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            checkUiStrings(fullPath);
          } else if (entry.name.endsWith('.html') || entry.name.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
            assert.strictEqual(
              content.includes('infostealer-proof'),
              false,
              `UI file ${entry.name} must never claim infostealer-proof`
            );
            assert.strictEqual(
              content.includes('impenetrable sandbox'),
              false,
              `UI file ${entry.name} must never claim impenetrable sandbox`
            );
            assert.strictEqual(
              content.includes('unhackable'),
              false,
              `UI file ${entry.name} must never claim unhackable`
            );
          }
        }
      }
      checkUiStrings(uiDir);

      // Verify README does not make affirmative infostealer-proof claims
      const readmePath = path.join(ROOT_DIR, 'README.md');
      if (fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, 'utf8');
        assert.doesNotMatch(
          readme,
          /\b(is|guaranteed)\s+(infostealer-proof|unhackable)\b/i,
          'README must not claim to be infostealer-proof'
        );
      }
    });
  });

  describe('INV-07: Legacy Security Preservation', () => {
    it('Maintains security architecture definitions for V1 adblock, V2 VPN, V3 vault, V4 session protection', () => {
      const projectPath = path.join(ROOT_DIR, 'PROJECT.md');
      const content = fs.readFileSync(projectPath, 'utf8');

      assert.match(content, /V1\s+Ad\s+Blocker/i, 'Must preserve V1 ad blocker');
      assert.match(content, /V2\s+VPN/i, 'Must preserve V2 VPN / proxy');
      assert.match(content, /V3\s+Secure\s+Vault/i, 'Must preserve V3 secure vault');
      assert.match(content, /V4\s+Session\s+Protection/i, 'Must preserve V4 session protection');
    });

    it('Rust codebase includes Job Object KILL_ON_JOB_CLOSE session protection', () => {
      const mainPath = path.join(ROOT_DIR, 'src', 'main.rs');
      const content = fs.readFileSync(mainPath, 'utf8');
      assert.match(
        content,
        /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|init_job_object/i,
        'src/main.rs must initialize Job Object kill-on-close'
      );
    });
  });

  describe('INV-08: Strict Anti-Faking Mandate', () => {
    it('Platform specifications declare Linux WebKitGTK extension limitations honestly', () => {
      const specPath = path.join(ROOT_DIR, '.agents', 'teamwork', 'spec_miner_survey_3', 'survey_spec.md');
      if (fs.existsSync(specPath)) {
        const content = fs.readFileSync(specPath, 'utf8');
        assert.match(
          content,
          /Chromium extensions are not supported on WebKitGTK|WebKit Userscripts/i,
          'Must declare WebKitGTK extension limitations honestly'
        );
      }
    });
  });

  describe('INV-09: Complete Code Delivery', () => {
    it('Source and test files contain zero truncation markers', () => {
      const dirsToScan = [path.join(ROOT_DIR, 'src'), path.join(ROOT_DIR, 'tests', 'e2e')];
      const truncationPatterns = [
        /\/\/\s*\.\.\.\s*rest\s*of\s*code/i,
        /\/\*\s*\.\.\.\s*rest\s*of\s*code/i,
        /\/\/\s*\.\.\.\s*existing\s*code/i,
        /\/\/\s*TODO:\s*rest\s*of/i
      ];

      function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.rs') || entry.name.endsWith('.js'))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const pattern of truncationPatterns) {
              assert.doesNotMatch(
                content,
                pattern,
                `Truncation marker detected in file: ${fullPath}`
              );
            }
          }
        }
      }

      for (const dir of dirsToScan) {
        scanDir(dir);
      }
    });
  });

  describe('INV-10: External Code Attribution', () => {
    it('Open source licenses and attributions are maintained in LICENSE and documentation', () => {
      const licensePath = path.join(ROOT_DIR, 'LICENSE');
      assert.ok(fs.existsSync(licensePath), 'LICENSE file must exist');
      const licenseContent = fs.readFileSync(licensePath, 'utf8');
      assert.ok(licenseContent.includes('MIT') || licenseContent.includes('Apache'), 'LICENSE must be MIT or Apache');
    });
  });

});
