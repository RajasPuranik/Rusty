/**
 * YouTube Focus & Study Filter Script for Rusty Browser.
 *
 * Injected on YouTube pages during active Focus Sessions:
 * - Hides Shorts shelves, guide links, and buttons
 * - Intercepts SPA history (pushState/replaceState) to redirect /shorts/:id -> /watch?v=:id
 * - Hides gaming videos across all feeds, search results, and recommendations
 * - Only shows videos tagged with Educational or Finance topics / keywords
 * - Hides comments and distracting sidebar recommendations on watch pages
 * - Blocks and pauses watch page if the video is gaming or non-educational/non-finance
 */

(function () {
  'use strict';

  // Only run on YouTube domains
  if (typeof window === 'undefined' || !window.location || !window.location.hostname.includes('youtube.com')) {
    return;
  }

  // 1. Focus State Management
  let focusState = window.__RUSTY_FOCUS_STATE__ || null;

  function isFocusActive() {
    return Boolean(focusState && focusState.is_active && !focusState.is_paused);
  }

  // 2. Keyword Dictionaries for Classification
  const GAMING_KEYWORDS = [
    'gaming', 'gameplay', 'walkthrough', 'playthrough', "let's play", 'lets play',
    'gamer', 'twitch', 'esports', 'e-sports', 'speedrun', 'speed runner',
    'roblox', 'minecraft', 'gta', 'grand theft auto', 'fortnite', 'valorant',
    'call of duty', 'warzone', 'pubg', 'apex legends', 'league of legends',
    'dota', 'counter-strike', 'csgo', 'cs2', 'overwatch', 'pokemon', 'pokémon',
    'zelda', 'mario', 'elden ring', 'dark souls', 'genshin', 'fifa', 'fc 24',
    'fc 25', 'nba 2k', 'clash royale', 'clash of clans', 'brawl stars', 'free fire',
    'assassin\'s creed', 'cyberpunk 2077', 'witcher', 'playstation', 'xbox',
    'nintendo', 'nintendo switch', 'ps5', 'steam game', 'video game', 'videogame',
    'rpg', 'fps game', 'multiplayer game', 'mobile game', 'game trailer', 'boss fight',
    'modded', 'unreal engine gameplay', 'sims', 'destiny 2', 'honkai', 'honkai star rail'
  ];

  const EDUCATIONAL_KEYWORDS = [
    'education', 'educational', 'lecture', 'tutorial', 'course', 'physics',
    'math', 'mathematics', 'calculus', 'algebra', 'geometry', 'computer science',
    'programming', 'coding', 'developer', 'software engineer', 'software development',
    'python', 'rust', 'c++', 'javascript', 'typescript', 'react', 'html', 'css',
    'web development', 'backend', 'frontend', 'fullstack', 'ai', 'artificial intelligence',
    'machine learning', 'deep learning', 'data science', 'neural network', 'algorithm',
    'data structures', 'leetcode', 'system design', 'study', 'exam', 'revision',
    'documentation', 'biology', 'chemistry', 'science', 'scientific', 'history',
    'historical', 'geography', 'astronomy', 'astrophysics', 'quantum', 'neuroscience',
    'mit', 'stanford', 'harvard', 'nptel', 'khan academy', 'crashcourse',
    '3blue1brown', 'veritasium', 'freecodecamp', 'mit opencourseware', 'computerphile',
    'numberphile', 'ted', 'ted-ed', 'how to', 'learn', 'lesson', 'explained',
    'analysis', 'guide', 'school', 'college', 'university', 'phd', 'research',
    'paper', 'thesis', 'academics', 'biomedical', 'biotechnology', 'engineering',
    'statistics', 'linear algebra', 'microbiology', 'organic chemistry', 'sociology',
    'philosophy', 'psychology', 'linguistics', 'crash course', 'documentary',
    'ted talk', 'deep dive', 'how it works', 'academic'
  ];

  const FINANCE_KEYWORDS = [
    'finance', 'financial', 'money', 'invest', 'investing', 'investment',
    'stock market', 'stocks', 'wall street', 'economy', 'economic', 'economics',
    'personal finance', 'budget', 'budgeting', 'accounting', 'tax', 'taxes',
    'banking', 'wealth', 'real estate', 'crypto', 'cryptocurrency', 'bitcoin',
    'ethereum', 'trading', 'trader', 'valuation', 'mutual funds', 'index fund',
    'etf', 's&p 500', 'dividend', 'dividends', 'portfolio', 'warren buffett',
    'charlie munger', 'macroeconomics', 'microeconomics', 'cfa', 'ca', 'cpa',
    'venture capital', 'fintech', 'cash flow', 'inflation', 'interest rate',
    'federal reserve', 'income', 'debt', 'savings', 'capital', 'business analysis',
    'revenue', 'profit', 'asset', 'liability', 'balance sheet', 'financial statement',
    'fundamental analysis', 'technical analysis', 'bear market', 'bull market',
    'market cap', 'hedge fund', 'private equity', 'roi', 'yield', 'financial literacy',
    'passive income', 'bogleheads', 'graham stephan', 'benjamin graham', 'peter lynch',
    'financial freedom', 'bonds', 'treasury', 'gdp', 'interest rates', 'compound interest'
  ];

  // 3. Classification Helper
  function matchKeyword(text, keyword) {
    if (keyword.length <= 4) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
      return regex.test(text);
    }
    return text.toLowerCase().includes(keyword.toLowerCase());
  }

  function evaluateVideo(text, links) {
    const t = (text || '').toLowerCase();
    const l = (links || '').toLowerCase();

    // Check Shorts first
    if (l.includes('/shorts/')) {
      return { allowed: false, reason: 'shorts' };
    }

    // Check Gaming first: any gaming reference -> block immediately
    let isGaming = l.includes('/gaming');
    if (!isGaming) {
      for (let i = 0; i < GAMING_KEYWORDS.length; i++) {
        if (matchKeyword(t, GAMING_KEYWORDS[i])) {
          isGaming = true;
          break;
        }
      }
    }

    if (isGaming) {
      return { allowed: false, reason: 'gaming' };
    }

    // Check Educational
    let isEducational = false;
    for (let i = 0; i < EDUCATIONAL_KEYWORDS.length; i++) {
      if (matchKeyword(t, EDUCATIONAL_KEYWORDS[i])) {
        isEducational = true;
        break;
      }
    }

    // Check Finance
    let isFinance = false;
    if (!isEducational) {
      for (let i = 0; i < FINANCE_KEYWORDS.length; i++) {
        if (matchKeyword(t, FINANCE_KEYWORDS[i])) {
          isFinance = true;
          break;
        }
      }
    }

    if (isEducational || isFinance) {
      return { allowed: true, category: isEducational ? 'educational' : 'finance' };
    }

    // Neither educational nor finance -> hidden in focus mode
    return { allowed: false, reason: 'unrelated' };
  }

  // 4. Inject Dynamic Focus & Shorts CSS Rules
  const STYLE_ID = 'rusty-youtube-focus-style';
  function updateFocusStylesheet() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      const target = document.head || document.documentElement || document.body;
      if (target) {
        target.appendChild(style);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          const t = document.head || document.documentElement || document.body;
          if (t && !document.getElementById(STYLE_ID)) t.appendChild(style);
        });
        return;
      }
    }

    const shortsCss = `
      /* Always hide YouTube Shorts shelves, carousels, cards & buttons */
      ytd-rich-section-renderer:has(ytd-rich-shelf-renderer),
      ytd-rich-section-renderer:has(ytd-reel-shelf-renderer),
      ytd-rich-section-renderer:has(a[href*="/shorts"]),
      ytd-rich-shelf-renderer,
      ytd-reel-shelf-renderer,
      ytd-rich-shelf-renderer[is-shorts],
      ytd-rich-item-renderer:has(a[href*="/shorts"]),
      ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model),
      ytd-video-renderer:has(a[href*="/shorts"]),
      ytd-grid-video-renderer:has(a[href*="/shorts"]),
      ytd-compact-video-renderer:has(a[href*="/shorts"]),
      yt-lockup-view-model:has(a[href*="/shorts"]),
      ytm-shorts-lockup-view-model,
      #shorts-container,
      ytd-reel-video-renderer,
      ytd-guide-entry-renderer:has(a[href*="/shorts"]),
      ytd-guide-entry-renderer:has(a[title="Shorts"]),
      ytd-guide-entry-renderer a[title="Shorts"],
      ytd-guide-entry-renderer a[href*="/shorts"],
      ytd-mini-guide-entry-renderer:has(a[href*="/shorts"]),
      ytd-mini-guide-entry-renderer:has([aria-label="Shorts"]),
      ytd-mini-guide-entry-renderer[aria-label="Shorts"],
      ytd-mini-guide-entry-renderer a[href*="/shorts"],
      a#endpoint[title="Shorts"],
      a[title="Shorts"],
      [data-rusty-shorts="true"] {
        display: none !important;
      }
    `;

    if (isFocusActive()) {
      style.textContent = shortsCss + `
        /* Hide comments section during focus */
        ytd-comments,
        #comments.ytd-watch-flexy {
          display: none !important;
        }

        /* Hide sidebar related video distractions */
        #related.ytd-watch-flexy,
        ytd-watch-next-secondary-results-renderer {
          display: none !important;
        }

        /* Hide gaming links, gaming chips and filtered items */
        ytd-guide-entry-renderer a[title="Gaming"],
        ytd-guide-entry-renderer a[href*="/gaming"],
        ytd-mini-guide-entry-renderer[aria-label="Gaming"],
        [data-rusty-hidden] {
          display: none !important;
        }

        /* Filter banner styling */
        #rusty-yt-focus-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95));
          color: #f1f5f9;
          border: 1px solid rgba(56, 189, 248, 0.35);
          border-radius: 12px;
          padding: 12px 18px;
          margin: 12px 24px;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          z-index: 9999;
        }

        /* Gate overlay over blocked watch video */
        #rusty-yt-watch-gate {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          min-height: 480px;
          background: rgba(10, 14, 26, 0.96);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #f8fafc;
          text-align: center;
          padding: 24px;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
      `;
    } else {
      style.textContent = shortsCss;
    }
  }

  // 5. Intercept client-side SPA navigation to redirect /shorts/:id
  function checkShortsRedirect() {
    const path = window.location.pathname;
    if (path.startsWith('/shorts/')) {
      const id = path.replace('/shorts/', '').split('/')[0].split('?')[0];
      if (id) {
        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
        console.log('[Rusty Focus] Redirecting YouTube Shorts to standard watch view:', watchUrl);
        window.location.replace(watchUrl);
      }
    }
  }

  // 6. Process Individual Video Cards
  function processCard(card) {
    // Check if this card is inside a Shorts shelf, or contains a shorts link or view model
    const isShortsCard = card.querySelector('a[href*="/shorts"]') ||
                         card.querySelector('ytm-shorts-lockup-view-model') ||
                         card.closest('ytd-rich-section-renderer:has(ytd-rich-shelf-renderer), ytd-rich-section-renderer:has(a[href*="/shorts"]), ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, [is-shorts]');
    if (isShortsCard) {
      card.style.setProperty('display', 'none', 'important');
      card.dataset.rustyHidden = 'shorts';
      return;
    }

    if (!isFocusActive()) {
      if (card.dataset.rustyHidden && card.dataset.rustyHidden !== 'shorts') {
        card.style.removeProperty('display');
        delete card.dataset.rustyHidden;
      }
      return;
    }

    const titleEl = card.querySelector('#video-title, #video-title-link, a#video-title, h3 a, .yt-lockup-metadata-view-model-wiz__title, yt-formatted-string[title]');
    const channelEl = card.querySelector('#channel-name, #byline, ytd-channel-name, .ytd-channel-name, .yt-lockup-metadata-view-model-wiz__byline');
    const descEl = card.querySelector('#description-text, .metadata-snippet-container, #metadata-line');
    const badgeEls = card.querySelectorAll('ytd-badge-supported-renderer, .badge, [aria-label]');

    let title = titleEl ? (titleEl.textContent || titleEl.getAttribute('title') || '') : '';
    let channel = channelEl ? channelEl.textContent : '';
    let desc = descEl ? descEl.textContent : '';
    let badges = '';
    badgeEls.forEach((b) => {
      badges += ' ' + b.textContent + ' ' + (b.getAttribute('aria-label') || '');
    });

    const links = Array.from(card.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') || '')
      .join(' ');
    let combinedText = `${title} ${channel} ${desc} ${badges}`.trim();
    if (!combinedText) {
      combinedText = (card.textContent || '').trim();
    }

    // If card title is not yet populated by YouTube's custom element, wait for child DOM mutation
    if (!combinedText) {
      return;
    }

    const evaluation = evaluateVideo(combinedText, links);
    if (evaluation.allowed) {
      card.style.removeProperty('display');
      delete card.dataset.rustyHidden;
      card.dataset.rustyCategory = evaluation.category;
    } else {
      card.style.setProperty('display', 'none', 'important');
      card.dataset.rustyHidden = evaluation.reason;
    }
  }

  // 7. Filter All Cards Across Feeds and Search
  const VIDEO_CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-renderer',
    'ytd-radio-renderer',
    'yt-lockup-view-model'
  ].join(', ');

  function blockShortsElements() {
    // Hide any section or shelf that contains a /shorts/ link or header "Shorts"
    document.querySelectorAll('ytd-rich-section-renderer, ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytm-shorts-lockup-view-model, ytd-reel-video-renderer').forEach((el) => {
      const hasShorts = el.querySelector('a[href*="/shorts"]') ||
                        el.querySelector('[is-shorts]') ||
                        el.querySelector('ytm-shorts-lockup-view-model') ||
                        el.matches('ytd-reel-shelf-renderer, [is-shorts], ytm-shorts-lockup-view-model') ||
                        (el.textContent || '').toLowerCase().includes('shorts');
      if (hasShorts) {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-rusty-shorts', 'true');
      }
    });

    // Hide sidebar and mini-guide shorts buttons
    document.querySelectorAll('ytd-guide-entry-renderer a[href*="/shorts"], ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer a[href*="/shorts"], ytd-mini-guide-entry-renderer:has([aria-label="Shorts"]), a#endpoint[title="Shorts"], a[title="Shorts"]').forEach((a) => {
      const entry = a.closest('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer') || a;
      entry.style.setProperty('display', 'none', 'important');
    });

    // Hide standalone cards that link to /shorts/
    document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model').forEach((card) => {
      if (card.querySelector('a[href*="/shorts"]') || card.querySelector('ytm-shorts-lockup-view-model')) {
        card.style.setProperty('display', 'none', 'important');
        card.setAttribute('data-rusty-shorts', 'true');
      }
    });
  }

  function applyFocusFilters() {
    updateFocusStylesheet();
    blockShortsElements();
    checkShortsRedirect();

    const active = isFocusActive();
    // Filter chip cloud
    document.querySelectorAll('yt-chip-cloud-chip-renderer').forEach((chip) => {
      const text = (chip.textContent || '').toLowerCase().trim();
      if (active && (text.includes('gaming') || text.includes('game') || text.includes('games'))) {
        chip.style.setProperty('display', 'none', 'important');
      } else if (!active && chip.style.display === 'none') {
        chip.style.removeProperty('display');
      }
    });

    const cards = document.querySelectorAll(VIDEO_CARD_SELECTORS);
    for (let i = 0; i < cards.length; i++) {
      processCard(cards[i]);
    }

    checkWatchPageGate();
    ensureFocusBanner();
  }

  // 8. Watch Page Enforcement (/watch?v=...)
  function checkWatchPageGate() {
    const isWatch = window.location.pathname === '/watch';
    const playerContainer = document.querySelector('#player, ytd-player, #movie_player');
    const existingGate = document.getElementById('rusty-yt-watch-gate');

    if (!isWatch || !isFocusActive()) {
      if (existingGate) existingGate.remove();
      return;
    }

    // Extract current video metadata
    const titleEl = document.querySelector('#title h1, ytd-watch-metadata #title, meta[name="title"]');
    const channelEl = document.querySelector('ytd-watch-metadata #owner, #upload-info #channel-name, ytd-channel-name');
    const titleText = (titleEl ? titleEl.textContent || titleEl.getAttribute('content') : '') || document.title || '';
    const channelText = channelEl ? channelEl.textContent : '';

    if (!titleText.trim()) return;

    const evaluation = evaluateVideo(`${titleText} ${channelText}`, window.location.href);

    if (!evaluation.allowed) {
      // Pause playback
      const video = document.querySelector('video');
      if (video && !video.paused) {
        try { video.pause(); } catch (_) {}
      }

      if (!existingGate && playerContainer) {
        const gate = document.createElement('div');
        gate.id = 'rusty-yt-watch-gate';
        gate.innerHTML = `
          <div style="max-width: 520px; text-align: center;">
            <div style="font-size: 38px; margin-bottom: 12px;">🎯</div>
            <h2 style="font-size: 20px; font-weight: 700; color: #f8fafc; margin: 0 0 8px 0;">Rusty Focus Mode Active</h2>
            <p style="font-size: 14px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0;">
              This video is blocked because it is tagged as <strong>${evaluation.reason === 'gaming' ? 'Gaming' : 'Non-Educational / Non-Finance'}</strong> while Focus Mode is on.
            </p>
            <div style="display: flex; gap: 12px; justify-content: center;">
              <button id="btn-rusty-gate-search" style="padding: 10px 18px; border-radius: 8px; background: #0284c7; color: #ffffff; border: none; font-weight: 600; cursor: pointer;">
                Search Educational & Finance
              </button>
              <button id="btn-rusty-gate-back" style="padding: 10px 18px; border-radius: 8px; background: #334155; color: #f1f5f9; border: none; font-weight: 600; cursor: pointer;">
                Return Home
              </button>
            </div>
          </div>
        `;
        playerContainer.style.position = 'relative';
        playerContainer.appendChild(gate);

        const btnSearch = gate.querySelector('#btn-rusty-gate-search');
        if (btnSearch) {
          btnSearch.onclick = () => {
            const searchInput = document.querySelector('input#search');
            if (searchInput) {
              searchInput.focus();
              searchInput.value = 'calculus lecture';
            }
          };
        }
        const btnBack = gate.querySelector('#btn-rusty-gate-back');
        if (btnBack) {
          btnBack.onclick = () => {
            window.location.href = 'https://www.youtube.com/';
          };
        }
      }
    } else {
      if (existingGate) existingGate.remove();
    }
  }

  // 9. Banner indicator on YouTube
  function ensureFocusBanner() {
    const existingBanner = document.getElementById('rusty-yt-focus-banner');
    if (!isFocusActive()) {
      if (existingBanner) existingBanner.remove();
      return;
    }

    const masthead = document.querySelector('#masthead-container, #header');
    if (!existingBanner && masthead && masthead.parentNode) {
      const banner = document.createElement('div');
      banner.id = 'rusty-yt-focus-banner';
      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 16px;">🎯</span>
          <span><strong>Focus Mode Active:</strong> Gaming videos are hidden. Showing only <strong>Educational</strong> &amp; <strong>Finance</strong> content.</span>
        </div>
      `;
      masthead.parentNode.insertBefore(banner, masthead.nextSibling);
    }
  }

  // 10. Real-time Focus State Receiver from Rust Backend
  window.__rustyOnFocusState = function (msg) {
    if (!msg || typeof msg !== 'object') return;
    const newState = msg.state || msg;
    if (newState && typeof newState.is_active === 'boolean') {
      focusState = newState;
      applyFocusFilters();
    }
  };

  // 11. Hook SPA Navigation & History Transitions
  const origPush = history.pushState;
  history.pushState = function () {
    const res = origPush.apply(this, arguments);
    setTimeout(applyFocusFilters, 50);
    return res;
  };

  const origReplace = history.replaceState;
  history.replaceState = function () {
    const res = origReplace.apply(this, arguments);
    setTimeout(applyFocusFilters, 50);
    return res;
  };

  window.addEventListener('popstate', () => setTimeout(applyFocusFilters, 50));
  window.addEventListener('yt-navigate-finish', () => setTimeout(applyFocusFilters, 50));
  window.addEventListener('yt-page-data-updated', () => setTimeout(applyFocusFilters, 50));

  // 12. MutationObserver for dynamic infinite scroll cards
  let debounceTimeout = 0;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) return;
    debounceTimeout = setTimeout(() => {
      debounceTimeout = 0;
      applyFocusFilters();
    }, 120);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Initial scan and safety interval
  applyFocusFilters();
  setInterval(applyFocusFilters, 600);
})();
