//! Browser toolbar HTML/CSS/JS served via `wry://toolbar/` custom protocol.
//!
//! The toolbar is a lightweight HTML UI rendered in a small webview at the top
//! of the window. It communicates with the Rust backend via `window.ipc.postMessage()`.

/// Returns the complete toolbar HTML document as a static string.
/// This is embedded at compile time — zero allocations at runtime.
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
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
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
    padding: 0 12px;
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
  /* Tab bar */
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 1px;
    overflow-x: auto;
    max-width: 50%;
    flex-shrink: 0;
    scrollbar-width: none;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab {
    display: flex;
    align-items: center;
    height: 28px;
    max-width: 180px;
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
  .tab.discarded {
    opacity: 0.6;
    font-style: italic;
  }
  .tab.discarded:hover {
    opacity: 0.9;
  }
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
  .tab-favicon {
    width: 14px; height: 14px;
    flex-shrink: 0;
    border-radius: 2px;
  }
  /* New tab button */
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

  <div style="width:8px"></div>

  <!-- Navigation buttons -->
  <button class="nav-btn" id="backBtn" title="Back (Alt+Left)" disabled>&#x2190;</button>
  <button class="nav-btn" id="fwdBtn" title="Forward (Alt+Right)" disabled>&#x2192;</button>
  <button class="nav-btn" id="reloadBtn" title="Reload (Ctrl+R / F5)">&#x21BB;</button>
  <button class="nav-btn" id="stopBtn" title="Stop (Esc)">&#x2715;</button>

  <!-- Address bar -->
  <div class="addr-container">
    <input class="addr-input" id="addrInput" type="text"
           placeholder="Search or enter URL" spellcheck="false" autocomplete="off">
  </div>

  <!-- Memory saver: Sleep inactive background tabs -->
  <button class="nav-btn" id="discardBtn" title="Sleep Background Tabs (Free Memory)">💤</button>
</div>

<script>
// ── IPC helpers ──────────────────────────────────────────────────────────
function send(cmd) {
  window.ipc.postMessage(JSON.stringify(cmd));
}

// ── DOM refs ─────────────────────────────────────────────────────────────
const tabBar    = document.getElementById('tabBar');
const addrInput = document.getElementById('addrInput');
const backBtn   = document.getElementById('backBtn');
const fwdBtn    = document.getElementById('fwdBtn');
const reloadBtn = document.getElementById('reloadBtn');
const stopBtn   = document.getElementById('stopBtn');
const newTabBtn = document.getElementById('newTabBtn');
const discardBtn = document.getElementById('discardBtn');

// ── Navigation button handlers ──────────────────────────────────────────
backBtn.addEventListener('click', () => send({ action: 'back' }));
fwdBtn.addEventListener('click', () => send({ action: 'forward' }));
reloadBtn.addEventListener('click', () => send({ action: 'reload' }));
stopBtn.addEventListener('click', () => send({ action: 'stop' }));
newTabBtn.addEventListener('click', () => send({ action: 'new_tab' }));
discardBtn.addEventListener('click', () => send({ action: 'discard_background_tabs' }));

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

// Select all text on focus
addrInput.addEventListener('focus', () => {
  setTimeout(() => addrInput.select(), 0);
});

// ── State update from Rust ──────────────────────────────────────────────
// Called by Rust via evaluate_script("updateState(...)")
window.updateState = function(state) {
  // Update address bar
  if (state.url !== undefined && document.activeElement !== addrInput) {
    addrInput.value = state.url;
  }

  // Update back/forward button states
  if (state.can_go_back !== undefined) backBtn.disabled = !state.can_go_back;
  if (state.can_go_forward !== undefined) fwdBtn.disabled = !state.can_go_forward;

  // Update tab bar
  if (state.tabs !== undefined) {
    renderTabs(state.tabs, state.active_tab);
  }
};

window.focusAddressBar = function() {
  addrInput.focus();
  addrInput.select();
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
    addrInput.focus();
  } else if (ctrl && e.key === 'r') {
    e.preventDefault();
    send({ action: 'reload' });
  } else if (e.key === 'F5') {
    e.preventDefault();
    send({ action: 'reload' });
  } else if (ctrl && e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      send({ action: 'prev_tab' });
    } else {
      send({ action: 'next_tab' });
    }
  } else if (ctrl && e.key === 'f') {
    e.preventDefault();
    send({ action: 'find_in_page' });
  }
});

// Signal that the toolbar is ready
send({ action: 'toolbar_ready' });
</script>
</body>
</html>
"##;
