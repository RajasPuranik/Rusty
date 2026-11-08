//! Browser toolbar HTML/CSS/JS served via `wry://toolbar/` custom protocol.
//!
//! Provides:
//! - Multi-tab strip with sleeping / wake indicators
//! - Navigation controls (Back, Forward, Reload, Stop)
//! - Omnibox address bar with Bookmark Star button
//! - In-page Find bar (Ctrl+F, Next/Prev matches, Esc)
//! - Zoom controls (-, %, +)
//! - Quick access buttons for History (Ctrl+H), Bookmarks, Downloads (Ctrl+J)
//! - Background tab memory saver (💤)

pub const TOOLBAR_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 13px;
    background: #202124;
    color: #e8eaed;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 4px;
    gap: 2px;
  }
  /* Navigation buttons */
  .nav-btn {
    width: 28px; height: 28px;
    border: none; border-radius: 50%;
    background: transparent;
    color: #9aa0a6;
    font-size: 15px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }
  .nav-btn:hover { background: #3c4043; color: #e8eaed; }
  .nav-btn:active { background: #5f6368; }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }
  .nav-btn:disabled:hover { background: transparent; }

  /* Address bar */
  .addr-container {
    flex: 1;
    height: 30px;
    background: #303134;
    border-radius: 15px;
    display: flex;
    align-items: center;
    padding: 0 8px 0 12px;
    margin: 0 4px;
    border: 1px solid transparent;
    transition: border-color 0.15s, background 0.15s;
  }
  .addr-container:focus-within {
    background: #202124;
    border-color: #8ab4f8;
  }
  .addr-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e8eaed;
    font-size: 13px;
    font-family: inherit;
  }
  .addr-input::placeholder { color: #9aa0a6; }
  .addr-input::selection { background: #394457; }

  /* Star bookmark button inside address bar */
  .star-btn {
    border: none;
    background: transparent;
    color: #9aa0a6;
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    transition: color 0.15s, transform 0.15s;
    line-height: 1;
  }
  .star-btn:hover { color: #ffd700; transform: scale(1.15); }
  .star-btn.bookmarked { color: #ffd700; }

  /* Find-in-page container (replaces address bar when active) */
  .find-container {
    flex: 1;
    height: 30px;
    background: #303134;
    border-radius: 15px;
    display: flex;
    align-items: center;
    padding: 0 8px 0 12px;
    margin: 0 4px;
    border: 1px solid #8ab4f8;
    gap: 4px;
  }
  .find-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e8eaed;
    font-size: 13px;
    font-family: inherit;
  }
  .find-input::placeholder { color: #9aa0a6; }

  /* Zoom controls */
  .zoom-box {
    display: flex;
    align-items: center;
    background: #303134;
    border-radius: 12px;
    height: 24px;
    padding: 0 4px;
    margin: 0 2px;
    gap: 2px;
    font-size: 11px;
    color: #9aa0a6;
  }
  .zoom-btn {
    width: 18px; height: 18px;
    font-size: 13px;
    border-radius: 50%;
  }
  .zoom-text {
    cursor: pointer;
    padding: 0 2px;
    min-width: 32px;
    text-align: center;
  }
  .zoom-text:hover { color: #e8eaed; }

  /* Tab bar */
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 1px;
    overflow-x: auto;
    max-width: 45%;
    flex-shrink: 0;
    scrollbar-width: none;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab {
    display: flex;
    align-items: center;
    height: 28px;
    max-width: 170px;
    min-width: 60px;
    padding: 0 8px;
    border-radius: 8px 8px 0 0;
    background: #303134;
    cursor: pointer;
    gap: 4px;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .tab:hover { background: #3c4043; }
  .tab.active { background: #202124; }
  .tab.discarded { opacity: 0.6; font-style: italic; }
  .tab.discarded:hover { opacity: 0.9; }
  .tab-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .tab-close {
    width: 16px; height: 16px;
    border: none; border-radius: 50%;
    background: transparent;
    color: #9aa0a6;
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .tab-close:hover { background: #5f6368; color: #e8eaed; }
  .new-tab-btn {
    width: 24px; height: 24px;
    border: none; border-radius: 50%;
    background: transparent;
    color: #9aa0a6;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .new-tab-btn:hover { background: #3c4043; color: #e8eaed; }
</style>
</head>
<body>
<div class="toolbar">
  <!-- Tab bar -->
  <div class="tab-bar" id="tabBar"></div>
  <button class="new-tab-btn" id="newTabBtn" title="New Tab (Ctrl+T)">+</button>

  <div style="width:4px"></div>

  <!-- Navigation buttons -->
  <button class="nav-btn" id="backBtn" title="Back (Alt+Left)" disabled>&#x2190;</button>
  <button class="nav-btn" id="fwdBtn" title="Forward (Alt+Right)" disabled>&#x2192;</button>
  <button class="nav-btn" id="reloadBtn" title="Reload (Ctrl+R / F5)">&#x21BB;</button>
  <button class="nav-btn" id="stopBtn" title="Stop (Esc)">&#x2715;</button>

  <!-- Address bar (normal mode) -->
  <div class="addr-container" id="addrContainer">
    <input class="addr-input" id="addrInput" type="text"
           placeholder="Search or enter URL" spellcheck="false" autocomplete="off">
    <button class="star-btn" id="starBtn" title="Bookmark this tab (Ctrl+D)">☆</button>
  </div>

  <!-- Find bar (activated via Ctrl+F) -->
  <div class="find-container" id="findContainer" style="display:none;">
    <input class="find-input" id="findInput" type="text" placeholder="Find in page..." spellcheck="false">
    <button class="nav-btn zoom-btn" id="findPrevBtn" title="Previous match (Shift+Enter)">&#x25B2;</button>
    <button class="nav-btn zoom-btn" id="findNextBtn" title="Next match (Enter)">&#x25BC;</button>
    <button class="nav-btn zoom-btn" id="findCloseBtn" title="Close find bar (Esc)">&times;</button>
  </div>

  <!-- Zoom Controls -->
  <div class="zoom-box">
    <button class="nav-btn zoom-btn" id="zoomOutBtn" title="Zoom Out (Ctrl+-)">&minus;</button>
    <span class="zoom-text" id="zoomText" title="Reset Zoom (Ctrl+0)">100%</span>
    <button class="nav-btn zoom-btn" id="zoomInBtn" title="Zoom In (Ctrl++)">&plus;</button>
  </div>

  <!-- Find button -->
  <button class="nav-btn" id="findBtn" title="Find in page (Ctrl+F)">🔍</button>

  <!-- History & Bookmarks & Downloads quick links -->
  <button class="nav-btn" id="bmPageBtn" title="Bookmarks (about:bookmarks)">★</button>
  <button class="nav-btn" id="histPageBtn" title="History (Ctrl+H / about:history)">🕒</button>
  <button class="nav-btn" id="dlPageBtn" title="Downloads (Ctrl+J / about:downloads)">📥</button>

  <!-- Memory saver: Sleep inactive background tabs -->
  <button class="nav-btn" id="discardBtn" title="Sleep Background Tabs (Free RAM)">💤</button>
</div>

<script>
// ── IPC helpers ──────────────────────────────────────────────────────────
function send(cmd) {
  window.ipc.postMessage(JSON.stringify(cmd));
}

// ── DOM refs ─────────────────────────────────────────────────────────────
const tabBar       = document.getElementById('tabBar');
const addrContainer= document.getElementById('addrContainer');
const addrInput    = document.getElementById('addrInput');
const starBtn      = document.getElementById('starBtn');
const findContainer= document.getElementById('findContainer');
const findInput    = document.getElementById('findInput');
const findPrevBtn  = document.getElementById('findPrevBtn');
const findNextBtn  = document.getElementById('findNextBtn');
const findCloseBtn = document.getElementById('findCloseBtn');

const backBtn      = document.getElementById('backBtn');
const fwdBtn       = document.getElementById('fwdBtn');
const reloadBtn    = document.getElementById('reloadBtn');
const stopBtn      = document.getElementById('stopBtn');
const newTabBtn    = document.getElementById('newTabBtn');
const discardBtn   = document.getElementById('discardBtn');

const zoomOutBtn   = document.getElementById('zoomOutBtn');
const zoomInBtn    = document.getElementById('zoomInBtn');
const zoomText     = document.getElementById('zoomText');

const findBtn      = document.getElementById('findBtn');
const bmPageBtn    = document.getElementById('bmPageBtn');
const histPageBtn  = document.getElementById('histPageBtn');
const dlPageBtn    = document.getElementById('dlPageBtn');

// ── Navigation button handlers ──────────────────────────────────────────
backBtn.addEventListener('click', () => send({ action: 'back' }));
fwdBtn.addEventListener('click', () => send({ action: 'forward' }));
reloadBtn.addEventListener('click', () => send({ action: 'reload' }));
stopBtn.addEventListener('click', () => send({ action: 'stop' }));
newTabBtn.addEventListener('click', () => send({ action: 'new_tab' }));
discardBtn.addEventListener('click', () => send({ action: 'discard_background_tabs' }));

// ── Quick page buttons ──────────────────────────────────────────────────
bmPageBtn.addEventListener('click', () => send({ action: 'navigate', url: 'about:bookmarks' }));
histPageBtn.addEventListener('click', () => send({ action: 'navigate', url: 'about:history' }));
dlPageBtn.addEventListener('click', () => send({ action: 'navigate', url: 'about:downloads' }));

// ── Bookmark toggle (Star button) ───────────────────────────────────────
starBtn.addEventListener('click', () => send({ action: 'toggle_bookmark' }));

// ── Zoom controls ───────────────────────────────────────────────────────
zoomOutBtn.addEventListener('click', () => send({ action: 'zoom_out' }));
zoomInBtn.addEventListener('click', () => send({ action: 'zoom_in' }));
zoomText.addEventListener('click', () => send({ action: 'zoom_reset' }));

// ── Find in Page ────────────────────────────────────────────────────────
function openFind() {
  addrContainer.style.display = 'none';
  findContainer.style.display = 'flex';
  findInput.focus();
  findInput.select();
}

function closeFind() {
  findContainer.style.display = 'none';
  addrContainer.style.display = 'flex';
  send({ action: 'find_close' });
}

findBtn.addEventListener('click', openFind);
findCloseBtn.addEventListener('click', closeFind);

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const query = findInput.value;
    if (query) {
      send({ action: 'find_in_page', query: query, backwards: e.shiftKey });
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
});

findInput.addEventListener('input', () => {
  const query = findInput.value;
  if (query) {
    send({ action: 'find_in_page', query: query, backwards: false });
  }
});

findNextBtn.addEventListener('click', () => {
  const query = findInput.value;
  if (query) send({ action: 'find_in_page', query: query, backwards: false });
});

findPrevBtn.addEventListener('click', () => {
  const query = findInput.value;
  if (query) send({ action: 'find_in_page', query: query, backwards: true });
});

// ── Address bar ─────────────────────────────────────────────────────────
addrInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = addrInput.value.trim();
    if (val) {
      send({ action: 'navigate', url: val });
      addrInput.blur();
    }
  } else if (e.key === 'Escape') {
    addrInput.blur();
  }
});

addrInput.addEventListener('focus', () => {
  setTimeout(() => addrInput.select(), 0);
});

// ── State update from Rust ──────────────────────────────────────────────
window.updateState = function(state) {
  // Update address bar
  if (state.url !== undefined && document.activeElement !== addrInput) {
    addrInput.value = state.url;
  }

  // Update back/forward button states
  if (state.can_go_back !== undefined) backBtn.disabled = !state.can_go_back;
  if (state.can_go_forward !== undefined) fwdBtn.disabled = !state.can_go_forward;

  // Update bookmark star state
  if (state.is_bookmarked !== undefined) {
    if (state.is_bookmarked) {
      starBtn.classList.add('bookmarked');
      starBtn.textContent = '★';
    } else {
      starBtn.classList.remove('bookmarked');
      starBtn.textContent = '☆';
    }
  }

  // Update zoom display
  if (state.zoom_percent !== undefined) {
    zoomText.textContent = `${state.zoom_percent}%`;
  }

  // Update tab bar
  if (state.tabs !== undefined) {
    renderTabs(state.tabs, state.active_tab);
  }
};

window.focusAddressBar = function() {
  closeFind();
  addrInput.focus();
  addrInput.select();
};

window.openFindBar = function() {
  openFind();
};

function renderTabs(tabs, activeId) {
  tabBar.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    let classes = 'tab' + (tab.id === activeId ? ' active' : '');
    if (tab.is_discarded) classes += ' discarded';
    el.className = classes;
    const titleText = (tab.is_discarded ? '💤 ' : '') + (tab.title || 'New Tab');
    el.title = tab.is_discarded
      ? `${tab.title || 'New Tab'} (Sleeping to save memory — click to restore)`
      : (tab.title || 'New Tab');
    el.innerHTML = `
      <span class="tab-title">${escapeHtml(titleText)}</span>
      <button class="tab-close" data-id="${tab.id}">&times;</button>
    `;
    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        send({ action: 'switch_tab', tab_id: tab.id });
      }
    });
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      send({ action: 'close_tab', tab_id: tab.id });
    });
    tabBar.appendChild(el);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Keyboard shortcut forwarding ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 't') {
    e.preventDefault();
    send({ action: 'new_tab' });
  } else if (ctrl && e.key === 'w') {
    e.preventDefault();
    send({ action: 'close_current_tab' });
  } else if (ctrl && e.key === 'l') {
    e.preventDefault();
    window.focusAddressBar();
  } else if (ctrl && e.key === 'r') {
    e.preventDefault();
    send({ action: 'reload' });
  } else if (e.key === 'F5') {
    e.preventDefault();
    send({ action: 'reload' });
  } else if (ctrl && e.key === 'Tab') {
    e.preventDefault();
    send({ action: e.shiftKey ? 'prev_tab' : 'next_tab' });
  } else if (ctrl && e.key === 'f') {
    e.preventDefault();
    openFind();
  } else if (ctrl && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    send({ action: 'toggle_bookmark' });
  } else if (ctrl && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    send({ action: 'navigate', url: 'about:history' });
  } else if (ctrl && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    send({ action: 'navigate', url: 'about:downloads' });
  } else if (ctrl && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    send({ action: 'zoom_in' });
  } else if (ctrl && e.key === '-') {
    e.preventDefault();
    send({ action: 'zoom_out' });
  } else if (ctrl && e.key === '0') {
    e.preventDefault();
    send({ action: 'zoom_reset' });
  }
});

// Signal that the toolbar is ready
send({ action: 'toolbar_ready' });
</script>
</body>
</html>
"##;
