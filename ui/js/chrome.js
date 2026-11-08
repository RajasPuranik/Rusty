// Chrome UI Controller: Manages tabs, vertical sidebar, drag-reorder, groups, context menu, and command palette
(function () {
  'use strict';

  let currentTabs = [];
  let currentGroups = [];
  let currentBookmarks = [];
  let currentHistory = [];
  let activeTabId = null;
  let activeUrl = 'about:blank';
  let isBookmarked = false;
  let isOverlayOpen = false;
  let contextMenuTargetTabId = null;
  let draggedTabId = null;

  // DOM Elements
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const btnToggleTabs = document.getElementById('btn-toggle-tabs');
  const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
  const omniboxInput = document.getElementById('omnibox-input');
  const omniboxSecurity = document.getElementById('omnibox-security');
  const btnStar = document.getElementById('btn-star');
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
  const contextMenu = document.getElementById('tab-context-menu');

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

  // ── 5. Toggle Vertical vs Horizontal Tabs & Sidebar Collapse ─────────────
  if (btnToggleTabs) {
    btnToggleTabs.addEventListener('click', () => {
      if (window.toggleTabsLayout) {
        window.toggleTabsLayout();
      }
    });
  }

  if (btnCollapseSidebar) {
    btnCollapseSidebar.addEventListener('click', () => {
      const root = document.documentElement;
      const isCollapsed = root.getAttribute('data-sidebar-collapsed') === 'true';
      const next = !isCollapsed;
      if (next) {
        root.setAttribute('data-sidebar-collapsed', 'true');
      } else {
        root.removeAttribute('data-sidebar-collapsed');
      }
      if (window.Settings) {
        window.Settings.set('vertical_collapsed', next);
      }
      btnCollapseSidebar.innerHTML = window.Icons
        ? window.Icons.get(next ? 'chevron-right' : 'chevron-left', '', 14)
        : (next ? '▶' : '◀');
      setTimeout(reportContentRect, 220);
    });
  }

  // ── 6. Tab Rendering (Pinned, Groups, Drag & Drop) ───────────────────────
  function renderTabs(container, isVertical = false) {
    if (!container) return;
    container.innerHTML = '';

    const pinnedTabs = currentTabs.filter((t) => t.pinned);
    const unpinnedTabs = currentTabs.filter((t) => !t.pinned);

    // 6.1 Render Pinned Tabs
    if (pinnedTabs.length > 0) {
      const pinnedWrap = document.createElement('div');
      pinnedWrap.className = 'pinned-tabs-wrap';
      pinnedTabs.forEach((tab) => {
        pinnedWrap.appendChild(createTabElement(tab, isVertical));
      });
      container.appendChild(pinnedWrap);
    }

    // 6.2 Render Tab Groups
    const renderedGroupIds = new Set();
    currentGroups.forEach((group) => {
      const groupTabs = unpinnedTabs.filter((t) => t.group_id === group.id);
      if (groupTabs.length === 0) return;
      renderedGroupIds.add(group.id);

      const groupContainer = document.createElement('div');
      groupContainer.className = `tab-group-container ${group.collapsed ? 'collapsed' : ''}`;
      groupContainer.dataset.groupId = group.id;

      // Group Header Pill
      const header = document.createElement('div');
      header.className = `tab-group-header ${group.collapsed ? 'collapsed' : ''}`;
      header.style.backgroundColor = `${group.color}22`;
      header.style.borderColor = group.color;
      header.style.color = group.color;

      const dot = document.createElement('span');
      dot.className = 'tab-group-dot';
      dot.style.backgroundColor = group.color;
      header.appendChild(dot);

      const title = document.createElement('span');
      title.className = 'tab-group-title';
      title.textContent = group.name;
      header.appendChild(title);

      const badge = document.createElement('span');
      badge.className = 'tab-group-badge';
      badge.textContent = `(${groupTabs.length})`;
      header.appendChild(badge);

      const chevron = document.createElement('span');
      chevron.className = 'tab-group-chevron';
      chevron.innerHTML = window.Icons ? window.Icons.get('chevron-down', '', 10) : '▾';
      header.appendChild(chevron);

      header.addEventListener('click', (e) => {
        e.stopPropagation();
        window.bridge.send('toggle_group_collapse', { group_id: group.id });
      });

      groupContainer.appendChild(header);

      // Group tabs
      groupTabs.forEach((tab) => {
        groupContainer.appendChild(createTabElement(tab, isVertical));
      });

      container.appendChild(groupContainer);
    });

    // 6.3 Render Unassigned Tabs
    const unassignedTabs = unpinnedTabs.filter((t) => !t.group_id || !renderedGroupIds.has(t.group_id));
    unassignedTabs.forEach((tab) => {
      container.appendChild(createTabElement(tab, isVertical));
    });
  }

  function createTabElement(tab, isVertical) {
    const tabEl = document.createElement('div');
    let cls = 'tab-item';
    if (tab.active) cls += ' active';
    if (tab.sleeping) cls += ' sleeping';
    if (tab.pinned) cls += ' pinned';
    if (tab.muted) cls += ' muted';
    tabEl.className = cls;
    tabEl.dataset.tabId = tab.id;
    tabEl.draggable = true;

    // Favicon or Status Icon
    const iconEl = document.createElement('div');
    iconEl.className = 'tab-favicon';
    if (tab.sleeping) {
      iconEl.innerHTML = window.Icons ? window.Icons.get('moon', 'tab-icon', 13) : '💤';
      iconEl.title = 'Tab is asleep (reclaimed RAM). Click to wake.';
    } else {
      iconEl.innerHTML = window.Icons ? window.Icons.get('sparkles', 'tab-icon', 13) : '•';
    }
    tabEl.appendChild(iconEl);

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title || (tab.url === 'about:blank' ? 'New Tab' : tab.url);
    titleEl.title = `${tab.title || 'Tab'} (${tab.url})`;
    tabEl.appendChild(titleEl);

    // Audio / Mute Button
    if (tab.muted || tab.has_audio) {
      const audioBtn = document.createElement('button');
      audioBtn.className = 'tab-audio-btn';
      audioBtn.title = tab.muted ? 'Unmute tab' : 'Mute tab';
      audioBtn.innerHTML = window.Icons
        ? window.Icons.get(tab.muted ? 'volume-mute' : 'volume', '', 12)
        : (tab.muted ? '🔇' : '🔊');
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.bridge.send('mute_tab', { tab_id: tab.id, muted: !tab.muted });
      });
      tabEl.appendChild(audioBtn);
    }

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

    // Click: Switch or Wake
    tabEl.addEventListener('click', () => {
      if (tab.sleeping) {
        window.bridge.send('wake_tab', { tab_id: tab.id });
      } else {
        window.bridge.send('switch_tab', { tab_id: tab.id });
      }
    });

    // Right-click: Context Menu
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, tab.id);
    });

    // Drag and Drop Handlers
    attachTabDragHandlers(tabEl, tab.id, isVertical);

    return tabEl;
  }

  // ── 7. Drag and Drop Reordering Handlers ──────────────────────────────────
  function attachTabDragHandlers(tabEl, tabId, isVertical) {
    tabEl.addEventListener('dragstart', (e) => {
      draggedTabId = tabId;
      tabEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(tabId));
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedTabId || draggedTabId === tabId) return;

      const rect = tabEl.getBoundingClientRect();
      const isBefore = isVertical
        ? (e.clientY - rect.top < rect.height / 2)
        : (e.clientX - rect.left < rect.width / 2);

      tabEl.classList.toggle('drop-target-before', isBefore);
      tabEl.classList.toggle('drop-target-after', !isBefore);
      e.dataTransfer.dropEffect = 'move';
    });

    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('drop-target-before', 'drop-target-after');
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      tabEl.classList.remove('drop-target-before', 'drop-target-after');
      if (!draggedTabId || draggedTabId === tabId) return;

      const rect = tabEl.getBoundingClientRect();
      const position = isVertical
        ? (e.clientY - rect.top < rect.height / 2 ? 'before' : 'after')
        : (e.clientX - rect.left < rect.width / 2 ? 'before' : 'after');

      window.bridge.send('reorder_tabs', {
        from_id: draggedTabId,
        to_id: tabId,
        position
      });
      draggedTabId = null;
    });

    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging', 'drop-target-before', 'drop-target-after');
      draggedTabId = null;
    });
  }

  // ── 8. Tab Context Menu ──────────────────────────────────────────────────
  function openContextMenu(x, y, tabId) {
    if (!contextMenu) return;
    contextMenuTargetTabId = tabId;
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab) return;

    contextMenu.innerHTML = '';

    // Menu Item Builder
    function addItem(label, iconName, shortcut, onClick, isDanger = false) {
      const item = document.createElement('div');
      item.className = `context-item ${isDanger ? 'danger' : ''}`;
      item.innerHTML = `
        ${window.Icons ? window.Icons.get(iconName, '', 13) : ''}
        <span class="menu-label">${label}</span>
        ${shortcut ? `<span class="menu-shortcut">${shortcut}</span>` : ''}
      `;
      item.addEventListener('click', () => {
        closeContextMenu();
        onClick();
      });
      contextMenu.appendChild(item);
    }

    function addSeparator() {
      const sep = document.createElement('div');
      sep.className = 'context-separator';
      contextMenu.appendChild(sep);
    }

    // Pin / Unpin
    addItem(tab.pinned ? 'Unpin tab' : 'Pin tab', tab.pinned ? 'unpin' : 'pin', '', () => {
      window.bridge.send('pin_tab', { tab_id: tab.id, pinned: !tab.pinned });
    });

    // Mute / Unmute
    addItem(tab.muted ? 'Unmute tab' : 'Mute tab', tab.muted ? 'volume' : 'volume-mute', '', () => {
      window.bridge.send('mute_tab', { tab_id: tab.id, muted: !tab.muted });
    });

    // Duplicate
    addItem('Duplicate tab', 'copy', '', () => {
      window.bridge.send('duplicate_tab', { tab_id: tab.id });
    });

    // Discard / Sleep (Memory Saver)
    if (!tab.sleeping) {
      addItem('Sleep tab (Free RAM)', 'moon', '', () => {
        window.bridge.send('sleep_tab', { tab_id: tab.id });
      });
    } else {
      addItem('Wake tab', 'sparkles', '', () => {
        window.bridge.send('wake_tab', { tab_id: tab.id });
      });
    }

    addSeparator();

    // Add to Tab Group Submenu
    const groupSubWrap = document.createElement('div');
    groupSubWrap.className = 'context-item context-submenu-wrap';
    groupSubWrap.innerHTML = `
      ${window.Icons ? window.Icons.get('folder', '', 13) : ''}
      <span class="menu-label">Add tab to group</span>
      <span class="menu-shortcut">▶</span>
    `;

    const submenu = document.createElement('div');
    submenu.className = 'context-submenu';

    currentGroups.forEach((g) => {
      const gItem = document.createElement('div');
      gItem.className = 'context-item';
      gItem.innerHTML = `
        <span class="tab-group-dot" style="background-color: ${g.color};"></span>
        <span class="menu-label">${g.name}</span>
      `;
      gItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeContextMenu();
        window.bridge.send('set_tab_group', { tab_id: tab.id, group_id: g.id });
      });
      submenu.appendChild(gItem);
    });

    // "+ New Group..."
    const newGItem = document.createElement('div');
    newGItem.className = 'context-item';
    newGItem.innerHTML = `
      ${window.Icons ? window.Icons.get('plus', '', 12) : '+'}
      <span class="menu-label">New Group...</span>
    `;
    newGItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      const name = prompt('Group Name (e.g. Research, Project):');
      if (name) {
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        window.bridge.send('create_group', { name, color, tab_id: tab.id });
      }
    });
    submenu.appendChild(newGItem);
    groupSubWrap.appendChild(submenu);
    contextMenu.appendChild(groupSubWrap);

    // Remove from group
    if (tab.group_id) {
      addItem('Remove from group', 'close', '', () => {
        window.bridge.send('set_tab_group', { tab_id: tab.id, group_id: null });
      });
    }

    addSeparator();

    // Close options
    addItem('Close other tabs', 'close', '', () => {
      window.bridge.send('close_other_tabs', { tab_id: tab.id });
    });

    addItem('Close tabs below / right', 'arrow-right', '', () => {
      window.bridge.send('close_tabs_below', { tab_id: tab.id });
    });

    addItem('Close tab', 'trash', 'Ctrl+W', () => {
      window.bridge.send('close_tab', { tab_id: tab.id });
    }, true);

    // Clamp coordinates
    contextMenu.classList.add('open');
    const menuWidth = 190;
    const menuHeight = contextMenu.offsetHeight || 220;
    const posX = Math.min(x, window.innerWidth - menuWidth - 8);
    const posY = Math.min(y, window.innerHeight - menuHeight - 8);

    contextMenu.style.left = `${posX}px`;
    contextMenu.style.top = `${posY}px`;
  }

  function closeContextMenu() {
    if (!contextMenu) return;
    contextMenu.classList.remove('open');
    contextMenuTargetTabId = null;
  }

  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  // ── 9. State Update Listener from Bridge ─────────────────────────────────
  window.bridge.on('state_update', (data) => {
    if (data.groups) {
      currentGroups = data.groups;
    }
    if (data.bookmarks) {
      currentBookmarks = data.bookmarks;
    }
    if (data.history) {
      currentHistory = data.history;
    }

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

  // ── 10. Memory Badge Updates ─────────────────────────────────────────────
  function updateMemoryBadge(mem) {
    if (!memoryText) return;
    const mb = mem.total_mb ? `${mem.total_mb.toFixed(0)} MB` : '85 MB';
    memoryText.textContent = mb;
    if (mem.savings_percent && memoryBadge) {
      memoryBadge.title = `Total RAM: ${mem.total_mb} MB (${mem.savings_percent}% less memory than Chrome baseline)`;
    }
  }

  window.bridge.on('memory_stats', updateMemoryBadge);

  // ── 11. Mock Viewport Iframe for standalone browser preview ──────────────
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

  // ── 12. Command Palette (Ctrl+K) with Multi-Source Fuzzy Search ───────────
  let paletteSelectedIndex = 0;
  let paletteItems = [];

  const BASE_COMMANDS = [
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
    { title: 'Toggle Compact Sidebar', action: () => btnCollapseSidebar && btnCollapseSidebar.click(), badge: 'Layout' },
    { title: 'Sleep Other Tabs (Reclaim RAM)', action: () => {
      currentTabs.forEach((t) => {
        if (!t.active && !t.pinned && !t.sleeping) {
          window.bridge.send('sleep_tab', { tab_id: t.id });
        }
      });
    }, badge: 'Memory' },
    { title: 'New Tab', action: handleNewTab, badge: 'Tabs' },
    { title: 'New Tab Group', action: () => {
      const name = prompt('New Group Name:');
      if (name) window.bridge.send('create_group', { name });
    }, badge: 'Tabs' },
    { title: 'Bookmark Current Tab', action: () => window.bridge.send('toggle_bookmark', { url: activeUrl }), badge: 'Bookmarks' },
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
    paletteSelectedIndex = 0;
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
    const q = query.trim().toLowerCase();
    paletteItems = [];

    // Helper to add section header
    function addHeader(label) {
      const h = document.createElement('div');
      h.className = 'palette-section-header';
      h.textContent = label;
      paletteResults.appendChild(h);
    }

    // 1. Commands
    const filteredCmds = BASE_COMMANDS.filter((c) => c.title.toLowerCase().includes(q));
    if (filteredCmds.length > 0) {
      addHeader('Commands');
      filteredCmds.forEach((cmd) => {
        paletteItems.push({
          type: 'command',
          title: cmd.title,
          badge: cmd.badge,
          action: cmd.action
        });
      });
    }

    // 2. Open Tabs
    const filteredTabs = currentTabs.filter((t) =>
      t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)
    );
    if (filteredTabs.length > 0) {
      addHeader('Open Tabs');
      filteredTabs.forEach((tab) => {
        paletteItems.push({
          type: 'tab',
          title: tab.title,
          sub: tab.url,
          badge: tab.sleeping ? 'Asleep' : 'Tab',
          action: () => {
            if (tab.sleeping) window.bridge.send('wake_tab', { tab_id: tab.id });
            else window.bridge.send('switch_tab', { tab_id: tab.id });
          }
        });
      });
    }

    // 3. Bookmarks
    const filteredBms = currentBookmarks.filter((b) =>
      b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    );
    if (filteredBms.length > 0) {
      addHeader('Bookmarks');
      filteredBms.forEach((b) => {
        paletteItems.push({
          type: 'bookmark',
          title: b.title,
          sub: b.url,
          badge: 'Bookmark',
          action: () => window.bridge.send('navigate', { url: b.url })
        });
      });
    }

    // 4. History
    const filteredHist = currentHistory.filter((h) =>
      h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
    );
    if (filteredHist.length > 0) {
      addHeader('History');
      filteredHist.forEach((h) => {
        paletteItems.push({
          type: 'history',
          title: h.title,
          sub: h.url,
          badge: 'History',
          action: () => window.bridge.send('navigate', { url: h.url })
        });
      });
    }

    if (paletteItems.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '16px';
      empty.style.color = 'var(--text-muted)';
      empty.style.textAlign = 'center';
      empty.style.fontSize = 'var(--font-size-sm)';
      empty.textContent = 'No matching commands or pages';
      paletteResults.appendChild(empty);
      return;
    }

    if (paletteSelectedIndex >= paletteItems.length) {
      paletteSelectedIndex = 0;
    }

    paletteItems.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = `palette-item ${index === paletteSelectedIndex ? 'selected' : ''}`;
      el.dataset.index = index;
      el.innerHTML = `
        <span class="item-title">${item.title}</span>
        ${item.sub ? `<span class="item-sub">${item.sub}</span>` : ''}
        <span class="item-badge">${item.badge}</span>
      `;
      el.addEventListener('click', () => {
        closeCommandPalette();
        item.action();
      });
      paletteResults.appendChild(el);
    });
  }

  function updatePaletteSelection() {
    if (!paletteResults) return;
    const items = paletteResults.querySelectorAll('.palette-item');
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === paletteSelectedIndex);
      if (i === paletteSelectedIndex) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  if (btnPalette) btnPalette.addEventListener('click', openCommandPalette);

  if (paletteInput) {
    paletteInput.addEventListener('input', (e) => {
      paletteSelectedIndex = 0;
      renderPaletteResults(e.target.value);
    });

    paletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeCommandPalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paletteItems.length > 0) {
          paletteSelectedIndex = (paletteSelectedIndex + 1) % paletteItems.length;
          updatePaletteSelection();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paletteItems.length > 0) {
          paletteSelectedIndex = (paletteSelectedIndex - 1 + paletteItems.length) % paletteItems.length;
          updatePaletteSelection();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (paletteItems[paletteSelectedIndex]) {
          closeCommandPalette();
          paletteItems[paletteSelectedIndex].action();
        }
      }
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeCommandPalette();
    });
  }

  // ── 13. Global Keyboard Accelerators ─────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    // Ctrl+K -> Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOverlayOpen) closeCommandPalette();
      else openCommandPalette();
    }
    // Ctrl+Shift+V -> Toggle Vertical / Horizontal Tabs
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (window.toggleTabsLayout) window.toggleTabsLayout();
    }
    // Ctrl+B -> Toggle Sidebar Collapse
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      if (btnCollapseSidebar) btnCollapseSidebar.click();
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
    // Escape -> Close Context Menu or Palette
    else if (e.key === 'Escape') {
      closeContextMenu();
      if (isOverlayOpen) closeCommandPalette();
    }
  });

  // Initial layout report
  setTimeout(reportContentRect, 100);
})();
