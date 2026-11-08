// Chrome UI Controller: Manages navigation, tabs, omnibox, memory badge, and content_rect reporting
(function () {
  'use strict';

  let currentTabs = [];
  let activeTabId = null;
  let activeUrl = 'about:blank';
  let canGoBack = false;
  let canGoForward = false;
  let isBookmarked = false;
  let isOverlayOpen = false;

  // DOM Elements
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const omniboxInput = document.getElementById('omnibox-input');
  const omniboxSecurity = document.getElementById('omnibox-security');
  const btnStar = document.getElementById('btn-star');
  const btnToggleTabs = document.getElementById('btn-toggle-tabs');
  const btnPalette = document.getElementById('btn-palette');
  const memoryBadge = document.getElementById('memory-badge');
  const memoryText = document.getElementById('memory-text');
  const tabsContainerH = document.getElementById('tabs-horizontal-list');
  const tabsContainerV = document.getElementById('tabs-sidebar-list');
  const btnNewTabH = document.getElementById('btn-new-tab-h');
  const btnNewTabV = document.getElementById('btn-new-tab-v');
  const viewport = document.getElementById('content-viewport');
  const modalOverlay = document.getElementById('modal-overlay');
  const paletteInput = document.getElementById('palette-input');
  const paletteResults = document.getElementById('palette-results');

  // ── 1. Content Rectangle Reporting (Critical for Native Webview bounds) ──
  function reportContentRect() {
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const payload = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    if (window.bridge) {
      window.bridge.send('content_rect', payload);
    }
  }

  window.addEventListener('resize', reportContentRect);
  window.addEventListener('tabs-layout-changed', () => setTimeout(reportContentRect, 50));

  // ── 2. Navigation Actions ────────────────────────────────────────────────
  if (btnBack) btnBack.addEventListener('click', () => window.bridge.send('back'));
  if (btnForward) btnForward.addEventListener('click', () => window.bridge.send('forward'));
  if (btnReload) btnReload.addEventListener('click', () => window.bridge.send('reload'));
  if (btnStar) {
    btnStar.addEventListener('click', () => {
      window.bridge.send('toggle_bookmark', { url: activeUrl });
    });
  }

  // ── 3. Omnibox Enter & URL Detection ─────────────────────────────────────
  if (omniboxInput) {
    omniboxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = omniboxInput.value.trim();
        if (query) {
          window.bridge.send('navigate', { url: query });
          omniboxInput.blur();
        }
      } else if (e.key === 'Escape') {
        omniboxInput.value = activeUrl === 'about:blank' ? '' : activeUrl;
        omniboxInput.blur();
      }
    });

    omniboxInput.addEventListener('focus', () => {
      omniboxInput.select();
    });
  }

  // ── 4. New Tab Buttons ───────────────────────────────────────────────────
  function handleNewTab() {
    window.bridge.send('new_tab', { url: 'about:blank' });
  }
  if (btnNewTabH) btnNewTabH.addEventListener('click', handleNewTab);
  if (btnNewTabV) btnNewTabV.addEventListener('click', handleNewTab);

  // ── 5. Toggle Vertical vs Horizontal Tabs ────────────────────────────────
  if (btnToggleTabs) {
    btnToggleTabs.addEventListener('click', () => {
      if (window.toggleTabsLayout) {
        window.toggleTabsLayout();
      }
    });
  }

  // ── 6. Tab Rendering ─────────────────────────────────────────────────────
  function renderTabs(container, isVertical = false) {
    if (!container) return;
    container.innerHTML = '';

    currentTabs.forEach((tab) => {
      const tabEl = document.createElement('div');
      let cls = 'tab-item';
      if (tab.active) cls += ' active';
      if (tab.sleeping) cls += ' sleeping';
      if (tab.pinned) cls += ' pinned';
      tabEl.className = cls;
      tabEl.dataset.tabId = tab.id;

      // Icon (Favicon or Moon indicator)
      const iconEl = document.createElement('div');
      iconEl.className = 'tab-favicon';
      if (tab.sleeping) {
        iconEl.innerHTML = window.Icons ? window.Icons.get('moon', 'tab-icon', 13) : '💤';
        iconEl.title = 'Tab is asleep (RAM freed). Click to wake.';
      } else {
        iconEl.innerHTML = window.Icons ? window.Icons.get('sparkles', 'tab-icon', 13) : '•';
      }
      tabEl.appendChild(iconEl);

      // Title
      const titleEl = document.createElement('span');
      titleEl.className = 'tab-title';
      titleEl.textContent = tab.title || (tab.url === 'about:blank' ? 'New Tab' : tab.url);
      tabEl.appendChild(titleEl);

      // Close button
      if (!tab.pinned) {
        const closeEl = document.createElement('button');
        closeEl.className = 'tab-close';
        closeEl.innerHTML = window.Icons ? window.Icons.get('close', '', 11) : '×';
        closeEl.title = 'Close tab (Ctrl+W)';
        closeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          window.bridge.send('close_tab', { tab_id: tab.id });
        });
        tabEl.appendChild(closeEl);
      }

      // Switch tab on click
      tabEl.addEventListener('click', () => {
        if (tab.sleeping) {
          window.bridge.send('wake_tab', { tab_id: tab.id });
        } else {
          window.bridge.send('switch_tab', { tab_id: tab.id });
        }
      });

      container.appendChild(tabEl);
    });
  }

  // ── 7. State Update Listener from Bridge ─────────────────────────────────
  window.bridge.on('state_update', (data) => {
    if (data.tabs) {
      currentTabs = data.tabs;
      renderTabs(tabsContainerH, false);
      renderTabs(tabsContainerV, true);
    }

    if (data.active_tab !== undefined) {
      activeTabId = data.active_tab;
    }

    if (data.url !== undefined) {
      activeUrl = data.url;
      if (omniboxInput && document.activeElement !== omniboxInput) {
        omniboxInput.value = data.url === 'about:blank' ? '' : data.url;
      }
      // Update Security Icon
      if (omniboxSecurity) {
        const isSecure = data.url.startsWith('https://');
        omniboxSecurity.className = `omnibox-security-icon ${isSecure ? 'secure' : ''}`;
        omniboxSecurity.innerHTML = window.Icons
          ? window.Icons.get(isSecure ? 'lock' : 'lock-open', '', 14)
          : (isSecure ? '🔒' : '🔓');
      }
    }

    if (data.can_go_back !== undefined && btnBack) {
      btnBack.disabled = !data.can_go_back;
    }
    if (data.can_go_forward !== undefined && btnForward) {
      btnForward.disabled = !data.can_go_forward;
    }

    if (data.is_bookmarked !== undefined && btnStar) {
      isBookmarked = data.is_bookmarked;
      btnStar.className = `btn-star ${isBookmarked ? 'bookmarked' : ''}`;
      btnStar.innerHTML = window.Icons
        ? window.Icons.get(isBookmarked ? 'star-filled' : 'star', '', 15)
        : (isBookmarked ? '★' : '☆');
    }

    if (data.memory) {
      updateMemoryBadge(data.memory);
    }

    // Update Mock iframe if running in browser preview
    if (window.bridge.isMock && viewport) {
      updateMockViewport(activeUrl);
    }

    reportContentRect();
  });

  // ── 8. Memory Badge Updates ──────────────────────────────────────────────
  function updateMemoryBadge(mem) {
    if (!memoryText) return;
    const mb = mem.total_mb ? `${mem.total_mb.toFixed(0)} MB` : '85 MB';
    memoryText.textContent = mb;
    if (mem.savings_percent && memoryBadge) {
      memoryBadge.title = `Total RAM: ${mem.total_mb} MB (${mem.savings_percent}% less memory than Chrome baseline)`;
    }
  }

  window.bridge.on('memory_stats', updateMemoryBadge);

  // ── 9. Mock Viewport Iframe for standalone browser preview ───────────────
  let mockIframe = null;
  function updateMockViewport(url) {
    if (!viewport) return;
    if (!mockIframe) {
      mockIframe = document.createElement('iframe');
      mockIframe.style.width = '100%';
      mockIframe.style.height = '100%';
      mockIframe.style.border = 'none';
      viewport.appendChild(mockIframe);
    }
    const targetSrc = (url === 'about:blank' || url.startsWith('about:')) ? 'newtab.html' : url;
    if (mockIframe.src !== targetSrc && !mockIframe.src.endsWith(targetSrc)) {
      mockIframe.src = targetSrc;
    }
  }

  // ── 10. Command Palette (Ctrl+K) ─────────────────────────────────────────
  const COMMANDS = [
    { title: 'Switch to Minimal Skin', action: () => window.switchSkin('minimal'), badge: 'Skin' },
    { title: 'Switch to Crazy Skin', action: () => window.switchSkin('crazy'), badge: 'Skin' },
    { title: 'Theme: Midnight', action: () => window.switchTheme('midnight'), badge: 'Theme' },
    { title: 'Theme: Light', action: () => window.switchTheme('light'), badge: 'Theme' },
    { title: 'Theme: AMOLED Black', action: () => window.switchTheme('amoled'), badge: 'Theme' },
    { title: 'Theme: Aurora Teal', action: () => window.switchTheme('aurora'), badge: 'Theme' },
    { title: 'Theme: Cyberpunk Neon', action: () => window.switchTheme('cyberpunk'), badge: 'Theme' },
    { title: 'Theme: Sunset Dusk', action: () => window.switchTheme('sunset'), badge: 'Theme' },
    { title: 'Theme: Matcha Sage', action: () => window.switchTheme('matcha'), badge: 'Theme' },
    { title: 'Theme: Sakura Blossom', action: () => window.switchTheme('sakura'), badge: 'Theme' },
    { title: 'Toggle Vertical Tabs', action: () => window.toggleTabsLayout(), badge: 'Layout' },
    { title: 'New Tab', action: handleNewTab, badge: 'Tabs' },
    { title: 'Open Settings (about:settings)', action: () => window.bridge.send('navigate', { url: 'about:settings' }), badge: 'Page' },
    { title: 'Open Bookmarks (about:bookmarks)', action: () => window.bridge.send('navigate', { url: 'about:bookmarks' }), badge: 'Page' },
    { title: 'Open History (about:history)', action: () => window.bridge.send('navigate', { url: 'about:history' }), badge: 'Page' },
    { title: 'Open Downloads (about:downloads)', action: () => window.bridge.send('navigate', { url: 'about:downloads' }), badge: 'Page' }
  ];

  function openCommandPalette() {
    if (!modalOverlay) return;
    isOverlayOpen = true;
    modalOverlay.classList.add('open');
    window.bridge.send('overlay', { open: true });
    if (paletteInput) {
      paletteInput.value = '';
      renderPaletteResults('');
      paletteInput.focus();
    }
  }

  function closeCommandPalette() {
    if (!modalOverlay) return;
    isOverlayOpen = false;
    modalOverlay.classList.remove('open');
    window.bridge.send('overlay', { open: false });
  }

  function renderPaletteResults(query) {
    if (!paletteResults) return;
    paletteResults.innerHTML = '';
    const q = query.toLowerCase();
    const filtered = COMMANDS.filter((c) => c.title.toLowerCase().includes(q));

    filtered.forEach((cmd, i) => {
      const item = document.createElement('div');
      item.className = `palette-item ${i === 0 ? 'selected' : ''}`;
      item.innerHTML = `
        <span class="item-title">${cmd.title}</span>
        <span class="item-badge">${cmd.badge}</span>
      `;
      item.addEventListener('click', () => {
        closeCommandPalette();
        cmd.action();
      });
      paletteResults.appendChild(item);
    });
  }

  if (btnPalette) btnPalette.addEventListener('click', openCommandPalette);

  if (paletteInput) {
    paletteInput.addEventListener('input', (e) => renderPaletteResults(e.target.value));
    paletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeCommandPalette();
      } else if (e.key === 'Enter') {
        const selected = paletteResults.querySelector('.palette-item.selected') || paletteResults.firstChild;
        if (selected) selected.click();
      }
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeCommandPalette();
    });
  }

  // ── 11. Global Keyboard Shortcuts ────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    // Ctrl+K -> Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOverlayOpen) closeCommandPalette();
      else openCommandPalette();
    }
    // Ctrl+T -> New Tab
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
      e.preventDefault();
      handleNewTab();
    }
    // Ctrl+W -> Close Tab
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (activeTabId !== null) {
        window.bridge.send('close_tab', { tab_id: activeTabId });
      }
    }
    // Ctrl+L -> Focus Omnibox
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (omniboxInput) omniboxInput.focus();
    }
  });

  // Initial layout report
  setTimeout(reportContentRect, 100);
})();
