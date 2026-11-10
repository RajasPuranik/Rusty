/**
 * YouTube Focus & Study Filter Script for Rusty Browser.
 *
 * Injected on YouTube pages and activates when Focus Mode is ON:
 * - Blurs thumbnails of Shorts shelves, carousels, and distracting cards
 *   (gaming, skit, dance, movie trailer, music/entertainment, non-educational)
 * - Keeps Educational and Finance videos crisp, sharp, and unblurred
 * - Intercepts clicks on blurred cards / Shorts / gaming links and shows a
 *   prominent "You are leaving Focus Mode" warning modal
 * - Hides ads, comments, and distraction filter chips during Focus Mode
 * - Shows a prominent RED WARNING overlay on direct blocked /watch or /shorts pages
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
  let lastFocusSignature = '';
  let hasCleanedInactive = false;
  let blockedWatchActive = false;
  let blockedReasonText = '';
  let lastBlurredCount = 0;
  let pendingLeaveHref = '';
  let leaveModalOpen = false;
  let pendingLeaveTimer = 0;

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

  // 4. Inject Dynamic Focus & Thumbnail-Blur CSS Rules (split rules so :has() never breaks simple rules)
  const STYLE_ID = 'rusty-youtube-focus-style';
  function getStyleContainer() {
    return document.head || document.documentElement || document.body;
  }

  function updateFocusStylesheet() {
    const active = isFocusActive();
    const earlyHideStyle = document.getElementById('rusty-early-shorts-hide');
    const earlyBlurStyle = document.getElementById('rusty-early-shorts-blur');
    let style = document.getElementById(STYLE_ID);

    if (!active) {
      if (earlyHideStyle) earlyHideStyle.remove();
      if (earlyBlurStyle) earlyBlurStyle.remove();
      if (style) style.textContent = '';
      return;
    }

    if (earlyHideStyle) earlyHideStyle.remove();

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
      // Blur thumbnails of Shorts & distracted cards (keep tiles visible cleanly)
      `[data-rusty-blurred] ytd-thumbnail img,
       [data-rusty-blurred] yt-thumbnail-view-model img,
       [data-rusty-blurred] .yt-thumbnail-view-model__image img,
       [data-rusty-blurred] yt-image img,
       [data-rusty-blurred] img.yt-core-image,
       [data-rusty-blurred] img.ytCoreImageHost,
       [data-rusty-blurred] .shortsLockupViewModelHostThumbnailContainer img,
       ytm-shorts-lockup-view-model[data-rusty-blurred] img,
       ytm-shorts-lockup-view-model-v2[data-rusty-blurred] img,
       ytm-shorts-lockup-view-model[data-rusty-blurred] yt-image,
       ytm-shorts-lockup-view-model-v2[data-rusty-blurred] yt-image,
       [data-rusty-blurred] ytd-moving-thumbnail-renderer,
       [data-rusty-blurred] .ytd-moving-thumbnail-renderer {
         filter: blur(22px) brightness(0.32) saturate(0.22) !important;
         -webkit-filter: blur(22px) brightness(0.32) saturate(0.22) !important;
         transform: scale(1.1) !important;
         transition: filter 0.16s ease !important;
       }`,

      // Ensure blurred thumbnail containers clip cleanly & accept overlay badge positioning
      `[data-rusty-blurred] ytd-thumbnail,
       [data-rusty-blurred] yt-thumbnail-view-model,
       [data-rusty-blurred] a#thumbnail,
       [data-rusty-blurred] .shortsLockupViewModelHostThumbnailContainer,
       ytm-shorts-lockup-view-model[data-rusty-blurred] .shortsLockupViewModelHostThumbnailContainer,
       ytm-shorts-lockup-view-model-v2[data-rusty-blurred] .shortsLockupViewModelHostThumbnailContainer {
         position: relative !important;
         overflow: hidden !important;
         cursor: pointer !important;
       }`,

      // Subtle badge pill centered over blurred thumbnails (unblurred, pointer-events: none)
      `.rusty-blur-badge {
         position: absolute !important;
         top: 50% !important;
         left: 50% !important;
         transform: translate(-50%, -50%) !important;
         z-index: 25 !important;
         pointer-events: none !important;
         background: rgba(15, 23, 42, 0.88) !important;
         border: 1px solid rgba(248, 113, 113, 0.65) !important;
         color: #fecaca !important;
         padding: 6px 12px !important;
         border-radius: 999px !important;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
         font-size: 11px !important;
         font-weight: 700 !important;
         letter-spacing: 0.25px !important;
         white-space: nowrap !important;
         max-width: 90% !important;
         overflow: hidden !important;
         text-overflow: ellipsis !important;
         box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
         display: inline-flex !important;
         align-items: center !important;
         gap: 4px !important;
       }`,

      // Dim Shorts / Gaming sidebar links visually (clicking triggers leave-focus warning)
      `[data-rusty-shorts-nav="true"] {
         opacity: 0.58 !important;
         border-left: 2px solid rgba(248, 113, 113, 0.7) !important;
       }`,

      // Disable floating video hover preview overlay during Focus Mode so blurred cards never reveal previews
      `ytd-video-preview,
       #video-preview.ytd-video-preview {
         display: none !important;
       }`,

      // Hide Comments during focus
      `ytd-comments,
       #comments.ytd-watch-flexy {
         display: none !important;
       }`,

      // Blur non-educational sidebar recommendations in #related (allowed Edu/Finance stay clear!)
      `#related ytd-compact-video-renderer[data-rusty-blurred] img,
       #related yt-lockup-view-model[data-rusty-blurred] img {
         filter: blur(22px) brightness(0.32) saturate(0.22) !important;
         -webkit-filter: blur(22px) brightness(0.32) saturate(0.22) !important;
         transform: scale(1.1) !important;
       }`,

      // Hide Ads & distraction filter chips (cards remain visible with blurred thumbnails)
      `ytd-ad-slot-renderer,
       ytd-in-feed-ad-layout-renderer,
       [data-rusty-hidden="ad"],
       [data-rusty-chip-hidden] {
         display: none !important;
       }`,
      `ytd-rich-item-renderer:has(ytd-ad-slot-renderer) { display: none !important; }`,

      // Focus banner & Red Warning gate / Leave-Focus Modal base CSS
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
       }`,
      `#rusty-yt-leave-warning {
         position: fixed;
         inset: 0;
         z-index: 2147483647;
         background: rgba(9, 11, 18, 0.8);
         backdrop-filter: blur(10px);
         -webkit-backdrop-filter: blur(10px);
         display: flex;
         align-items: center;
         justify-content: center;
         padding: 20px;
         box-sizing: border-box;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
       }`
    ];

    style.textContent = cssBlocks.join('\n');
  }

  // 5. Redirect direct URL visit /shorts/:id to /watch?v=:id (clicks are caught beforehand by leave-focus warning modal)
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

  // 6. Process Individual Video & Shorts Cards (Blur Distractions, Keep Edu/Finance Sharp)
  const VIDEO_CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-renderer',
    'ytd-radio-renderer',
    'yt-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'ytm-shorts-lockup-view-model',
    'ytd-reel-item-renderer',
    'ytd-ad-slot-renderer'
  ].join(', ');

  function extractCardData(card) {
    const titleEl = card.querySelector(
      '#video-title, #video-title-link, a#video-title, ' +
      '.yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, ' +
      '.shortsLockupViewModelHostOutsideMetadataEndpoint, .shortsLockupViewModelHostMetadataTitle, ' +
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

    return { title: title.trim(), combinedText, links, channel };
  }

  function findThumbHost(card) {
    return (
      card.querySelector(
        '.shortsLockupViewModelHostThumbnailContainer, ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail'
      ) || card
    );
  }

  function getBadgeLabel(reason) {
    if (reason === 'shorts') return '🔒 Shorts • Focus Mode';
    if (reason === 'gaming') return '🔒 Gaming • Focus Mode';
    if (reason === 'entertainment') return '🔒 Focus Mode • Blurred';
    return '🔒 Focus Mode • Blurred';
  }

  function ensureBlurBadge(card, reason) {
    const host = findThumbHost(card);
    if (!host) return;
    let badge = host.querySelector('.rusty-blur-badge') || card.querySelector('.rusty-blur-badge');
    const label = getBadgeLabel(reason);
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'rusty-blur-badge';
      badge.textContent = label;
      host.appendChild(badge);
    } else if (badge.textContent !== label) {
      badge.textContent = label;
    }
  }

  function removeBlurBadge(card) {
    const badges = card.querySelectorAll('.rusty-blur-badge');
    badges.forEach((b) => b.remove());
  }

  function applyBlurToCard(card, reason, videoTitle) {
    if (card.dataset.rustyHidden) {
      card.style.removeProperty('display');
      delete card.dataset.rustyHidden;
    }
    card.dataset.rustyBlurred = reason || 'unrelated';
    if (reason === 'shorts') {
      card.dataset.rustyShorts = 'true';
    } else {
      delete card.dataset.rustyShorts;
    }
    if (videoTitle) {
      card.dataset.rustyTitle = videoTitle.slice(0, 120);
    }
    delete card.dataset.rustyCategory;
    ensureBlurBadge(card, reason);
  }

  function clearBlurFromCard(card) {
    if (card.dataset.rustyHidden) {
      card.style.removeProperty('display');
      delete card.dataset.rustyHidden;
    }
    if (card.dataset.rustyBlurred) {
      delete card.dataset.rustyBlurred;
    }
    if (card.dataset.rustyShorts) {
      card.style.removeProperty('display');
      delete card.dataset.rustyShorts;
    }
    delete card.dataset.rustyTitle;
    delete card.dataset.rustyEvalSig;
    removeBlurBadge(card);
  }

  function processCard(card) {
    const active = isFocusActive();

    if (!active) {
      clearBlurFromCard(card);
      delete card.dataset.rustyCategory;
      return true;
    }

    // Always hide actual ad slots during Focus Mode
    if (card.matches('ytd-ad-slot-renderer') || card.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')) {
      card.style.setProperty('display', 'none', 'important');
      card.dataset.rustyHidden = 'ad';
      delete card.dataset.rustyBlurred;
      removeBlurBadge(card);
      return false;
    }

    // Check if Shorts card -> BLUR thumbnail instead of hiding
    const isShortsCard = Boolean(
      card.matches('ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-reel-item-renderer') ||
      card.querySelector('a[href*="/shorts"], ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2') ||
      card.closest('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, grid-shelf-view-model[is-shorts]')
    );
    const { title, combinedText, links, channel } = extractCardData(card);
    if (isShortsCard) {
      applyBlurToCard(card, 'shorts', title || 'YouTube Short');
      card.dataset.rustyEvalSig = `shorts|${combinedText}`;
      return false;
    }

    if (!combinedText) {
      return true; // Wait for YouTube custom element to populate
    }

    if (card.dataset.rustyEvalSig === combinedText) {
      if (card.dataset.rustyBlurred) {
        ensureBlurBadge(card, card.dataset.rustyBlurred);
        return false;
      }
      if (card.dataset.rustyCategory) {
        return true;
      }
    }

    card.dataset.rustyEvalSig = combinedText;
    const evaluation = evaluateVideo(combinedText, links, channel);
    if (evaluation.allowed) {
      clearBlurFromCard(card);
      card.dataset.rustyCategory = evaluation.category;
      card.dataset.rustyEvalSig = combinedText;
      return true;
    } else {
      applyBlurToCard(card, evaluation.reason, title);
      return false;
    }
  }

  // 7. Blur Shorts Shelves & Mark Shorts/Gaming Sidebar Items (clicking warns "You are leaving Focus Mode")
  const WARNED_SIDEBAR_TITLES = new Set([
    'shorts', 'gaming', 'movies & tv', 'movies', 'music', 'sports', 'fashion & beauty', 'podcasts'
  ]);

  function processShortsAndNavElements() {
    const active = isFocusActive();

    if (!active) {
      document.querySelectorAll('[data-rusty-shorts-nav]').forEach((el) => {
        el.removeAttribute('data-rusty-shorts-nav');
      });
      document.querySelectorAll('[data-rusty-shorts="true"]').forEach((el) => {
        el.style.removeProperty('display');
        el.removeAttribute('data-rusty-shorts');
      });
      return;
    }

    // Tag Shorts & Gaming sidebar/mini-guide buttons so clicking them shows the warning modal
    document.querySelectorAll('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer').forEach((entry) => {
      const a = entry.querySelector('a');
      const label = (
        (a && (a.getAttribute('title') || a.getAttribute('aria-label'))) ||
        entry.getAttribute('aria-label') ||
        entry.textContent ||
        ''
      ).trim().toLowerCase();
      const href = a ? (a.getAttribute('href') || '').toLowerCase() : '';
      if (label === 'shorts' || href.includes('/shorts') || WARNED_SIDEBAR_TITLES.has(label) || href.includes('/gaming')) {
        entry.setAttribute('data-rusty-shorts-nav', 'true');
        entry.dataset.rustyNavReason = (label === 'shorts' || href.includes('/shorts')) ? 'shorts' : 'entertainment';
      } else {
        entry.removeAttribute('data-rusty-shorts-nav');
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

  function restoreHiddenGridRows() {
    document.querySelectorAll('ytd-rich-grid-row[data-rusty-row-hidden]').forEach((row) => {
      row.style.removeProperty('display');
      delete row.dataset.rustyRowHidden;
    });
  }

  function applyFocusFilters() {
    updateFocusStylesheet();
    checkShortsRedirect();
    processShortsAndNavElements();
    filterChips();
    restoreHiddenGridRows();

    const cards = document.querySelectorAll(VIDEO_CARD_SELECTORS);
    let blurredCount = 0;
    let visibleCount = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const tag = card.tagName.toLowerCase();
      // Skip nested lockups/shorts cards whose parent item/lockup-v2 handles blurring
      if (tag === 'yt-lockup-view-model' && card.closest('ytd-rich-item-renderer')) {
        continue;
      }
      if (tag === 'ytm-shorts-lockup-view-model' && card.closest('ytm-shorts-lockup-view-model-v2, ytd-rich-item-renderer')) {
        continue;
      }
      if (tag === 'ytm-shorts-lockup-view-model-v2' && card.closest('ytd-rich-item-renderer')) {
        continue;
      }
      const allowed = processCard(card);
      if (allowed) {
        visibleCount++;
      } else {
        blurredCount++;
      }
    }

    lastBlurredCount = blurredCount;
    checkWatchPageGate();
    ensureFocusBanner(visibleCount, blurredCount);
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
    heading.textContent = 'You are leaving Focus Mode!';

    const subheading = document.createElement('div');
    subheading.style.cssText = 'font-size: 16px; font-weight: 700; color: #fca5a5; margin: 0 0 8px 0;';
    subheading.textContent = 'Focus on Your Studies & Work!';

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size: 15px; color: #fee2e2; line-height: 1.55; margin: 0 0 22px 0; opacity: 0.92;';
    desc.textContent = `This video is outside your Focus Mode study/finance filter (${reasonLabel}). Only Educational & Finance content is permitted without leaving Focus Mode.`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;';

    const btnBack = document.createElement('button');
    btnBack.id = 'btn-rusty-gate-back';
    btnBack.type = 'button';
    btnBack.style.cssText = 'padding: 11px 20px; border-radius: 10px; background: #10b981; color: #ffffff; border: 1px solid #34d399; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);';
    btnBack.textContent = '← Stay in Focus Mode (Home)';
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

    const btnLeave = document.createElement('button');
    btnLeave.id = 'btn-rusty-gate-leave';
    btnLeave.type = 'button';
    btnLeave.style.cssText = 'padding: 11px 20px; border-radius: 10px; background: rgba(220, 38, 38, 0.25); color: #fecaca; border: 1px solid #ef4444; font-size: 14px; font-weight: 600; cursor: pointer;';
    btnLeave.textContent = 'Leave Focus Mode & Watch';
    btnLeave.addEventListener('click', (ev) => {
      if (!ev || ev.isTrusted === false) return;
      requestLeaveFocusMode('');
    });

    btnRow.appendChild(btnBack);
    btnRow.appendChild(btnSearch);
    btnRow.appendChild(btnLeave);

    box.appendChild(badge);
    box.appendChild(icon);
    box.appendChild(heading);
    box.appendChild(subheading);
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
    const isShortsPage = window.location.pathname.startsWith('/shorts');
    const existingGate = document.getElementById('rusty-yt-watch-gate');

    if ((!isWatch && !isShortsPage) || !isFocusActive()) {
      blockedWatchActive = false;
      if (existingGate) existingGate.remove();
      return;
    }

    if (isShortsPage) {
      blockedWatchActive = true;
      enforcePausedVideo();
      const host = document.querySelector('#shorts-container, ytd-shorts') || document.body;
      if (!host) return;
      if (!existingGate || blockedReasonText !== 'YouTube Short') {
        if (existingGate) existingGate.remove();
        blockedReasonText = 'YouTube Short';
        const gate = buildRedWatchGateDom('YouTube Short');
        gate.style.position = 'fixed';
        gate.style.inset = '0';
        host.appendChild(gate);
      }
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
      if (blockedCount > 0) {
        textNode.textContent = `Focus Mode (${modeName}) Active: Blurred ${blockedCount} distracting videos & Shorts • Keeping Educational & Finance clear.`;
      } else {
        textNode.textContent = `Focus Mode (${modeName}) Active: Distracting thumbnails & Shorts blurred. Educational & Finance clear.`;
      }
    }
  }

  // 10. "You are leaving Focus Mode" Warning Modal (strictly createElement - zero innerHTML)
  function closeLeaveWarningModal() {
    const existing = document.getElementById('rusty-yt-leave-warning');
    if (existing) existing.remove();
    leaveModalOpen = false;
  }

  function requestLeaveFocusMode(targetHref) {
    pendingLeaveHref = targetHref || '';
    if (pendingLeaveTimer) {
      clearTimeout(pendingLeaveTimer);
      pendingLeaveTimer = 0;
    }
    try {
      if (window === window.top && window.ipc && typeof window.ipc.postMessage === 'function') {
        window.ipc.postMessage(JSON.stringify({ action: 'stop_focus' }));
      }
    } catch (_) {}

    focusState = Object.assign({}, focusState || {}, { is_active: false, is_paused: false });
    window.__RUSTY_FOCUS_STATE__ = focusState;
    lastFocusSignature = `false|false|${focusState.mode || ''}`;
    closeLeaveWarningModal();
    applyFocusFilters();

    if (pendingLeaveHref) {
      // Wait for Rust backend StopFocus ack in __rustyOnFocusState, with a 120ms fallback timer
      pendingLeaveTimer = setTimeout(() => {
        pendingLeaveTimer = 0;
        if (pendingLeaveHref) {
          const dest = pendingLeaveHref;
          pendingLeaveHref = '';
          window.location.href = dest;
        }
      }, 120);
    }
  }

  function showLeaveFocusWarning(reason, videoTitle, targetHref) {
    closeLeaveWarningModal();
    const host = document.body || document.documentElement;
    if (!host) return;

    leaveModalOpen = true;
    const modal = document.createElement('div');
    modal.id = 'rusty-yt-leave-warning';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.style.cssText = [
      'max-width: 460px',
      'width: 100%',
      'background: linear-gradient(145deg, rgba(69, 10, 10, 0.97), rgba(15, 23, 42, 0.99))',
      'border: 2px solid #ef4444',
      'border-radius: 16px',
      'padding: 28px 24px',
      'box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 36px rgba(239, 68, 68, 0.35)',
      'color: #fef2f2',
      'text-align: center',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'box-sizing: border-box'
    ].join(';');

    const badge = document.createElement('div');
    badge.style.cssText = 'display: inline-block; padding: 5px 12px; border-radius: 999px; background: rgba(239, 68, 68, 0.22); border: 1px solid #f87171; color: #fca5a5; font-size: 11px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; margin-bottom: 12px;';
    badge.textContent = `⚠️ Focus Mode Warning • ${getWatchReasonLabel(reason)}`;

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size: 40px; line-height: 1; margin-bottom: 10px;';
    icon.textContent = '🔒';

    const title = document.createElement('h2');
    title.style.cssText = 'font-size: 22px; font-weight: 800; color: #fecaca; margin: 0 0 10px 0; line-height: 1.25;';
    title.textContent = 'You are leaving Focus Mode';

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size: 14px; color: #fee2e2; line-height: 1.55; margin: 0 0 16px 0; opacity: 0.92;';
    desc.textContent = 'Opening this video will exit Focus Mode. Stay focused on your studies & work!';

    card.appendChild(badge);
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);

    if (videoTitle) {
      const chip = document.createElement('div');
      chip.style.cssText = 'width: 100%; padding: 8px 12px; border-radius: 10px; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(248, 113, 113, 0.28); color: #e2e8f0; font-size: 12px; margin-bottom: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box;';
      chip.textContent = videoTitle;
      card.appendChild(chip);
    }

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; width: 100%;';

    const btnStay = document.createElement('button');
    btnStay.id = 'btn-rusty-stay-focus';
    btnStay.type = 'button';
    btnStay.style.cssText = 'flex: 1 1 170px; padding: 11px 16px; border-radius: 10px; background: #10b981; color: #ffffff; border: 1px solid #34d399; font-size: 13px; font-weight: 700; cursor: pointer;';
    btnStay.textContent = '← Stay in Focus Mode';
    btnStay.addEventListener('click', (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      closeLeaveWarningModal();
    });

    const btnLeave = document.createElement('button');
    btnLeave.id = 'btn-rusty-leave-focus';
    btnLeave.type = 'button';
    btnLeave.style.cssText = 'flex: 1 1 170px; padding: 11px 16px; border-radius: 10px; background: rgba(220, 38, 38, 0.28); color: #fecaca; border: 1px solid #ef4444; font-size: 13px; font-weight: 700; cursor: pointer;';
    btnLeave.textContent = targetHref ? 'Leave Focus Mode & Watch' : 'Leave Focus Mode';
    btnLeave.addEventListener('click', (ev) => {
      if (!ev || ev.isTrusted === false) return;
      ev.preventDefault();
      ev.stopPropagation();
      requestLeaveFocusMode(targetHref);
    });

    btnRow.appendChild(btnStay);
    btnRow.appendChild(btnLeave);
    card.appendChild(btnRow);
    modal.appendChild(card);

    modal.addEventListener('click', (ev) => {
      if (ev && ev.target === modal) {
        ev.preventDefault();
        ev.stopPropagation();
        closeLeaveWarningModal();
      }
    });

    host.appendChild(modal);
    try {
      if (typeof btnStay.focus === 'function') btnStay.focus();
    } catch (_) {}
  }

  function findFocusClickBlock(target, anchorHint) {
    if (!isFocusActive() || !target || typeof target.closest !== 'function') return null;

    // Never block clicks inside our own warning overlays or study topic banner
    if (
      target.closest('#rusty-yt-leave-warning') ||
      target.closest('#rusty-yt-watch-gate') ||
      target.closest('#rusty-yt-focus-banner')
    ) {
      return null;
    }

    // 1. Blurred video / Shorts card
    const blurredCard = target.closest('[data-rusty-blurred]');
    if (blurredCard) {
      const a = anchorHint || target.closest('a[href]') || blurredCard.querySelector('a[href*="/watch"], a[href*="/shorts"], a[href]');
      const href = a && a.href ? a.href : '';
      return {
        reason: blurredCard.dataset.rustyBlurred || 'unrelated',
        title: blurredCard.dataset.rustyTitle || (a && (a.title || a.getAttribute('aria-label'))) || '',
        href
      };
    }

    // 2. Sidebar Shorts / Gaming entry
    const navItem = target.closest('[data-rusty-shorts-nav="true"]');
    if (navItem) {
      const a = anchorHint || target.closest('a[href]') || navItem.querySelector('a[href]');
      return {
        reason: (navItem.dataset && navItem.dataset.rustyNavReason) || 'shorts',
        title: (navItem.textContent || '').trim().slice(0, 80),
        href: a && a.href ? a.href : ''
      };
    }

    // 3. Fallback anchor check for /shorts, /gaming, or /playables before initial DOM card scan catches it
    const anchor = anchorHint || target.closest('a[href]');
    if (anchor) {
      const rawHref = (anchor.getAttribute('href') || '').toLowerCase();
      if (rawHref.includes('/shorts') || rawHref.includes('/gaming') || rawHref.includes('/playables')) {
        return {
          reason: rawHref.includes('/shorts') ? 'shorts' : 'gaming',
          title: anchor.getAttribute('title') || anchor.getAttribute('aria-label') || '',
          href: anchor.href || ''
        };
      }
    }

    return null;
  }

  // Expose hook so CONTENT_INIT_SCRIPT middle/Ctrl/Shift clicks ALSO trigger the warning modal!
  window.__rustyShouldInterceptFocusClick = function (e, anchor) {
    const info = findFocusClickBlock(e && e.target, anchor);
    if (!info) return false;
    showLeaveFocusWarning(info.reason, info.title, info.href);
    return true;
  };

  // Capture-phase click guard on window: shows "You are leaving Focus Mode" before YouTube Polymer or <a> handles it
  window.addEventListener('click', (e) => {
    const info = findFocusClickBlock(e.target, null);
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }
    showLeaveFocusWarning(info.reason, info.title, info.href);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (leaveModalOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeLeaveWarningModal();
    }
  }, true);

  // 11. Real-time Focus State Receiver from Rust Backend
  window.__rustyOnFocusState = function (msg) {
    if (!msg || typeof msg !== 'object') return;
    const newState = msg.state || msg;
    if (newState && typeof newState.is_active === 'boolean') {
      focusState = newState;
      window.__RUSTY_FOCUS_STATE__ = newState;
      const nextSig = `${newState.is_active}|${Boolean(newState.is_paused)}|${newState.mode || ''}`;
      const changed = !lastSyncedFromBackend || nextSig !== lastFocusSignature;
      lastSyncedFromBackend = true;
      lastFocusSignature = nextSig;

      if (isFocusActive()) {
        if (pendingLeaveTimer) {
          clearTimeout(pendingLeaveTimer);
          pendingLeaveTimer = 0;
        }
        pendingLeaveHref = '';
      } else {
        closeLeaveWarningModal();
        if (pendingLeaveHref) {
          if (pendingLeaveTimer) {
            clearTimeout(pendingLeaveTimer);
            pendingLeaveTimer = 0;
          }
          const dest = pendingLeaveHref;
          pendingLeaveHref = '';
          hasCleanedInactive = false;
          applyFocusFilters();
          window.location.href = dest;
          return;
        }
      }

      if (changed) {
        hasCleanedInactive = false;
        applyFocusFilters();
      }
    }
  };
  window.__rustyFocusEvaluate = evaluateVideo;
  window.__rustyApplyFocusFilters = applyFocusFilters;
  window.__rustyShowLeaveFocusWarning = showLeaveFocusWarning;

  // 12. Hook SPA Navigation & History Transitions
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
    closeLeaveWarningModal();
    requestFocusStateSync();
    setTimeout(applyFocusFilters, 40);
  });
  window.addEventListener('yt-page-data-updated', () => {
    setTimeout(applyFocusFilters, 40);
  });

  // 13. MutationObserver for dynamic infinite scroll cards & Polymer hydration
  let debounceTimeout = 0;
  const observer = new MutationObserver(() => {
    if (!isFocusActive() && hasCleanedInactive) return;
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

  // Initial scan and safety interval
  applyFocusFilters();
  setInterval(() => {
    if (!lastSyncedFromBackend) {
      requestFocusStateSync();
    }
    if (!isFocusActive()) {
      if (!hasCleanedInactive) {
        applyFocusFilters();
        hasCleanedInactive = true;
      }
      return;
    }
    hasCleanedInactive = false;
    applyFocusFilters();
  }, 500);
})();
