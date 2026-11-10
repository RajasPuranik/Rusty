const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('Milestone R7: Customizable Launch Cards Suite', async (t) => {
  await t.test('Feature: Rust LaunchCard Model & Safe App Allowlist', () => {
    const storageRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage.rs'), 'utf8');
    assert.ok(storageRs.includes('struct LaunchCard'), 'Defines LaunchCard struct in storage.rs');
    assert.ok(storageRs.includes('pub launch_cards: Vec<LaunchCard>'), 'Settings includes launch_cards vector');
    assert.ok(storageRs.includes('default_launch_cards'), 'Provides default_launch_cards constructor');

    const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
    assert.ok(mainRs.includes('fn launch_safe_app'), 'Defines launch_safe_app allowlist validator');
    assert.ok(mainRs.includes('LaunchLocalApp'), 'UiMessage exposes LaunchLocalApp variant');
    assert.ok(mainRs.includes('GetMiniWidgetStat'), 'UiMessage exposes GetMiniWidgetStat variant');
    assert.ok(mainRs.includes('Application not found') || mainRs.includes('Application not allowed'), 'Handles missing/disallowed apps honestly');
  });

  await t.test('Feature: Dynamic Launch Cards UI & Edit Modal', () => {
    const newtabHtml = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'newtab.html'), 'utf8');
    assert.ok(newtabHtml.includes('id="launch-cards-grid"'), 'Provides dynamic #launch-cards-grid container');
    assert.ok(newtabHtml.includes('id="card-edit-modal-backdrop"'), 'Provides card edit modal backdrop');
    assert.ok(newtabHtml.includes('id="card-edit-form"'), 'Provides card edit form');
    assert.ok(newtabHtml.includes('id="toast-container"'), 'Provides toast notification container');
    assert.ok(newtabHtml.includes('id="btn-export-launch-cards"'), 'Provides export cards button');
    assert.ok(newtabHtml.includes('id="btn-import-launch-cards"'), 'Provides import cards button');

    const newtabJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'newtab.js'), 'utf8');
    assert.ok(newtabJs.includes('renderLaunchCards'), 'Renders launch cards dynamically');
    assert.ok(newtabJs.includes('openCardEditModal'), 'Opens card edit modal');
    assert.ok(newtabJs.includes('executeLaunchCard'), 'Executes card action (app, web, action, widget)');
    assert.ok(newtabJs.includes('showToast'), 'Displays toast notification for user feedback');
    assert.ok(newtabJs.includes('move-left') && newtabJs.includes('move-right'), 'Supports 1-click card reordering');
  });
});
