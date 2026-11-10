/**
 * Milestone R4: Focus Mode & YouTube Restrictor Verification Suite
 *
 * Verifies Study, Work, and Deep Work modes, category-based domain blocking,
 * YouTube educational gate & Shorts redirection, calm interstitial with 10s
 * confirmation phrase guard, workspace auto-linking, and Rust navigation enforcement.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

describe('Milestone R4: Focus Mode & YouTube Restrictor Suite', () => {

  describe('Feature 23: Rust Focus Mode Engine & Preset Timers', () => {
    it('Verifies FocusManager, FocusModeKind, and default timers in src/focus.rs', () => {
      const focusRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'focus.rs'), 'utf8');
      assert.ok(focusRs.includes('pub struct FocusManager'), 'Exposes FocusManager struct');
      assert.ok(focusRs.includes('pub enum FocusModeKind'), 'Exposes FocusModeKind enum');
      assert.ok(focusRs.includes('Study => 25 * 60'), 'Study mode has 25 min default timer');
      assert.ok(focusRs.includes('Work => 50 * 60'), 'Work mode has 50 min default timer');
      assert.ok(focusRs.includes('Deep => 90 * 60'), 'Deep Work mode has 90 min default timer');
    });

    it('Verifies domain categories (Social Media, Entertainment, Gaming) in src/focus.rs', () => {
      const focusRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'focus.rs'), 'utf8');
      assert.ok(focusRs.includes('twitter.com') && focusRs.includes('instagram.com'), 'Blocks social media');
      assert.ok(focusRs.includes('netflix.com') && focusRs.includes('twitch.tv'), 'Blocks entertainment/streaming');
      assert.ok(focusRs.includes('steampowered.com') && focusRs.includes('roblox.com'), 'Blocks gaming');
    });

    it('Verifies Deep Work strict whitelist enforcement', () => {
      const focusRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'focus.rs'), 'utf8');
      assert.ok(focusRs.includes('FocusModeKind::Deep'), 'Implements Deep Work evaluation');
      assert.ok(focusRs.includes('allowed_whitelist'), 'Maintains strict whitelist');
    });
  });

  describe('Feature 24: YouTube Study Filter & Shorts Redirection', () => {
    it('Verifies YouTube Shorts redirection in src/focus.rs and src/main.rs', () => {
      const focusRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'focus.rs'), 'utf8');
      assert.ok(focusRs.includes('redirect_shorts_to_watch'), 'Configures Shorts redirection flag');
      assert.ok(focusRs.includes('/shorts/'), 'Parses /shorts/ URL path');

      const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      assert.ok(mainRs.includes("location.pathname.startsWith('/shorts/')"), 'Injected script checks /shorts/');
      assert.ok(mainRs.includes("https://www.youtube.com/watch?v="), 'Redirects to standard watch view');
    });

    it('Verifies YouTube distraction-free element hiding in ui/js/youtube_focus.js', () => {
      const ytScriptPath = path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js');
      assert.ok(fs.existsSync(ytScriptPath), 'ui/js/youtube_focus.js exists');
      const ytJs = fs.readFileSync(ytScriptPath, 'utf8');
      assert.ok(ytJs.includes('ytd-rich-shelf-renderer[is-shorts]'), 'Hides Shorts shelves');
      assert.ok(ytJs.includes('ytd-comments'), 'Hides comments during focus');
      assert.ok(ytJs.includes('#related'), 'Hides sidebar recommendation distractions');
      assert.ok(ytJs.includes('history.pushState'), 'Hooks SPA history state transitions');
    });

    it('Verifies YouTube gaming videos hiding and educational/finance filtering', () => {
      const ytScriptPath = path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js');
      const ytJs = fs.readFileSync(ytScriptPath, 'utf8');
      assert.ok(ytJs.includes('GAMING_KEYWORDS'), 'Contains gaming keywords dictionary');
      assert.ok(ytJs.includes('EDUCATIONAL_KEYWORDS'), 'Contains educational keywords dictionary');
      assert.ok(ytJs.includes('FINANCE_KEYWORDS'), 'Contains finance keywords dictionary');
      assert.ok(ytJs.includes('evaluateVideo'), 'Implements video classification evaluator');
      assert.ok(ytJs.includes('processCard'), 'Hides non-educational/gaming cards');
      assert.ok(ytJs.includes('checkWatchPageGate'), 'Protects watch page playback');
    });
  });

  describe('Feature 25: Calm Interstitial Page & 10s Confirmation Bypass Guard', () => {
    it('Verifies ui/interstitial.html exists with calm typography and timer', () => {
      const interPath = path.join(ROOT_DIR, 'ui', 'interstitial.html');
      assert.ok(fs.existsSync(interPath), 'ui/interstitial.html exists');
      const html = fs.readFileSync(interPath, 'utf8');
      assert.ok(html.includes('Stay focused'), 'Displays calm title');
      assert.ok(html.includes('timer-digits'), 'Displays session remaining digits');
      assert.ok(html.includes('destination-chip'), 'Displays blocked destination');
    });

    it('Verifies 10-second wait guard and exact confirmation phrase requirement', () => {
      const html = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'interstitial.html'), 'utf8');
      assert.ok(html.includes('Wait 10s...'), 'Starts with 10-second wait countdown');
      assert.ok(html.includes('I choose to break my focus'), 'Requires exact confirmation phrase');
      assert.ok(html.includes('bypass-dialog'), 'Renders confirmation dialog');

      const focusRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'focus.rs'), 'utf8');
      assert.ok(focusRs.includes('BYPASS_CONFIRMATION_PHRASE') && focusRs.includes('I choose to break my focus'), 'Rust backend validates matching phrase');
    });
  });

  describe('Feature 26: Workspace Auto-Link & Rust Navigation Enforcement', () => {
    it('Verifies College and Projects workspace auto-linking in src/focus.rs and src/main.rs', () => {
      const focusRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'focus.rs'), 'utf8');
      assert.ok(focusRs.includes('on_workspace_switch'), 'FocusManager exposes on_workspace_switch');
      assert.ok(focusRs.includes('college'), 'Links College workspace to Study mode');

      const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      assert.ok(mainRs.includes('on_workspace_switch(&target_ws.name)'), 'SwitchWorkspace calls on_workspace_switch');
    });

    it('Verifies Rust navigation handler blocks restricted URLs and loads interstitial', () => {
      const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      assert.ok(mainRs.includes('global_focus_manager().lock()'), 'Navigation handler queries global_focus_manager');
      assert.ok(mainRs.includes('FocusDecision::Blocked'), 'Matches FocusDecision::Blocked');
      assert.ok(mainRs.includes('rusty://app/interstitial.html'), 'Navigates to interstitial page on block');
    });

    it('Verifies New Tab Page focus card controls in ui/js/newtab.js', () => {
      const newtabJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'newtab.js'), 'utf8');
      assert.ok(newtabJs.includes('start_focus'), 'Sends start_focus IPC message');
      assert.ok(newtabJs.includes('pause_focus'), 'Sends pause_focus IPC message');
      assert.ok(newtabJs.includes('stop_focus'), 'Sends stop_focus IPC message');
      assert.ok(newtabJs.includes('focus_state_changed'), 'Listens for focus_state_changed backend event');
    });
  });

});
