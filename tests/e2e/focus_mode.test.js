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
const vm = require('vm');

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

  describe('Feature 27: Live YouTube Focus Filter Runtime, Trusted Types & Red Warning Gate', () => {
    it('Has zero innerHTML assignments in youtube_focus.js and supports get_focus_state live pull in main.rs', () => {
      const ytJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js'), 'utf8');
      assert.ok(!ytJs.includes('.innerHTML'), 'Must never assign .innerHTML due to YouTube Trusted Types CSP');
      assert.ok(ytJs.includes('ENTERTAINMENT_KEYWORDS'), 'Blocks entertainment/skit/dance/trailer content');
      assert.ok(ytJs.includes('get_focus_state'), 'Pulls live focus state via IPC to avoid stale init snapshots');

      const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      assert.ok(mainRs.includes('SyncFocusToTab'), 'Handles SyncFocusToTab event for content webviews');
      assert.ok(mainRs.includes('enforce_focus_on_open_tabs'), 'Enforces focus rules immediately on open tabs');
    });

    it('Accurately classifies entertainment, gaming, skits, dance, trailers, shorts vs educational/finance and builds red warning gate under strict Trusted Types', () => {
      const ytJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js'), 'utf8');
      const timers = [];
      const ipcSent = [];
      const createdElements = [];

      function makeEl(tag, initialProps = {}) {
        const children = [];
        const attrs = new Map();
        const styleMap = new Map();
        const styleObj = {
          cssText: '',
          setProperty(k, v) { styleMap.set(k, v); },
          removeProperty(k) { styleMap.delete(k); },
          getPropertyValue(k) { return styleMap.get(k) || ''; },
          get display() { return styleMap.get('display') || ''; },
          set display(v) { styleMap.set('display', v); }
        };
        const el = {
          tagName: tag.toUpperCase(),
          id: initialProps.id || '',
          textContent: initialProps.textContent || '',
          dataset: {},
          style: styleObj,
          children,
          parentNode: null,
          listeners: new Map(),
          paused: false,
          pauseCalled: 0,
          pause() { el.paused = true; el.pauseCalled++; },
          appendChild(child) {
            child.parentNode = el;
            children.push(child);
            return child;
          },
          insertBefore(newChild, refChild) {
            newChild.parentNode = el;
            const idx = children.indexOf(refChild);
            if (idx >= 0) children.splice(idx, 0, newChild);
            else children.unshift(newChild);
            return newChild;
          },
          remove() {
            if (el.parentNode) {
              const i = el.parentNode.children.indexOf(el);
              if (i >= 0) el.parentNode.children.splice(i, 1);
            }
          },
          setAttribute(k, v) { attrs.set(k, String(v)); },
          getAttribute(k) { return attrs.get(k) ?? null; },
          removeAttribute(k) { attrs.delete(k); },
          addEventListener(evt, fn) { el.listeners.set(evt, fn); },
          matches(sel) { return sel.split(',').some((s) => s.trim().toLowerCase() === tag.toLowerCase()); },
          closest() { return null; },
          querySelector(sel) {
            if (sel.includes('#above-the-fold') && el.__watchTitleEl) return el.__watchTitleEl;
            if (sel.includes('#channel-name') && el.__watchChannelEl) return el.__watchChannelEl;
            if (sel === '#rusty-yt-focus-banner-text') {
              return findById(el, 'rusty-yt-focus-banner-text');
            }
            return null;
          },
          querySelectorAll() { return []; }
        };
        Object.defineProperty(el, 'innerHTML', {
          get() { return ''; },
          set() { throw new TypeError("This document requires 'TrustedHTML' assignment."); }
        });
        createdElements.push(el);
        return el;
      }

      function findById(root, id) {
        if (root.id === id) return root;
        for (const c of root.children || []) {
          const hit = findById(c, id);
          if (hit) return hit;
        }
        return null;
      }

      const head = makeEl('head');
      const body = makeEl('body');
      const documentElement = makeEl('html');
      documentElement.appendChild(head);
      documentElement.appendChild(body);

      const masthead = makeEl('div', { id: 'masthead-container' });
      const player = makeEl('div', { id: 'player' });
      const videoEl = makeEl('video');
      const watchTitle = makeEl('yt-formatted-string', { textContent: 'Angry Birds 3 Official Trailer 2' });
      const watchChannel = makeEl('div', { textContent: 'Movies & Trailers' });
      body.appendChild(masthead);
      body.appendChild(player);
      body.appendChild(videoEl);

      const fakeDoc = {
        head,
        body,
        documentElement,
        title: 'Angry Birds 3 Official Trailer 2 - YouTube',
        createElement: (t) => makeEl(t),
        getElementById(id) { return findById(documentElement, id); },
        addEventListener() {},
        querySelector(sel) {
          if (sel.includes('#above-the-fold')) return watchTitle;
          if (sel.includes('#channel-name')) return watchChannel;
          if (sel.includes('#player')) return player;
          if (sel.includes('#masthead-container')) return masthead;
          return null;
        },
        querySelectorAll(sel) {
          if (sel === 'video') return [videoEl];
          return [];
        }
      };

      const fakeWin = {
        location: {
          hostname: 'www.youtube.com',
          pathname: '/watch',
          search: '?v=abc123',
          href: 'https://www.youtube.com/watch?v=abc123',
          replace() {}
        },
        history: { pushState() {}, replaceState() {} },
        ipc: { postMessage(msg) { ipcSent.push(JSON.parse(msg)); } },
        __RUSTY_FOCUS_STATE__: { is_active: true, is_paused: false, mode: 'Study' },
        addEventListener() {}
      };
      fakeWin.window = fakeWin;
      fakeWin.top = fakeWin;

      const sandbox = {
        window: fakeWin,
        document: fakeDoc,
        history: fakeWin.history,
        URLSearchParams,
        RegExp,
        Set,
        Map,
        Array,
        Boolean,
        JSON,
        console,
        MutationObserver: class { observe() {} },
        setTimeout: (fn) => 0,
        setInterval: (fn) => { const id = timers.length + 1; timers.push(id); return id; },
        clearTimeout() {},
        clearInterval() {}
      };
      vm.runInNewContext(ytJs, sandbox);

      // 1) Verify IPC requested live focus state immediately on init
      assert.ok(ipcSent.some((m) => m.action === 'get_focus_state'), 'Sent live get_focus_state pull IPC');

      // 2) Verify Red Warning watch gate rendered without innerHTML error and paused video
      const gate = findById(documentElement, 'rusty-yt-watch-gate');
      assert.ok(gate, 'Created #rusty-yt-watch-gate without throwing TrustedHTML error');
      assert.ok(videoEl.paused && videoEl.pauseCalled > 0, 'Paused blocked video playback');
      function collectText(node) {
        if (!node) return '';
        return (node.textContent || '') + ' ' + (node.children || []).map(collectText).join(' ');
      }
      const gateText = collectText(gate);
      assert.ok(gateText.includes('Focus on Your Studies & Work!'), 'Shows focus on studies/work warning message');

      // 3) Verify video classification evaluator on all reported distraction cases vs educational/finance
      const evalFn = fakeWin.__rustyFocusEvaluate;
      assert.equal(evalFn('Bairan - Animated Love Story | Banjaare (Official Video)', '/watch?v=1', 'Banjaare').allowed, false);
      assert.equal(evalFn('Hansika 4K 60FPS | UHD HUNTER', '/watch?v=2', 'UHD HUNTERYT').allowed, false);
      assert.equal(evalFn('Hi Me In 10 Years', '/watch?v=3', 'MrBeast').allowed, false);
      assert.equal(evalFn('Funny Skit Try Not To Laugh Reaction', '/watch?v=4', 'ComedyChannel').allowed, false);
      assert.equal(evalFn('Official Dance Video Choreography', '/watch?v=5', 'T-Series').allowed, false);
      assert.equal(evalFn('Official Movie Trailer 2 (2026)', '/watch?v=6', 'Studio').allowed, false);
      assert.equal(evalFn('Minecraft Survival Gameplay Walkthrough', '/watch?v=7', 'Gamer').allowed, false);
      assert.equal(evalFn('Any Short Clip', '/shorts/xyz999', 'Creator').allowed, false);

      // Allowed educational & finance content
      assert.equal(evalFn('MIT OpenCourseWare Calculus Lecture 1', '/watch?v=10', 'MIT OpenCourseWare').allowed, true);
      assert.equal(evalFn('Rust Programming Tutorial: Ownership and Borrowing', '/watch?v=11', 'DevChannel').allowed, true);
      assert.equal(evalFn('Stock Market & Personal Finance Investing Basics', '/watch?v=12', 'FinanceEd').allowed, true);
      assert.equal(evalFn('Essence of Linear Algebra', '/watch?v=13', '3Blue1Brown').allowed, true);
      assert.equal(evalFn('10th Physics Chapter 1 One Shot Revision', '/watch?v=14', 'Disha Online Classes').allowed, true);

      // 4) Turning Focus Mode OFF removes red warning gate & banner immediately
      fakeWin.__rustyOnFocusState({ state: { is_active: false, is_paused: false, mode: 'Study' } });
      assert.equal(findById(documentElement, 'rusty-yt-watch-gate'), null, 'Removes watch gate when Focus Mode stops');
      assert.equal(findById(documentElement, 'rusty-yt-focus-banner'), null, 'Removes focus banner when Focus Mode stops');
    });
  });

});
