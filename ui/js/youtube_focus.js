/**
 * YouTube Focus & Study Filter Script for Rusty Browser.
 *
 * Injected on YouTube pages during active Focus Sessions:
 * - Hides Shorts shelves, guide links, and buttons
 * - Intercepts SPA history (pushState/replaceState) to redirect /shorts/:id -> /watch?v=:id
 * - Hides comments and related sidebar videos during focus
 * - Replaces home feed with a clean, distraction-free study search prompt
 */

(function () {
  'use strict';

  // Inject CSS rules hiding distraction elements
  const STYLE_ID = 'rusty-youtube-focus-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Hide YouTube Shorts shelves, buttons & links */
      ytd-rich-shelf-renderer[is-shorts],
      ytd-reel-shelf-renderer,
      ytd-guide-entry-renderer a[title="Shorts"],
      ytd-mini-guide-entry-renderer[aria-label="Shorts"],
      #shorts-container,
      ytd-reel-video-renderer {
        display: none !important;
      }

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

      /* Dim and clean home feed recommendations */
      ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // Intercept client-side SPA navigation to redirect /shorts/:id
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

  // Hook History API
  const originalPush = history.pushState;
  history.pushState = function () {
    originalPush.apply(this, arguments);
    checkShortsRedirect();
  };

  const originalReplace = history.replaceState;
  history.replaceState = function () {
    originalReplace.apply(this, arguments);
    checkShortsRedirect();
  };

  window.addEventListener('popstate', checkShortsRedirect);
  window.addEventListener('load', checkShortsRedirect);
  checkShortsRedirect();
})();
