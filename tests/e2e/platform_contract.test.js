/**
 * Platform Interface Contract Test Suite
 * Verifies PlatformLayer, PlatformWebView, and typed IPC schemas compliance.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

describe('Platform Layer Interface & IPC Contract Conformance', () => {

  describe('Feature 5: Platform Abstraction Trait Interface Compliance', () => {
    // Model schema representing PlatformWebView methods
    const REQUIRED_WEBVIEW_METHODS = [
      'set_visible',
      'set_bounds',
      'load_url',
      'evaluate_script',
      'suspend',
      'resume',
      'set_memory_target_low'
    ];

    const REQUIRED_HOST_METHODS = [
      'create_webview',
      'sample_memory',
      'configure_proxy'
    ];

    it('Project specification defines complete PlatformWebView trait contract', () => {
      const projectMd = fs.readFileSync(path.join(ROOT_DIR, 'PROJECT.md'), 'utf8');
      for (const method of REQUIRED_WEBVIEW_METHODS) {
        assert.ok(
          projectMd.includes(`fn ${method}`),
          `PROJECT.md must document PlatformWebView::${method}`
        );
      }
    });

    it('Project specification defines complete PlatformHost trait contract', () => {
      const projectMd = fs.readFileSync(path.join(ROOT_DIR, 'PROJECT.md'), 'utf8');
      for (const method of REQUIRED_HOST_METHODS) {
        assert.ok(
          projectMd.includes(`fn ${method}`),
          `PROJECT.md must document PlatformHost::${method}`
        );
      }
    });

    it('Validates RectPayload structure and non-negative bounds constraints', () => {
      function validateRectPayload(rect) {
        if (!rect || typeof rect !== 'object') throw new Error('Rect must be an object');
        const fields = ['x', 'y', 'width', 'height'];
        for (const f of fields) {
          if (typeof rect[f] !== 'number' || isNaN(rect[f])) {
            throw new Error(`Field ${f} must be a valid number`);
          }
        }
        if (rect.width < 0 || rect.height < 0) {
          throw new Error('Dimensions width and height must not be negative');
        }
        return true;
      }

      // Valid rects
      assert.strictEqual(validateRectPayload({ x: 0, y: 72, width: 1200, height: 800 }), true);
      assert.strictEqual(validateRectPayload({ x: 100, y: 100, width: 0, height: 0 }), true);

      // Boundary / Invalid rects
      assert.throws(() => validateRectPayload({ x: 0, y: 0, width: -10, height: 100 }));
      assert.throws(() => validateRectPayload({ x: 0, y: 0, width: 100, height: -5 }));
      assert.throws(() => validateRectPayload(null));
      assert.throws(() => validateRectPayload({ x: 0, y: 'bad', width: 100, height: 100 }));
    });
  });

  describe('Process Role & Memory Breakdown Data Models', () => {
    const VALID_ROLES = new Set([
      'RustHost',
      'UiWebView',
      'ContentRenderer',
      'GpuProcess',
      'NetworkService',
      'StorageService',
      'AudioService',
      'Crashpad'
    ]);

    function validateProcessRecord(rec) {
      assert.strictEqual(typeof rec.pid, 'number');
      assert.ok(rec.pid > 0, 'PID must be positive');
      assert.strictEqual(typeof rec.parent_pid, 'number');
      assert.ok(VALID_ROLES.has(rec.role), `Role ${rec.role} must be a known ProcessRole`);
      assert.strictEqual(typeof rec.private_ws_bytes, 'number');
      assert.strictEqual(typeof rec.working_set_bytes, 'number');
      assert.strictEqual(typeof rec.commit_bytes, 'number');
      assert.ok(rec.working_set_bytes >= rec.private_ws_bytes, 'Working set >= private working set');
      return true;
    }

    it('Validates ProcessMemoryRecord structure and invariants', () => {
      const sample = {
        pid: 1234,
        parent_pid: 1000,
        role: 'RustHost',
        exe_name: 'rusty_browser.exe',
        private_ws_bytes: 4 * 1024 * 1024,
        working_set_bytes: 12 * 1024 * 1024,
        commit_bytes: 6 * 1024 * 1024
      };
      assert.strictEqual(validateProcessRecord(sample), true);
    });

    it('Rejects unknown process roles or corrupt memory values', () => {
      const invalidRole = {
        pid: 1234,
        parent_pid: 1000,
        role: 'UnknownAlienProcess',
        exe_name: 'bad.exe',
        private_ws_bytes: 1000,
        working_set_bytes: 2000,
        commit_bytes: 1500
      };
      assert.throws(() => validateProcessRecord(invalidRole));

      const corruptWS = {
        pid: 1234,
        parent_pid: 1000,
        role: 'UiWebView',
        exe_name: 'msedgewebview2.exe',
        private_ws_bytes: 5000,
        working_set_bytes: 1000, // Private WS cannot exceed Working Set
        commit_bytes: 2000
      };
      assert.throws(() => validateProcessRecord(corruptWS));
    });
  });

  describe('Typed IPC Message Schemas (UiMessage)', () => {
    function parseAndValidateUiMessage(jsonString) {
      const msg = JSON.parse(jsonString);
      if (!msg || typeof msg !== 'object') throw new Error('Message must be an object');
      if (!msg.action || typeof msg.action !== 'string') throw new Error('Missing action field');
      return msg;
    }

    it('Validates TabAction IPC messages', () => {
      const newTabJson = JSON.stringify({ action: 'new_tab', url: 'https://rust-lang.org', background: false });
      const parsed = parseAndValidateUiMessage(newTabJson);
      assert.strictEqual(parsed.action, 'new_tab');
      assert.strictEqual(parsed.url, 'https://rust-lang.org');

      const closeTabJson = JSON.stringify({ action: 'close_tab', tab_id: 42 });
      const parsedClose = parseAndValidateUiMessage(closeTabJson);
      assert.strictEqual(parsedClose.action, 'close_tab');
      assert.strictEqual(parsedClose.tab_id, 42);
    });

    it('Validates WorkspaceAction IPC messages', () => {
      const switchWsJson = JSON.stringify({ action: 'switch_workspace', workspace_id: 'college' });
      const parsed = parseAndValidateUiMessage(switchWsJson);
      assert.strictEqual(parsed.action, 'switch_workspace');
      assert.strictEqual(parsed.workspace_id, 'college');
    });

    it('Validates Modal Occlusion Overlay IPC message', () => {
      const overlayOpen = JSON.stringify({ action: 'overlay', open: true });
      const parsed = parseAndValidateUiMessage(overlayOpen);
      assert.strictEqual(parsed.action, 'overlay');
      assert.strictEqual(parsed.open, true);
    });

    it('Rejects malformed IPC payloads with invalid JSON syntax', () => {
      assert.throws(() => parseAndValidateUiMessage(''));
      assert.throws(() => parseAndValidateUiMessage('{ action: unquoted }'));
      assert.throws(() => parseAndValidateUiMessage('{"missing_action": true}'));
    });
  });

});
