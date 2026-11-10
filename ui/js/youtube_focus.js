/**
 * YouTube Focus & Study Filter Script for Rusty Browser.
 *
 * Injected on YouTube pages and activates when Focus Mode is ON:
 * - Hides Shorts shelves, carousels, guide links, and buttons
 * - Intercepts SPA history (pushState/replaceState) to redirect /shorts/:id -> /watch?v=:id
 * - Hides gaming, skit, dance, movie trailer, music/entertainment, and non-educational videos
 * - Only allows videos matching Educational or Finance topics/channels
 * - Hides comments, non-educational filter chips, ads, and distracting sidebar recommendations
 * - Shows a prominent RED WARNING overlay on blocked watch pages telling the user to focus on studies/work
 * - Uses strict DOM element APIs (zero innerHTML) for YouTube Trusted Types CSP compatibility
 */

(function () {
  'use strict';

  // Only run on YouTube domains
  if (typeof window === 'undefined' || !window.location || !window.location.hostname.includes('youtube.com')) {
    return;
  }

  // 1. Focus State Management
  let focusState = window.__RUSTY_FOCUS_STATE__ || null;
  let lastSyncedFromBackend = false;
  let blockedWatchActive = false;
  let blockedReasonText = '';
  let lastBlockedCount = 0;

  function isFocusActive() {
    return Boolean(focusState && focusState.is_active && !focusState.is_paused);
  }

  function requestFocusStateSync() {
    try {
      if (window === window.top && window.ipc && typeof window.ipc.postMessage === 'function') {
        window.ipc.postMessage(JSON.stringify({ action: 'get_focus_state' }));
      }
    } catch (_) {}
  }

  // Request live focus state right away to avoid stale initial snapshot
  requestFocusStateSync();

  // 2. Keyword Dictionaries for Classification
  const GAMING_KEYWORDS = [
    'gaming', 'gameplay', 'walkthrough', 'playthrough', "let's play", 'lets play',
    'gamer', 'twitch', 'esports', 'e-sports', 'speedrun', 'speed runner',
    'roblox', 'minecraft', 'gta', 'grand theft auto', 'rockstar games', 'fortnite',
    'valorant', 'call of duty', 'warzone', 'pubg', 'bgmi', 'apex legends',
    'league of legends', 'dota', 'counter-strike', 'csgo', 'cs2', 'overwatch',
    'pokemon', 'pokémon', 'zelda', 'mario', 'elden ring', 'dark souls', 'genshin',
    'fifa', 'fc 24', 'fc 25', 'nba 2k', 'clash royale', 'clash of clans', 'brawl stars',
    'free fire', 'garena', "assassin's creed", 'cyberpunk 2077', 'witcher',
    'playstation', 'xbox', 'nintendo', 'nintendo switch', 'ps5', 'steam game',
    'video game', 'videogame', 'video game walkthroughs', 'life simulation games',
    'action-adventure games', 'minigame', 'rpg', 'fps game', 'multiplayer game',
    'mobile game', 'game trailer', 'boss fight', 'modded', 'unreal engine gameplay',
    'sims', 'destiny 2', 'honkai', 'honkai star rail', 'rust game', 'rust gameplay',
    'rust pvp', 'rust raid', 'rust survival', 'play rust', 'rusty game'
  ];

  const ENTERTAINMENT_KEYWORDS = [
    'official video', 'official music video', 'music video', 'lyric video', 'lyrics',
    'dance', 'dancing', 'dance-pop', 'choreography', 'pop music', 'indian pop music',
    'asian music', 'song', 'songs', 'remix', 'mashup', 'cover song', 'karaoke',
    'playlist station', 'jukebox', 'vevo', 't-series', 'dj mix', 'album', 'albums',
    'concert', 'movie trailer', 'official trailer', 'trailer', 'teaser', 'love story',
    'animated love story', 'short film', 'full movie', 'movie', 'movies', 'cinema',
    'tamil cinema', 'bollywood', 'tollywood', 'kollywood', 'box office', 'web series',
    'episode', 'thriller', 'thrillers', 'romance', 'romantic', 'cartoon', 'anime',
    'serial', 'soap opera', 'skit', 'skits', 'comedy', 'standup', 'stand-up',
    'stand up comedy', 'prank', 'pranks', 'challenge', 'mrbeast', 'mr beast', 'vlog',
    'vlogs', 'vlogger', 'asmr', 'mukbang', 'unboxing', 'haul', 'reaction', 'reacting',
    'try not to laugh', 'funny', 'meme', 'memes', 'roast', 'roasting', 'drama',
    'gossip', 'expose', 'exposed', 'grwm', 'get ready with me', 'makeup', 'fashion',
    'outfit', '4k 60fps', 'uhd hunter', 'uhd', 'shorts', 'tiktok', 'reels',
    'trending', 'viral', 'celebrity', 'diwali', 'festival', 'taarak mehta',
    'kapil sharma', 'bigg boss', 'reality show', 'highlights', 'ipl highlights',
    'bhavya gandhi'
  ];

  const CHANNEL_WHITELIST = [
    '3blue1brown', 'veritasium', 'mit opencourseware', 'khan academy',
    'freecodecamp', 'computerphile', 'numberphile', 'nptel', 'crashcourse',
    'ted-ed', 'kurzgesagt', 'fireship', 'neetcode', 'physics wallah',
    'unacademy', 'study iq', 'vedantu', 'patrickjmt', 'professor leonard',
    'organic chemistry tutor', 'ben eater', 'sebastian lague',
    'two minute papers', 'stanford online', 'harvard university', 'yale courses'
  ];

  const EDUCATIONAL_KEYWORDS = [
    'education', 'educational', 'lecture', 'lectures', 'tutorial', 'tutorials',
    'course', 'courses', 'physics', 'math', 'mathematics', 'calculus', 'algebra',
    'geometry', 'trigonometry', 'computer science', 'programming', 'coding',
    'developer', 'software engineer', 'software engineering', 'software development',
    'python', 'rust', 'rust programming', 'rust lang', 'rustlang', 'cargo', 'c++',
    'javascript', 'typescript', 'react.js', 'reactjs', 'html', 'css',
    'web development', 'backend', 'frontend', 'fullstack', 'artificial intelligence',
    'machine learning', 'deep learning', 'data science', 'neural network',
    'algorithm', 'algorithms', 'data structures', 'leetcode', 'system design',
    'operating system', 'compiler', 'database', 'sql', 'study', 'studying', 'exam',
    'exams', 'revision', 'documentation', 'biology', 'chemistry', 'science',
    'scientific', 'history', 'historical', 'geography', 'astronomy', 'astrophysics',
    'quantum', 'neuroscience', 'thermodynamics', 'mechanics', 'electromagnetism',
    'mit', 'stanford', 'harvard', 'nptel', 'khan academy', 'crashcourse',
    '3blue1brown', 'veritasium', 'freecodecamp', 'mit opencourseware',
    'computerphile', 'numberphile', 'ted-ed', 'crash course', 'documentary',
    'ted talk', 'explained', 'analysis', 'deep dive', 'how it works', 'academic',
    'academics', 'university', 'college', 'school', 'phd', 'research paper',
    'thesis', 'biomedical', 'biotechnology', 'engineering', 'statistics',
    'probability', 'linear algebra', 'microbiology', 'organic chemistry',
    'sociology', 'philosophy', 'psychology', 'linguistics', 'syllabus', 'ncert',
    'jee', 'neet', 'gate', 'upsc', 'oneshot', 'one shot'
  ];

  const FINANCE_KEYWORDS = [
    'finance', 'financial', 'invest', 'investing', 'investment', 'investments',
    'stock market', 'stocks', 'wall street', 'economy', 'economic', 'economics',
    'personal finance', 'budget', 'budgeting', 'accounting', 'tax', 'taxes',
    'taxation', 'banking', 'wealth management', 'real estate investing', 'crypto',
    'cryptocurrency', 'bitcoin', 'ethereum', 'trading', 'trader', 'valuation',
    'mutual funds', 'index fund', 'etf', 's&p 500', 'nifty', 'sensex',
    'dividend', 'dividends', 'portfolio', 'warren buffett', 'charlie munger',
    'macroeconomics', 'microeconomics', 'cfa', 'chartered accountant', 'ca inter',
    'ca foundation', 'ca final', 'cpa', 'venture capital', 'fintech', 'cash flow',
    'inflation', 'interest rate', 'interest rates', 'federal reserve', 'rbi',
    'balance sheet', 'financial statement', 'income statement',
    'fundamental analysis', 'technical analysis', 'bear market', 'bull market',
    'market cap', 'hedge fund', 'private equity', 'roi', 'yield',
    'financial literacy', 'passive income', 'bogleheads', 'graham stephan',
    'benjamin graham', 'peter lynch', 'financial freedom', 'treasury bonds', 'gdp',
    'compound interest', 'retirement planning'
  ];

  // Pre-compile word-boundary matchers once for speed and exactness
  // (prevents 'react' matching 'reaction', 'asset' matching 'cassette', 'invest' matching 'investigation', etc.)
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function compileMatchers(words) {
    return words.map((kw) => {
      const escaped = escapeRegex(kw.toLowerCase());
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
    });
  }

  const GAMING_MATCHERS = compileMatchers(GAMING_KEYWORDS);
  const ENTERTAINMENT_MATCHERS = compileMatchers(ENTERTAINMENT_KEYWORDS);
  const CHANNEL_WHITELIST_MATCHERS = compileMatchers(CHANNEL_WHITELIST);
  const EDUCATIONAL_MATCHERS = compileMatchers(EDUCATIONAL_KEYWORDS);
  const FINANCE_MATCHERS = compileMatchers(FINANCE_KEYWORDS);

  function matchesAny(text, matchers) {
    if (!text) return false;
    for (let i = 0; i < matchers.length; i++) {
      if (matchers[i].test(text)) {
        return true;
      }
    }
    return false;
  }

  // 3. Classification Helper
  function evaluateVideo(text, links, channelText) {
    const t = (text || '').toLowerCase();
    const l = (links || '').toLowerCase();
    const ch = (channelText || '').toLowerCase();

    // 1) Block Shorts immediately
    if (l.includes('/shorts')) {
      return { allowed: false, reason: 'shorts' };
    }

    // 2) Block Gaming first
    if (l.includes('/gaming') || matchesAny(t, GAMING_MATCHERS)) {
      return { allowed: false, reason: 'gaming' };
    }

    // 3) Allow trusted educational channels even if title mentions storytelling/animation
    if (ch && matchesAny(ch, CHANNEL_WHITELIST_MATCHERS)) {
      return { allowed: true, category: 'educational' };
    }

    // 4) Block Entertainment / Skits / Dance / Movie Trailers / Music / Vlogs / Pranks / Comedy
    if (matchesAny(t, ENTERTAINMENT_MATCHERS)) {
      return { allowed: false, reason: 'entertainment' };
    }

    // 5) Check Educational or Finance match
    if (matchesAny(t, EDUCATIONAL_MATCHERS)) {
      return { allowed: true, category: 'educational' };
    }
    if (matchesAny(t, FINANCE_MATCHERS)) {
      return { allowed: true, category: 'finance' };
    }

    // 6) Anything not clearly Educational or Finance -> hidden/blocked in Focus Mode
    return { allowed: false, reason: 'unrelated' };
  }

  // 4. Inject Dynamic Focus & Shorts CSS Rules (split rules so :has() never breaks simple rules)
  const STYLE_ID = 'rusty-youtube-focus-style';
  function getStyleContainer() {
    return document.head || document.documentElement || document.body;
  }

  function updateFocusStylesheet() {
    const active = isFocusActive();
    const earlyStyle = document.getElementById('rusty-early-shorts-hide');
    let style = document.getElementById(STYLE_ID);

    if (!active) {
      if (earlyStyle) earlyStyle.remove();
      if (style) style.textContent = '';
      return;
    }

    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      const target = getStyleContainer();
      if (target) {
        target.appendChild(style);
      } else {
        return;
      }
    } else if (document.head && style.parentNode !== document.head) {
      document.head.appendChild(style);
    }

    // Separate rule blocks so an unsupported selector never invalidates valid rules
    const cssBlocks = [
      // Plain Shorts element selectors (no :has())
      `ytd-rich-shelf-renderer[is-shorts],
       ytd-reel-shelf-renderer,
       ytm-shorts-lockup-view-model,
       ytm-shorts-lockup-view-model-v2,
       #shorts-container,
       ytd-reel-video-renderer,
       a#endpoint[title="Shorts"],
       a[title="Shorts"],
       ytd-guide-entry-renderer a[title="Shorts"],
       ytd-guide-entry-renderer a[href*="/shorts"],
       ytd-mini-guide-entry-renderer[aria-label="Shorts"],
       ytd-mini-guide-entry-renderer a[href*="/shorts"],
       [data-rusty-shorts="true"] {
         display: none !important;
       }`,

      // Individual :has() Shorts container selectors (one per rule block)
      `ytd-rich-section-renderer:has(ytd-reel-shelf-renderer) { display: none !important; }`,
      `ytd-rich-section-renderer:has(ytd-rich-shelf-renderer) { display: none !important; }`,
      `ytd-rich-section-renderer:has(a[href*="/shorts"]) { display: none !important; }`,
      `grid-shelf-view-model:has(a[href*="/shorts"]) { display: none !important; }`,
      `grid-shelf-view-model:has(ytm-shorts-lockup-view-model) { display: none !important; }`,
      `grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2) { display: none !important; }`,
      `ytd-rich-item-renderer:has(a[href*="/shorts"]) { display: none !important; }`,
      `ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model) { display: none !important; }`,
      `ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model-v2) { display: none !important; }`,
      `ytd-video-renderer:has(a[href*="/shorts"]) { display: none !important; }`,
      `ytd-grid-video-renderer:has(a[href*="/shorts"]) { display: none !important; }`,
      `ytd-compact-video-renderer:has(a[href*="/shorts"]) { display: none !important; }`,
      `yt-lockup-view-model:has(a[href*="/shorts"]) { display: none !important; }`,
      `ytd-guide-entry-renderer:has(a[title="Shorts"]) { display: none !important; }`,
      `ytd-guide-entry-renderer:has(a[href*="/shorts"]) { display: none !important; }`,
      `ytd-mini-guide-entry-renderer:has([aria-label="Shorts"]) { display: none !important; }`,
      `ytd-mini-guide-entry-renderer:has(a[href*="/shorts"]) { display: none !important; }`,

      // Hide Comments during focus
      `ytd-comments,
       #comments.ytd-watch-flexy {
         display: none !important;
       }`,

      // Hide sidebar related video distractions during focus
      `#related.ytd-watch-flexy,
       ytd-watch-next-secondary-results-renderer {
         display: none !important;
       }`,

      // Hide Gaming & Ad clutter
      `ytd-guide-entry-renderer a[title="Gaming"],
       ytd-guide-entry-renderer a[href*="/gaming"],
       ytd-mini-guide-entry-renderer[aria-label="Gaming"],
       ytd-ad-slot-renderer,
       ytd-in-feed-ad-layout-renderer,
       [data-rusty-hidden],
       [data-rusty-chip-hidden],
       [data-rusty-row-hidden] {
         display: none !important;
       }`,
      `ytd-rich-item-renderer:has(ytd-ad-slot-renderer) { display: none !important; }`,

      // Focus banner & Red Warning gate base CSS
      `#rusty-yt-focus-banner {
         display: flex;
         flex-wrap: wrap;
         align-items: center;
         justify-content: space-between;
         gap: 10px;
         background: linear-gradient(135deg, rgba(30, 41, 59, 0.96), rgba(15, 23, 42, 0.96));
         color: #f1f5f9;
         border: 1px solid rgba(56, 189, 248, 0.45);
         border-radius: 12px;
         padding: 12px 18px;
         margin: 12px 24px;
         box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         font-size: 13px;
         z-index: 9999;
         position: relative;
       }`,
      `#rusty-yt-watch-gate {
         position: absolute;
         top: 0;
         left: 0;
         width: 100%;
         height: 100%;
         min-height: 460px;
         background: linear-gradient(135deg, rgba(69, 10, 10, 0.97), rgba(20, 4, 8, 0.98));
         border: 2px solid #ef4444;
         box-shadow: inset 0 0 80px rgba(239, 68, 68, 0.32), 0 0 36px rgba(220, 38, 38, 0.45);
         backdrop-filter: blur(18px);
         -webkit-backdrop-filter: blur(18px);
         z-index: 2500;
         display: flex;
         flex-direction: column;
         align-items: center;
         justify-content: center;
         color: #fef2f2;
         text-align: center;
         padding: 28px;
         box-sizing: border-box;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         border-radius: 12px;
       }`
    ];

    style.textContent = cssBlocks.join('\n');
  }

  // 5. Intercept client-side SPA navigation to redirect /shorts/:id during Focus Mode
  function checkShortsRedirect() {
    if (!isFocusActive()) return;
    const path = window.location.pathname;
    if (path.startsWith('/shorts/')) {
      const id = path.replace('/shorts/', '').split('/')[0].split('?')[0];
      if (id) {
        const watchUrl = `https://www.youtube.com/watch?v=${id}&rusty_short=1`;
        window.location.replace(watchUrl);
      }
    }
  }

  // 6. Process Individual Video Cards
  const VIDEO_CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-renderer',
    'ytd-radio-renderer',
    'yt-lockup-view-model',
    'ytd-ad-slot-renderer'
  ].join(', ');

  function extractCardData(card) {
    const titleEl = card.querySelector(
      '#video-title, #video-title-link, a#video-title, ' +
      '.yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, ' +
      'h3 a, h3, yt-formatted-string[title]'
    );
    const channelEl = card.querySelector(
      '#channel-name, #byline, ytd-channel-name, .ytd-channel-name, ' +
      '.yt-lockup-metadata-view-model__metadata, .yt-lockup-metadata-view-model-wiz__byline, ' +
      'yt-content-metadata-view-model'
    );
    const descEl = card.querySelector('#description-text, .metadata-snippet-container, #metadata-line');
    const badgeEls = card.querySelectorAll('ytd-badge-supported-renderer, .badge, badge-shape, [aria-label]');

    let title = '';
    if (titleEl) {
      title = titleEl.textContent || titleEl.getAttribute('title') || titleEl.getAttribute('aria-label') || '';
    }
    const channel = channelEl ? (channelEl.textContent || '') : '';
    const desc = descEl ? (descEl.textContent || '') : '';
    let badges = '';
    badgeEls.forEach((b) => {
      badges += ' ' + (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '');
    });

    const links = Array.from(card.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') || '')
      .join(' ');

    let combinedText = `${title} ${channel} ${desc} ${badges}`.trim();
    if (!combinedText) {
      combinedText = (card.textContent || '').trim();
    }

    return { combinedText, links, channel };
  }

  function processCard(card) {
    const active = isFocusActive();

    if (!active) {
      if (card.dataset.rustyHidden) {
        card.style.removeProperty('display');
        delete card.dataset.rustyHidden;
      }
      if (card.dataset.rustyShorts) {
        card.style.removeProperty('display');
        delete card.dataset.rustyShorts;
      }
      delete card.dataset.rustyCategory;
      return true;
    }

    // Always block ads during Focus Mode
    if (card.matches('ytd-ad-slot-renderer') || card.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')) {
      card.style.setProperty('display', 'none', 'important');
      card.dataset.rustyHidden = 'ad';
      return false;
    }

    // Check if Shorts card
    const isShortsCard = Boolean(
      card.querySelector('a[href*="/shorts"], ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2') ||
      card.closest('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, grid-shelf-view-model, [is-shorts]')
    );
    if (isShortsCard) {
      card.style.setProperty('display', 'none', 'important');
      card.dataset.rustyHidden = 'shorts';
      card.dataset.rustyShorts = 'true';
      return false;
    }

    const { combinedText, links, channel } = extractCardData(card);
    if (!combinedText) {
      return true; // Wait for YouTube custom element to populate
    }

    const evaluation = evaluateVideo(combinedText, links, channel);
    if (evaluation.allowed) {
      card.style.removeProperty('display');
      delete card.dataset.rustyHidden;
      delete card.dataset.rustyShorts;
      card.dataset.rustyCategory = evaluation.category;
      return true;
    } else {
      card.style.setProperty('display', 'none', 'important');
      card.dataset.rustyHidden = evaluation.reason;
      return false;
    }
  }

  // 7. Block Shorts Shelves, Carousels & Distraction Sidebar Items (when Focus Mode is active)
  const BLOCKED_SIDEBAR_TITLES = new Set([
    'shorts', 'gaming', 'movies & tv', 'movies', 'music', 'sports', 'fashion & beauty', 'podcasts'
  ]);

  function blockShortsElements() {
    const active = isFocusActive();

    if (!active) {
      document.querySelectorAll('[data-rusty-shorts="true"]').forEach((el) => {
        el.style.removeProperty('display');
        el.removeAttribute('data-rusty-shorts');
      });
      document.querySelectorAll('ytd-guide-entry-renderer[data-rusty-hidden], ytd-mini-guide-entry-renderer[data-rusty-hidden]').forEach((el) => {
        el.style.removeProperty('display');
        el.removeAttribute('data-rusty-hidden');
      });
      return;
    }

    // Hide Shorts shelves/carousels
    document.querySelectorAll(
      'ytd-rich-section-renderer, ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ' +
      'grid-shelf-view-model, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-video-renderer'
    ).forEach((el) => {
      const titleEl = el.querySelector('#title-text, #title, h2, span');
      const titleText = titleEl ? (titleEl.textContent || '').trim().toLowerCase() : '';
      const hasShorts = Boolean(
        el.querySelector('a[href*="/shorts"]') ||
        el.querySelector('[is-shorts]') ||
        el.querySelector('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2') ||
        el.matches('ytd-reel-shelf-renderer, [is-shorts], ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-video-renderer') ||
        titleText === 'shorts'
      );
      if (hasShorts) {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-rusty-shorts', 'true');
      }
    });

    // Hide Shorts & distraction links in sidebar and mini-guide
    document.querySelectorAll('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer').forEach((entry) => {
      const a = entry.querySelector('a');
      const label = (
        (a && (a.getAttribute('title') || a.getAttribute('aria-label'))) ||
        entry.getAttribute('aria-label') ||
        entry.textContent ||
        ''
      ).trim().toLowerCase();
      const href = a ? (a.getAttribute('href') || '').toLowerCase() : '';
      if (label === 'shorts' || href.includes('/shorts')) {
        entry.style.setProperty('display', 'none', 'important');
        entry.setAttribute('data-rusty-shorts', 'true');
      } else if (BLOCKED_SIDEBAR_TITLES.has(label) || href.includes('/gaming')) {
        entry.style.setProperty('display', 'none', 'important');
        entry.setAttribute('data-rusty-hidden', 'sidebar');
      }
    });
  }

  function filterChips() {
    const active = isFocusActive();
    document.querySelectorAll('yt-chip-cloud-chip-renderer, chip-shape').forEach((chip) => {
      if (!active) {
        if (chip.dataset.rustyChipHidden) {
          chip.style.removeProperty('display');
          delete chip.dataset.rustyChipHidden;
        }
        return;
      }

      const text = (chip.textContent || '').toLowerCase().trim();
      if (!text) return;
      if (text === 'all') {
        chip.style.removeProperty('display');
        delete chip.dataset.rustyChipHidden;
        return;
      }

      const isEduOrFin =
        !matchesAny(text, GAMING_MATCHERS) &&
        !matchesAny(text, ENTERTAINMENT_MATCHERS) &&
        (matchesAny(text, EDUCATIONAL_MATCHERS) || matchesAny(text, FINANCE_MATCHERS));

      if (isEduOrFin) {
        chip.style.removeProperty('display');
        delete chip.dataset.rustyChipHidden;
      } else {
        chip.style.setProperty('display', 'none', 'important');
        chip.dataset.rustyChipHidden = 'true';
      }
    });
  }

  function cleanupEmptyRows() {
    const active = isFocusActive();
    document.querySelectorAll('ytd-rich-grid-row').forEach((row) => {
      if (!active) {
        if (row.dataset.rustyRowHidden) {
          row.style.removeProperty('display');
          delete row.dataset.rustyRowHidden;
        }
        return;
      }
      const items = row.querySelectorAll('ytd-rich-item-renderer');
      if (items.length === 0) return;
      let anyVisible = false;
      for (let i = 0; i < items.length; i++) {
        if (!items[i].dataset.rustyHidden) {
          anyVisible = true;
          break;
        }
      }
      if (!anyVisible) {
        row.style.setProperty('display', 'none', 'important');
        row.dataset.rustyRowHidden = 'true';
      } else if (row.dataset.rustyRowHidden) {
        row.style.removeProperty('display');
        delete row.dataset.rustyRowHidden;
      }
    });
  }

  function applyFocusFilters() {
    updateFocusStylesheet();
    checkShortsRedirect();
    blockShortsElements();
    filterChips();

    const cards = document.querySelectorAll(VIDEO_CARD_SELECTORS);
    let blockedCount = 0;
    let visibleCount = 0;

    for (let i = 0; i < cards.length; i++) {
      // Skip nested lockup if its parent rich-item is also matched
      if (cards[i].tagName.toLowerCase() === 'yt-lockup-view-model' && cards[i].closest('ytd-rich-item-renderer')) {
        continue;
      }
      const allowed = processCard(cards[i]);
      if (allowed) {
        visibleCount++;
      } else {
        blockedCount++;
      }
    }

    lastBlockedCount = blockedCount;
    cleanupEmptyRows();
    checkWatchPageGate();
    ensureFocusBanner(visibleCount, blockedCount);
  }

  // 8. Watch Page Enforcement (/watch?v=...) with RED WARNING Gate
  function enforcePausedVideo() {
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      if (!video.__rustyBlockPauseBound) {
        video.__rustyBlockPauseBound = true;
        const stopIfBlocked = () => {
          if (blockedWatchActive) {
            try { video.pause(); } catch (_) {}
          }
        };
        video.addEventListener('play', stopIfBlocked, true);
        video.addEventListener('playing', stopIfBlocked, true);
      }
      if (blockedWatchActive && !video.paused) {
        try { video.pause(); } catch (_) {}
      }
    });
  }

  function buildRedWatchGateDom(reasonLabel) {
    const gate = document.createElement('div');
    gate.id = 'rusty-yt-watch-gate';

    const box = document.createElement('div');
    box.style.cssText = 'max-width: 540px; text-align: center; display: flex; flex-direction: column; align-items: center;';

    const badge = document.createElement('div');
    badge.style.cssText = 'display: inline-block; padding: 5px 14px; border-radius: 999px; background: rgba(220, 38, 38, 0.25); border: 1px solid #ef4444; color: #fca5a5; font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 14px;';
    badge.textContent = '⚠️ Focus Mode Red Warning';

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size: 46px; line-height: 1; margin-bottom: 12px;';
    icon.textContent = '⛔';

    const heading = document.createElement('h2');
    heading.style.cssText = 'font-size: 24px; font-weight: 800; color: #fecaca; margin: 0 0 10px 0; line-height: 1.25;';
    heading.textContent = 'Focus on Your Studies & Work!';

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size: 15px; color: #fee2e2; line-height: 1.55; margin: 0 0 22px 0; opacity: 0.92;';
    desc.textContent = `This video is blocked during Focus Mode (${reasonLabel}). Only Educational & Finance content is permitted right now.`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;';

    const btnBack = document.createElement('button');
    btnBack.id = 'btn-rusty-gate-back';
    btnBack.type = 'button';
    btnBack.style.cssText = 'padding: 11px 20px; border-radius: 10px; background: #dc2626; color: #ffffff; border: 1px solid #f87171; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(220, 38, 38, 0.45);';
    btnBack.textContent = '← Return to YouTube Home';
    btnBack.addEventListener('click', () => {
      window.location.href = 'https://www.youtube.com/';
    });

    const btnSearch = document.createElement('button');
    btnSearch.id = 'btn-rusty-gate-search';
    btnSearch.type = 'button';
    btnSearch.style.cssText = 'padding: 11px 20px; border-radius: 10px; background: rgba(255, 255, 255, 0.12); color: #fef2f2; border: 1px solid rgba(248, 113, 113, 0.45); font-size: 14px; font-weight: 600; cursor: pointer;';
    btnSearch.textContent = 'Search Study & Finance Topics';
    btnSearch.addEventListener('click', () => {
      window.location.href = 'https://www.youtube.com/results?search_query=computer+science+lecture';
    });

    btnRow.appendChild(btnBack);
    btnRow.appendChild(btnSearch);

    box.appendChild(badge);
    box.appendChild(icon);
    box.appendChild(heading);
    box.appendChild(desc);
    box.appendChild(btnRow);
    gate.appendChild(box);
    return gate;
  }

  function getWatchReasonLabel(reason) {
    if (reason === 'shorts') return 'YouTube Short';
    if (reason === 'gaming') return 'Gaming Content';
    if (reason === 'entertainment') return 'Entertainment / Skit / Dance / Trailer';
    return 'Non-Educational / Non-Finance Content';
  }

  function checkWatchPageGate() {
    const isWatch = window.location.pathname === '/watch';
    const existingGate = document.getElementById('rusty-yt-watch-gate');

    if (!isWatch || !isFocusActive()) {
      blockedWatchActive = false;
      if (existingGate) existingGate.remove();
      return;
    }

    const params = new URLSearchParams(window.location.search || '');
    const wasRedirectedFromShort = params.get('rusty_short') === '1';
    const currentVideoId = params.get('v') || '';

    // Avoid reading stale DOM metadata while Polymer is still transitioning between videos
    const watchMetaEl = document.querySelector('ytd-watch-flexy[video-id], ytd-watch-metadata[video-id]');
    const metaVideoId = watchMetaEl ? (watchMetaEl.getAttribute('video-id') || '') : '';
    if (currentVideoId && metaVideoId && metaVideoId !== currentVideoId) {
      blockedWatchActive = true;
      enforcePausedVideo();
      return;
    }

    // Prefer live watch metadata DOM over static meta tag (which becomes stale during SPA nav)
    const titleEl = document.querySelector(
      '#above-the-fold #title h1 yt-formatted-string, ' +
      'ytd-watch-metadata #title h1, ' +
      'ytd-watch-metadata h1 yt-formatted-string, ' +
      '#title h1'
    );
    const channelEl = document.querySelector(
      'ytd-watch-metadata #owner #channel-name, ' +
      '#upload-info #channel-name, ' +
      'ytd-video-owner-renderer #channel-name'
    );
    const descEl = document.querySelector('ytd-watch-metadata #description-inline-expander, #description-inner');

    const domTitle = titleEl ? (titleEl.textContent || '').trim() : '';
    const pageTitle = (document.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
    const titleText = domTitle || (pageTitle.toLowerCase() !== 'youtube' ? pageTitle : '');
    const channelText = channelEl ? (channelEl.textContent || '').trim() : '';
    const descText = descEl ? (descEl.textContent || '').slice(0, 400).trim() : '';

    if (!titleText) {
      // Wait for title hydration while preventing unverified autoplay
      if (wasRedirectedFromShort) {
        blockedWatchActive = true;
        enforcePausedVideo();
      }
      return;
    }

    const evaluation = evaluateVideo(`${titleText} ${channelText} ${descText}`, window.location.href, channelText);
    const shouldBlock = !evaluation.allowed || (wasRedirectedFromShort && evaluation.reason);

    if (shouldBlock) {
      blockedWatchActive = true;
      enforcePausedVideo();

      const reasonLabel = getWatchReasonLabel(wasRedirectedFromShort && !evaluation.allowed ? 'shorts' : evaluation.reason);
      const playerContainer = document.querySelector('#player, ytd-player, #movie_player');
      const host = playerContainer || document.body;
      if (!host) return;

      if (existingGate && blockedReasonText === reasonLabel) {
        return;
      }
      if (existingGate) existingGate.remove();

      blockedReasonText = reasonLabel;
      const gate = buildRedWatchGateDom(reasonLabel);
      if (!playerContainer) {
        gate.style.position = 'fixed';
        gate.style.inset = '0';
      } else {
        playerContainer.style.position = 'relative';
      }
      host.appendChild(gate);
    } else {
      blockedWatchActive = false;
      blockedReasonText = '';
      if (existingGate) existingGate.remove();
    }
  }

  // 9. Banner indicator on YouTube (strictly built with createElement - zero innerHTML)
  function ensureFocusBanner(visibleCount, blockedCount) {
    const existingBanner = document.getElementById('rusty-yt-focus-banner');
    if (!isFocusActive()) {
      if (existingBanner) existingBanner.remove();
      return;
    }

    const masthead = document.querySelector('#masthead-container, #header, ytd-masthead');
    const mountParent = masthead && masthead.parentNode ? masthead.parentNode : document.body;
    if (!mountParent) return;

    let banner = existingBanner;
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'rusty-yt-focus-banner';

      const left = document.createElement('div');
      left.style.cssText = 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap;';

      const icon = document.createElement('span');
      icon.style.cssText = 'font-size: 16px;';
      icon.textContent = '🎯';

      const textSpan = document.createElement('span');
      textSpan.id = 'rusty-yt-focus-banner-text';
      left.appendChild(icon);
      left.appendChild(textSpan);

      const quickWrap = document.createElement('div');
      quickWrap.id = 'rusty-yt-focus-quick-topics';
      quickWrap.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-wrap: wrap;';

      const topics = [
        ['Physics & Math', 'https://www.youtube.com/results?search_query=physics+math+lecture'],
        ['Coding & CS', 'https://www.youtube.com/results?search_query=computer+science+programming+tutorial'],
        ['Finance & Investing', 'https://www.youtube.com/results?search_query=personal+finance+investing+course']
      ];
      topics.forEach(([label, href]) => {
        const pill = document.createElement('a');
        pill.href = href;
        pill.textContent = label;
        pill.style.cssText = 'padding: 4px 10px; border-radius: 999px; background: rgba(56, 189, 248, 0.16); border: 1px solid rgba(56, 189, 248, 0.4); color: #7dd3fc; text-decoration: none; font-size: 12px; font-weight: 600;';
        quickWrap.appendChild(pill);
      });

      banner.appendChild(left);
      banner.appendChild(quickWrap);

      if (masthead && masthead.parentNode) {
        masthead.parentNode.insertBefore(banner, masthead.nextSibling);
      } else {
        document.body.insertBefore(banner, document.body.firstChild);
      }
    }

    const textNode = banner.querySelector('#rusty-yt-focus-banner-text');
    if (textNode) {
      const modeName = focusState && focusState.mode ? focusState.mode : 'Study';
      if (window.location.pathname === '/' && visibleCount === 0 && blockedCount > 0) {
        textNode.textContent = `Focus Mode (${modeName}) Active: Blocked ${blockedCount} distracting videos & Shorts. Choose a study or finance topic ->`;
      } else if (blockedCount > 0) {
        textNode.textContent = `Focus Mode (${modeName}) Active: Hidden ${blockedCount} distracting/non-educational videos & Shorts.`;
      } else {
        textNode.textContent = `Focus Mode (${modeName}) Active: Shorts, Gaming & Entertainment blocked. Showing Educational & Finance only.`;
      }
    }
  }

  // Click capture guard: prevent opening a Shorts or blocked card before next scan cycle
  document.addEventListener('click', (e) => {
    if (!isFocusActive()) return;
    const anchor = e.target && typeof e.target.closest === 'function' ? e.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (href.includes('/shorts')) {
      e.preventDefault();
      e.stopPropagation();
      const id = href.split('/shorts/')[1] ? href.split('/shorts/')[1].split('/')[0].split('?')[0] : '';
      if (id) {
        window.location.href = `https://www.youtube.com/watch?v=${id}&rusty_short=1`;
      }
    }
  }, true);

  // 10. Real-time Focus State Receiver from Rust Backend
  window.__rustyOnFocusState = function (msg) {
    if (!msg || typeof msg !== 'object') return;
    const newState = msg.state || msg;
    if (newState && typeof newState.is_active === 'boolean') {
      focusState = newState;
      window.__RUSTY_FOCUS_STATE__ = newState;
      lastSyncedFromBackend = true;
      applyFocusFilters();
    }
  };
  window.__rustyFocusEvaluate = evaluateVideo;
  window.__rustyApplyFocusFilters = applyFocusFilters;

  // 11. Hook SPA Navigation & History Transitions
  const origPush = history.pushState;
  history.pushState = function () {
    const res = origPush.apply(this, arguments);
    blockedReasonText = '';
    setTimeout(applyFocusFilters, 40);
    return res;
  };

  const origReplace = history.replaceState;
  history.replaceState = function () {
    const res = origReplace.apply(this, arguments);
    blockedReasonText = '';
    setTimeout(applyFocusFilters, 40);
    return res;
  };

  window.addEventListener('popstate', () => {
    blockedReasonText = '';
    setTimeout(applyFocusFilters, 40);
  });
  window.addEventListener('yt-navigate-finish', () => {
    blockedReasonText = '';
    requestFocusStateSync();
    setTimeout(applyFocusFilters, 40);
  });
  window.addEventListener('yt-page-data-updated', () => {
    setTimeout(applyFocusFilters, 40);
  });

  // 12. MutationObserver for dynamic infinite scroll cards & Polymer hydration
  let debounceTimeout = 0;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) return;
    debounceTimeout = setTimeout(() => {
      debounceTimeout = 0;
      applyFocusFilters();
    }, 100);
  });

  function startObserver() {
    const root = document.body || document.documentElement;
    if (root) {
      observer.observe(root, { childList: true, subtree: true });
    }
  }

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      requestFocusStateSync();
      startObserver();
      applyFocusFilters();
    });
  }
  window.addEventListener('load', () => {
    requestFocusStateSync();
    applyFocusFilters();
  });

  // Initial scan and fast safety interval (also retries sync once if needed)
  applyFocusFilters();
  setInterval(() => {
    if (!lastSyncedFromBackend) {
      requestFocusStateSync();
    }
    applyFocusFilters();
  }, 350);
})();
