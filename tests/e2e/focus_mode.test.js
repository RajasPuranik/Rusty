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

  describe('Feature 24: YouTube Study Filter, Thumbnail Blur & Leave-Focus Warning', () => {
    it('Verifies YouTube Shorts & early thumbnail blur in src/focus.rs and src/main.rs', () => {
      const focusRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'focus.rs'), 'utf8');
      assert.ok(focusRs.includes('redirect_shorts_to_watch'), 'Configures Shorts redirection flag');
      assert.ok(focusRs.includes('/shorts/'), 'Parses /shorts/ URL path');

      const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      assert.ok(mainRs.includes("location.pathname.startsWith('/shorts/')"), 'Injected script checks /shorts/');
      assert.ok(mainRs.includes('rusty-early-shorts-blur'), 'Injects early Shorts thumbnail blur style without hiding tiles');
      assert.ok(mainRs.includes('__rustyShouldInterceptFocusClick'), 'Hooks middle/Ctrl clicks into Focus warning modal');
    });

    it('Verifies thumbnail blur CSS, comments hiding & leave-focus modal in ui/js/youtube_focus.js', () => {
      const ytScriptPath = path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js');
      assert.ok(fs.existsSync(ytScriptPath), 'ui/js/youtube_focus.js exists');
      const ytJs = fs.readFileSync(ytScriptPath, 'utf8');
      assert.ok(ytJs.includes('filter: blur(22px)'), 'Blurs thumbnails for Shorts and distracting videos');
      assert.ok(ytJs.includes('data-rusty-blurred'), 'Marks non-educational and Shorts cards as blurred');
      assert.ok(ytJs.includes('You are leaving Focus Mode'), 'Includes leave-focus warning modal heading');
      assert.ok(ytJs.includes('ytd-comments'), 'Hides comments during focus');
      assert.ok(ytJs.includes('#related'), 'Handles sidebar recommendations');
      assert.ok(ytJs.includes('history.pushState'), 'Hooks SPA history state transitions');
    });

    it('Verifies YouTube gaming/entertainment blurring and educational/finance filtering', () => {
      const ytScriptPath = path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js');
      const ytJs = fs.readFileSync(ytScriptPath, 'utf8');
      assert.ok(ytJs.includes('GAMING_KEYWORDS'), 'Contains gaming keywords dictionary');
      assert.ok(ytJs.includes('EDUCATIONAL_KEYWORDS'), 'Contains educational keywords dictionary');
      assert.ok(ytJs.includes('FINANCE_KEYWORDS'), 'Contains finance keywords dictionary');
      assert.ok(ytJs.includes('evaluateVideo'), 'Implements video classification evaluator');
      assert.ok(ytJs.includes('applyBlurToCard'), 'Blurs distracting thumbnails while keeping Edu/Finance clear');
      assert.ok(ytJs.includes('checkWatchPageGate'), 'Protects direct watch and Shorts pages');
    });

    it('Verifies all injected JS scripts (CONTENT_INIT_SCRIPT & youtube_focus.js) are syntactically valid', () => {
      const ytJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js'), 'utf8');
      assert.doesNotThrow(() => new vm.Script(ytJs), 'youtube_focus.js must parse cleanly');

      const mainRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'main.rs'), 'utf8');
      const startMarker = 'const CONTENT_INIT_SCRIPT: &str = r#"';
      const startIdx = mainRs.indexOf(startMarker);
      assert.ok(startIdx >= 0, 'Located CONTENT_INIT_SCRIPT in src/main.rs');
      const bodyStart = startIdx + startMarker.length;
      const bodyEnd = mainRs.indexOf('"#;', bodyStart);
      assert.ok(bodyEnd > bodyStart, 'Found end of CONTENT_INIT_SCRIPT');
      const contentInitJs = mainRs.slice(bodyStart, bodyEnd);
      assert.doesNotThrow(() => new vm.Script(contentInitJs), 'CONTENT_INIT_SCRIPT must parse cleanly');

      const extRs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'extensions.rs'), 'utf8');
      const usMarker = 'r#"\n(() => {{';
      const usStart = extRs.indexOf(usMarker);
      assert.ok(usStart >= 0, 'Located build_userscripts_injection_js template in src/extensions.rs');
      const usEnd = extRs.indexOf('\n"#', usStart);
      assert.ok(usEnd > usStart, 'Found end of userscripts template');
      const renderedUserscriptsJs = extRs
        .slice(usStart + 4, usEnd)
        .replace(/\{serialized\}/g, '[]')
        .replace(/\{\{/g, '{')
        .replace(/\}\}/g, '}');
      assert.doesNotThrow(() => new vm.Script(renderedUserscriptsJs), 'build_userscripts_injection_js rendered JS must parse cleanly');
      assert.ok(!extRs.includes('{{{{'), 'extensions.rs must not contain quadruple braces');
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

    it('Blurs Shorts & distracting thumbnails, intercepts clicks with "You are leaving Focus Mode" modal under Trusted Types, and protects watch pages', () => {
      const ytJs = fs.readFileSync(path.join(ROOT_DIR, 'ui', 'js', 'youtube_focus.js'), 'utf8');
      const timers = [];
      const ipcSent = [];
      const winListeners = [];
      const docListeners = [];

      function findById(root, id) {
        if (!root) return null;
        if (root.id === id) return root;
        for (const c of root.children || []) {
          const hit = findById(c, id);
          if (hit) return hit;
        }
        return null;
      }

      function findByClass(root, cls) {
        const res = [];
        if (!root) return res;
        if (root.className && root.className.split(/\s+/).includes(cls)) res.push(root);
        for (const c of root.children || []) res.push(...findByClass(c, cls));
        return res;
      }

      function collectByTagOrAttr(root, pred, out = []) {
        if (!root) return out;
        if (pred(root)) out.push(root);
        for (const c of root.children || []) collectByTagOrAttr(c, pred, out);
        return out;
      }

      function makeEl(tag, initialProps = {}) {
        const children = [];
        const attrs = new Map();
        if (initialProps.href) attrs.set('href', initialProps.href);
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
          className: initialProps.className || '',
          href: initialProps.href || '',
          textContent: initialProps.textContent || '',
          dataset: {},
          style: styleObj,
          children,
          parentNode: null,
          listeners: new Map(),
          paused: false,
          pauseCalled: 0,
          pause() { el.paused = true; el.pauseCalled++; },
          focus() {},
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
          matches(sel) {
            return sel.split(',').some((s) => s.trim().toLowerCase() === el.tagName.toLowerCase());
          },
          closest(sel) {
            let cur = el;
            while (cur) {
              if (sel === '[data-rusty-blurred]' && cur.dataset && cur.dataset.rustyBlurred) return cur;
              if (sel === '[data-rusty-shorts-nav="true"]' && cur.getAttribute && cur.getAttribute('data-rusty-shorts-nav') === 'true') return cur;
              if (sel === 'a[href]' && cur.tagName === 'A' && cur.getAttribute && cur.getAttribute('href')) return cur;
              if (sel.startsWith('#') && cur.id === sel.slice(1)) return cur;
              if (cur.matches(sel)) return cur;
              cur = cur.parentNode;
            }
            return null;
          },
          querySelector(sel) {
            const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
            for (const part of parts) {
              if (part === '#rusty-yt-focus-banner-text') {
                const hit = findById(el, 'rusty-yt-focus-banner-text');
                if (hit) return hit;
              } else if (part.includes('.rusty-blur-badge')) {
                const hit = findByClass(el, 'rusty-blur-badge')[0];
                if (hit) return hit;
              } else if (part === 'yt-thumbnail-view-model') {
                const hit = collectByTagOrAttr(el, (n) => n.tagName === 'YT-THUMBNAIL-VIEW-MODEL')[0];
                if (hit) return hit;
              } else if (part === '#video-title' || part === 'h3') {
                const hit = findById(el, 'video-title') || collectByTagOrAttr(el, (n) => n.tagName === 'H3')[0];
                if (hit) return hit;
              } else if (part === '#channel-name') {
                const hit = findById(el, 'channel-name');
                if (hit) return hit;
              } else if (part === 'a[href*="/shorts"]') {
                const hit = collectByTagOrAttr(el, (n) => n.tagName === 'A' && (n.getAttribute('href') || '').includes('/shorts'))[0];
                if (hit) return hit;
              } else if (part === 'a[href*="/watch"]') {
                const hit = collectByTagOrAttr(el, (n) => n.tagName === 'A' && (n.getAttribute('href') || '').includes('/watch'))[0];
                if (hit) return hit;
              } else if (part === 'a[href]') {
                const hit = collectByTagOrAttr(el, (n) => n.tagName === 'A' && Boolean(n.getAttribute('href')))[0];
                if (hit) return hit;
              }
            }
            return null;
          },
          querySelectorAll(sel) {
            if (sel.includes('.rusty-blur-badge')) return findByClass(el, 'rusty-blur-badge');
            if (sel.includes('a[href]')) return collectByTagOrAttr(el, (n) => n.tagName === 'A' && Boolean(n.getAttribute('href')));
            return [];
          }
        };
        Object.defineProperty(el, 'innerHTML', {
          get() { return ''; },
          set() { throw new TypeError("This document requires 'TrustedHTML' assignment."); }
        });
        return el;
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

      // Home feed sample cards: 1 Short, 1 Educational video, 1 Gaming video
      const shortCard = makeEl('ytm-shorts-lockup-view-model-v2');
      const shortThumb = makeEl('yt-thumbnail-view-model');
      const shortLink = makeEl('a', { href: 'https://www.youtube.com/shorts/short123', textContent: 'Viral Dance Clip' });
      shortThumb.appendChild(shortLink);
      shortCard.appendChild(shortThumb);

      const eduCard = makeEl('ytd-rich-item-renderer');
      const eduThumb = makeEl('yt-thumbnail-view-model');
      const eduTitle = makeEl('h3', { id: 'video-title', textContent: 'MIT 18.06 Linear Algebra Lecture 1' });
      const eduLink = makeEl('a', { href: 'https://www.youtube.com/watch?v=edu123', textContent: 'MIT Linear Algebra' });
      eduCard.appendChild(eduThumb);
      eduCard.appendChild(eduTitle);
      eduCard.appendChild(eduLink);

      body.appendChild(masthead);
      body.appendChild(shortCard);
      body.appendChild(eduCard);
      body.appendChild(player);
      body.appendChild(videoEl);

      const fakeDoc = {
        head,
        body,
        documentElement,
        title: 'Angry Birds 3 Official Trailer 2 - YouTube',
        createElement: (t) => makeEl(t),
        getElementById(id) { return findById(documentElement, id); },
        addEventListener(evt, fn) { docListeners.push({ evt, fn }); },
        querySelector(sel) {
          if (sel.includes('#above-the-fold')) return watchTitle;
          if (sel.includes('#channel-name')) return watchChannel;
          if (sel.includes('#player')) return player;
          if (sel.includes('#masthead-container')) return masthead;
          return null;
        },
        querySelectorAll(sel) {
          if (sel === 'video') return [videoEl];
          if (sel.includes('ytm-shorts-lockup-view-model-v2')) return [shortCard, eduCard];
          if (sel.includes('[data-rusty-shorts-nav')) return [];
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
        addEventListener(evt, fn) { winListeners.push({ evt, fn }); }
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
        Object,
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

      // 2) Verify Short card is NOT display:none hidden, HAS data-rusty-blurred='shorts' & crisp .rusty-blur-badge; Edu card stays unblurred
      assert.equal(shortCard.dataset.rustyBlurred, 'shorts', 'Blurred Short card instead of hiding');
      assert.notEqual(shortCard.style.display, 'none', 'Short card remains visible in layout with blurred thumbnail');
      assert.equal(findByClass(shortCard, 'rusty-blur-badge').length, 1, 'Rendered overlay pill badge on blurred Short');
      assert.equal(eduCard.dataset.rustyBlurred, undefined, 'Educational card remains sharp and unblurred');
      assert.equal(eduCard.dataset.rustyCategory, 'educational', 'Educational card classified as educational');

      // 3) Verify clicking the blurred Short intercepts navigation & opens "You are leaving Focus Mode" warning modal
      const clickHandler = winListeners.find((l) => l.evt === 'click');
      assert.ok(clickHandler, 'Registered window capture click handler');
      let prevented = false;
      let stopped = false;
      clickHandler.fn({
        target: shortLink,
        preventDefault() { prevented = true; },
        stopPropagation() { stopped = true; },
        stopImmediatePropagation() {}
      });
      assert.ok(prevented && stopped, 'Prevented direct navigation when clicking blurred Short');
      const modal = findById(documentElement, 'rusty-yt-leave-warning');
      assert.ok(modal, 'Rendered #rusty-yt-leave-warning modal');

      function collectText(node) {
        if (!node) return '';
        return (node.textContent || '') + ' ' + (node.children || []).map(collectText).join(' ');
      }
      assert.ok(collectText(modal).includes('You are leaving Focus Mode'), 'Warning modal says "You are leaving Focus Mode"');

      // 4) Clicking "Stay in Focus Mode" closes modal and keeps Focus Mode ON
      const stayBtn = findById(modal, 'btn-rusty-stay-focus');
      assert.ok(stayBtn, 'Stay button exists');
      stayBtn.listeners.get('click')({ preventDefault() {}, stopPropagation() {} });
      assert.equal(findById(documentElement, 'rusty-yt-leave-warning'), null, 'Stay button closes warning modal');
      assert.equal(fakeWin.__RUSTY_FOCUS_STATE__.is_active, true, 'Focus Mode stays active');

      // 5) Re-open via middle/Ctrl hook & check untrusted vs trusted Leave click
      const intercepted = fakeWin.__rustyShouldInterceptFocusClick({ target: shortLink }, shortLink);
      assert.equal(intercepted, true, '__rustyShouldInterceptFocusClick blocks Ctrl/middle-click too');
      const leaveModal = findById(documentElement, 'rusty-yt-leave-warning');
      const leaveBtn = findById(leaveModal, 'btn-rusty-leave-focus');
      // Untrusted click MUST NOT send stop_focus
      leaveBtn.listeners.get('click')({ isTrusted: false, preventDefault() {}, stopPropagation() {} });
      assert.equal(ipcSent.some((m) => m.action === 'stop_focus'), false, 'Rejects untrusted Leave click');

      // Trusted click closes modal, clears blurs, and sends stop_focus IPC
      leaveBtn.listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
      assert.ok(ipcSent.some((m) => m.action === 'stop_focus'), 'Trusted Leave click sends stop_focus IPC');
      assert.equal(shortCard.dataset.rustyBlurred, undefined, 'Unblurs cards when leaving Focus Mode');

      // 6) Re-enable Focus Mode and verify Watch Red Warning Gate & evaluator
      fakeWin.__rustyOnFocusState({ state: { is_active: true, is_paused: false, mode: 'Study' } });
      const gate = findById(documentElement, 'rusty-yt-watch-gate');
      assert.ok(gate, 'Created #rusty-yt-watch-gate without throwing TrustedHTML error');
      assert.ok(videoEl.paused && videoEl.pauseCalled > 0, 'Paused blocked video playback');
      const gateText = collectText(gate);
      assert.ok(gateText.includes('You are leaving Focus Mode!'), 'Shows leaving focus warning');
      assert.ok(gateText.includes('Focus on Your Studies & Work!'), 'Shows focus on studies/work message');

      const evalFn = fakeWin.__rustyFocusEvaluate;
      assert.equal(evalFn('Bairan - Animated Love Story | Banjaare (Official Video)', '/watch?v=1', 'Banjaare').allowed, false);
      assert.equal(evalFn('Hansika 4K 60FPS | UHD HUNTER', '/watch?v=2', 'UHD HUNTERYT').allowed, false);
      assert.equal(evalFn('Hi Me In 10 Years', '/watch?v=3', 'MrBeast').allowed, false);
      assert.equal(evalFn('Funny Skit Try Not To Laugh Reaction', '/watch?v=4', 'ComedyChannel').allowed, false);
      assert.equal(evalFn('Official Dance Video Choreography', '/watch?v=5', 'T-Series').allowed, false);
      assert.equal(evalFn('Official Movie Trailer 2 (2026)', '/watch?v=6', 'Studio').allowed, false);
      assert.equal(evalFn('Minecraft Survival Gameplay Walkthrough', '/watch?v=7', 'Gamer').allowed, false);
      assert.equal(evalFn('Any Short Clip', '/shorts/xyz999', 'Creator').allowed, false);

      assert.equal(evalFn('MIT OpenCourseWare Calculus Lecture 1', '/watch?v=10', 'MIT OpenCourseWare').allowed, true);
      assert.equal(evalFn('Rust Programming Tutorial: Ownership and Borrowing', '/watch?v=11', 'DevChannel').allowed, true);
      assert.equal(evalFn('Stock Market & Personal Finance Investing Basics', '/watch?v=12', 'FinanceEd').allowed, true);
      assert.equal(evalFn('Essence of Linear Algebra', '/watch?v=13', '3Blue1Brown').allowed, true);
      assert.equal(evalFn('10th Physics Chapter 1 One Shot Revision', '/watch?v=14', 'Disha Online Classes').allowed, true);

      // 7) Turning Focus Mode OFF removes red warning gate, banner, and blurred badges cleanly
      fakeWin.__rustyOnFocusState({ state: { is_active: false, is_paused: false, mode: 'Study' } });
      assert.equal(findById(documentElement, 'rusty-yt-watch-gate'), null, 'Removes watch gate when Focus Mode stops');
      assert.equal(findById(documentElement, 'rusty-yt-focus-banner'), null, 'Removes focus banner when Focus Mode stops');
      assert.equal(findByClass(shortCard, 'rusty-blur-badge').length, 0, 'Removes blur badges when Focus Mode stops');
    });
  });

});
