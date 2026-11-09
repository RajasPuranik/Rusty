// Chrome UI Controller: Complete management of navigation, tabs, panels, find-bar, zen-mode, and settings
(function () {
  'use strict';

  let currentTabs = [];
  let currentGroups = [];
  let currentBookmarks = [];
  let currentHistory = [];
  let currentDownloads = [];
  let activeTabId = null;
  let activeUrl = 'about:blank';
  let isOverlayOpen = false;
  let activeSidePanel = null; // 'bookmarks' | 'history' | 'downloads' | null
  let isFindOpen = false;
  let isZenMode = false;
  let isReaderActive = false;
  let contextMenuTargetTabId = null;
  let draggedTabId = null;
  let lastMemoryInfo = null;
  let lastTelemetryInfo = null;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHexColor(color) {
    return typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#3b82f6';
  }

  // DOM Elements
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');
  const btnToggleTabs = document.getElementById('btn-toggle-tabs');
  const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
  const omniboxInput = document.getElementById('omnibox-input');
  const omniboxSecurity = document.getElementById('omnibox-security');
  const btnStar = document.getElementById('btn-star');
  const btnReader = document.getElementById('btn-reader');
  const btnSplitView = document.getElementById('btn-split-view');
  const btnZen = document.getElementById('btn-zen');
  const btnSettings = document.getElementById('btn-settings');
  const btnFind = document.getElementById('btn-find');
  const btnPanelBookmarks = document.getElementById('btn-sidepanel-bookmarks');
  const btnPanelHistory = document.getElementById('btn-sidepanel-history');
  const btnPanelDownloads = document.getElementById('btn-sidepanel-downloads');
  const memoryBadge = document.getElementById('memory-badge');
  const memoryText = document.getElementById('memory-text');
  const btnPalette = document.getElementById('btn-palette');
  const tabsContainerH = document.getElementById('tabs-horizontal-list');
  const tabsContainerV = document.getElementById('tabs-sidebar-list');
  const btnNewTabH = document.getElementById('btn-new-tab-h');
  const btnNewTabV = document.getElementById('btn-new-tab-v');
  const viewport = document.getElementById('content-viewport');
  const modalOverlay = document.getElementById('modal-overlay');
  const commandPalette = document.getElementById('command-palette');
  const paletteInput = document.getElementById('palette-input');
  const paletteResults = document.getElementById('palette-results');
  const settingsModal = document.getElementById('settings-modal');
  const settingsCloseBtn = document.getElementById('settings-close-btn');
  const contextMenu = document.getElementById('tab-context-menu');

  // Find Bar Elements
  const findBar = document.getElementById('find-bar');
  const findInput = document.getElementById('find-input');
  const findMatchCount = document.getElementById('find-match-count');
  const findPrev = document.getElementById('find-prev');
  const findNext = document.getElementById('find-next');
  const findCase = document.getElementById('find-case-sensitive');
  const findClose = document.getElementById('find-close');

  // Side Panel Elements
  const sidePanel = document.getElementById('side-panel');
  const panelHeading = document.getElementById('panel-heading');
  const panelIcon = document.getElementById('panel-icon');
  const panelActionBtn = document.getElementById('panel-action-btn');
  const panelCloseBtn = document.getElementById('panel-close-btn');
  const panelSearchInput = document.getElementById('panel-search-input');
  const panelContent = document.getElementById('panel-content');

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
          handleAddressNavigation(query);
          omniboxInput.blur();
        }
      } else if (e.key === 'Escape') {
        const isNewTab = !activeUrl || activeUrl === 'about:blank' || activeUrl === 'about:newtab' || activeUrl.includes('newtab.html');
        omniboxInput.value = isNewTab ? '' : activeUrl;
        omniboxInput.blur();
      }
    });

    omniboxInput.addEventListener('focus', () => {
      omniboxInput.select();
    });
  }

  function handleAddressNavigation(query) {
    if (query === 'about:settings') {
      openSettings();
      return;
    }
    if (query === 'about:bookmarks') {
      openSidePanel('bookmarks');
      return;
    }
    if (query === 'about:history') {
      openSidePanel('history');
      return;
    }
    if (query === 'about:downloads') {
      openSidePanel('downloads');
      return;
    }
    window.bridge.send('navigate', { url: query });
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
      if (window.toggleTabsLayout) window.toggleTabsLayout();
    });
  }

  if (btnCollapseSidebar) {
    btnCollapseSidebar.addEventListener('click', () => {
      const root = document.documentElement;
      const isCollapsed = root.getAttribute('data-sidebar-collapsed') === 'true';
      const next = !isCollapsed;
      if (next) root.setAttribute('data-sidebar-collapsed', 'true');
      else root.removeAttribute('data-sidebar-collapsed');

      if (window.Settings) window.Settings.set('vertical_collapsed', next);
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

    // 6.1 Pinned Tabs
    if (pinnedTabs.length > 0) {
      const pinnedWrap = document.createElement('div');
      pinnedWrap.className = 'pinned-tabs-wrap';
      pinnedTabs.forEach((tab) => pinnedWrap.appendChild(createTabElement(tab, isVertical)));
      container.appendChild(pinnedWrap);
    }

    // 6.2 Tab Groups
    const renderedGroupIds = new Set();
    currentGroups.forEach((group) => {
      const groupTabs = unpinnedTabs.filter((t) => t.group_id === group.id);
      if (groupTabs.length === 0) return;
      renderedGroupIds.add(group.id);

      const groupContainer = document.createElement('div');
      groupContainer.className = `tab-group-container ${group.collapsed ? 'collapsed' : ''}`;
      groupContainer.dataset.groupId = group.id;

      const grpColor = safeHexColor(group.color);
      const header = document.createElement('div');
      header.className = `tab-group-header ${group.collapsed ? 'collapsed' : ''}`;
      header.style.backgroundColor = `${grpColor}22`;
      header.style.borderColor = grpColor;
      header.style.color = grpColor;

      const dot = document.createElement('span');
      dot.className = 'tab-group-dot';
      dot.style.backgroundColor = grpColor;
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

      groupTabs.forEach((tab) => {
        groupContainer.appendChild(createTabElement(tab, isVertical));
      });

      container.appendChild(groupContainer);
    });

    // 6.3 Unassigned Tabs
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
        if (window.fxTabPoof) {
          window.fxTabPoof(e.clientX, e.clientY);
        }
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

    // Drag and Drop
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
        <span class="tab-group-dot" style="background-color: ${safeHexColor(g.color)};"></span>
        <span class="menu-label">${escapeHtml(g.name)}</span>
      `;
      gItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeContextMenu();
        window.bridge.send('set_tab_group', { tab_id: tab.id, group_id: g.id });
      });
      submenu.appendChild(gItem);
    });

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

    // Position menu
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

  // ── 9. Find in Page Bar (Pushes Content Down, Zero Overlay) ───────────────
  function openFindBar() {
    if (!findBar) return;
    isFindOpen = true;
    findBar.classList.add('open');
    reportContentRect();
    if (findInput) {
      findInput.select();
      findInput.focus();
    }
  }

  function closeFindBar() {
    if (!findBar) return;
    isFindOpen = false;
    findBar.classList.remove('open');
    reportContentRect();
  }

  if (btnFind) btnFind.addEventListener('click', () => (isFindOpen ? closeFindBar() : openFindBar()));
  if (findClose) findClose.addEventListener('click', closeFindBar);

  if (findInput) {
    findInput.addEventListener('input', () => {
      const q = findInput.value.trim();
      const matchCase = findCase ? findCase.checked : false;
      if (q) {
        window.bridge.send('find_in_page', { query: q, forward: true, match_case: matchCase });
        if (findMatchCount) findMatchCount.textContent = '1/3';
      } else {
        if (findMatchCount) findMatchCount.textContent = '0/0';
      }
    });

    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = findInput.value.trim();
        const matchCase = findCase ? findCase.checked : false;
        window.bridge.send('find_in_page', { query: q, forward: !e.shiftKey, match_case: matchCase });
      } else if (e.key === 'Escape') {
        closeFindBar();
      }
    });
  }

  if (findNext) {
    findNext.addEventListener('click', () => {
      const q = findInput ? findInput.value.trim() : '';
      if (q) window.bridge.send('find_in_page', { query: q, forward: true, match_case: findCase && findCase.checked });
    });
  }
  if (findPrev) {
    findPrev.addEventListener('click', () => {
      const q = findInput ? findInput.value.trim() : '';
      if (q) window.bridge.send('find_in_page', { query: q, forward: false, match_case: findCase && findCase.checked });
    });
  }

  // ── 10. Side Panels (Bookmarks, History, Downloads - Takes Layout Space) ──
  function openSidePanel(type) {
    if (!sidePanel) return;
    if (activeSidePanel === type) {
      closeSidePanel();
      return;
    }
    activeSidePanel = type;
    sidePanel.classList.add('open');
    renderSidePanel();
    reportContentRect();
  }

  function closeSidePanel() {
    if (!sidePanel) return;
    activeSidePanel = null;
    sidePanel.classList.remove('open');
    reportContentRect();
  }

  if (btnPanelBookmarks) btnPanelBookmarks.addEventListener('click', () => openSidePanel('bookmarks'));
  if (btnPanelHistory) btnPanelHistory.addEventListener('click', () => openSidePanel('history'));
  if (btnPanelDownloads) btnPanelDownloads.addEventListener('click', () => openSidePanel('downloads'));
  if (panelCloseBtn) panelCloseBtn.addEventListener('click', closeSidePanel);

  function renderSidePanel() {
    if (!sidePanel || !panelContent) return;
    panelContent.innerHTML = '';
    const q = panelSearchInput ? panelSearchInput.value.toLowerCase().trim() : '';

    if (activeSidePanel === 'bookmarks') {
      if (panelHeading) panelHeading.textContent = 'Bookmarks';
      if (panelIcon) panelIcon.innerHTML = window.Icons ? window.Icons.get('bookmark', '', 16) : '';
      if (panelActionBtn) {
        panelActionBtn.style.display = 'inline-flex';
        panelActionBtn.innerHTML = window.Icons ? window.Icons.get('plus', '', 14) : '+';
        panelActionBtn.title = 'Add Bookmark';
        panelActionBtn.onclick = () => window.bridge.send('toggle_bookmark', { url: activeUrl });
      }

      const filtered = currentBookmarks.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
      if (filtered.length === 0) {
        panelContent.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">No bookmarks found</div>';
        return;
      }

      filtered.forEach((b) => {
        const item = document.createElement('div');
        item.className = 'panel-item';
        item.innerHTML = `
          ${window.Icons ? window.Icons.get('star', '', 13) : '★'}
          <div class="item-title">${escapeHtml(b.title || b.url)}</div>
          <button class="btn-icon" title="Remove" style="width: 20px; height: 20px;">
            ${window.Icons ? window.Icons.get('close', '', 10) : '×'}
          </button>
        `;
        item.addEventListener('click', () => window.bridge.send('navigate', { url: b.url }));
        const removeBtn = item.querySelector('button');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.bridge.send('toggle_bookmark', { url: b.url });
        });
        panelContent.appendChild(item);
      });
    } else if (activeSidePanel === 'history') {
      if (panelHeading) panelHeading.textContent = 'History';
      if (panelIcon) panelIcon.innerHTML = window.Icons ? window.Icons.get('history', '', 16) : '';
      if (panelActionBtn) {
        panelActionBtn.style.display = 'inline-flex';
        panelActionBtn.innerHTML = window.Icons ? window.Icons.get('trash', '', 13) : '🗑';
        panelActionBtn.title = 'Clear Browsing History';
        panelActionBtn.onclick = () => {
          if (confirm('Clear all browsing history?')) {
            window.bridge.send('clear_browsing_data', { history: true });
          }
        };
      }

      const filtered = currentHistory.filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q));
      if (filtered.length === 0) {
        panelContent.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">No history records</div>';
        return;
      }

      // Group into Today / Earlier
      const todayGroup = document.createElement('div');
      todayGroup.className = 'history-group-header';
      todayGroup.textContent = 'Recent Visits';
      panelContent.appendChild(todayGroup);

      filtered.forEach((h) => {
        const item = document.createElement('div');
        item.className = 'panel-item';
        item.innerHTML = `
          ${window.Icons ? window.Icons.get('clock', '', 13) : '🕒'}
          <div style="flex: 1; overflow: hidden;">
            <div class="item-title">${escapeHtml(h.title || h.url)}</div>
            <div class="item-sub">${escapeHtml(h.url)}</div>
          </div>
        `;
        item.addEventListener('click', () => window.bridge.send('navigate', { url: h.url }));
        panelContent.appendChild(item);
      });
    } else if (activeSidePanel === 'downloads') {
      if (panelHeading) panelHeading.textContent = 'Downloads';
      if (panelIcon) panelIcon.innerHTML = window.Icons ? window.Icons.get('download', '', 16) : '';
      if (panelActionBtn) panelActionBtn.style.display = 'none';

      const dls = currentDownloads;
      if (dls.length === 0) {
        panelContent.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">No downloads yet</div>';
        return;
      }

      dls.forEach((dl) => {
        const pct = Math.max(0, Math.min(100, Number(dl.progress) || 0));
        const card = document.createElement('div');
        card.className = 'download-card';
        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 500;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;">${escapeHtml(dl.filename)}</span>
            <span style="color: var(--text-muted); font-size: 11px;">${pct}%</span>
          </div>
          <div class="download-progress-bar">
            <div class="download-progress-fill" style="width: ${pct}%;"></div>
          </div>
          <div class="download-actions">
            <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(dl.state || 'completed')}</span>
          </div>
        `;
        panelContent.appendChild(card);
      });
    }
  }

  if (panelSearchInput) {
    panelSearchInput.addEventListener('input', renderSidePanel);
  }

  // ── 11. Zen / Focus Mode & Feature Buttons ───────────────────────────────
  if (btnZen) {
    btnZen.addEventListener('click', toggleZenMode);
  }

  function toggleZenMode() {
    isZenMode = !isZenMode;
    const root = document.documentElement;
    if (isZenMode) root.setAttribute('data-zen', 'true');
    else root.removeAttribute('data-zen');
    reportContentRect();
  }

  // Hover strip for Zen mode
  const zenTrigger = document.getElementById('zen-hover-trigger');
  if (zenTrigger) {
    zenTrigger.addEventListener('mouseenter', () => {
      if (isZenMode) {
        const header = document.getElementById('chrome-header');
        if (header) header.style.display = 'flex';
      }
    });
  }

  // Split view button
  if (btnSplitView) {
    btnSplitView.addEventListener('click', () => {
      alert('Split View is configured in the UI layer (needs Rust multi-view support).');
      window.bridge.send('split_view');
    });
  }

  // Reader mode button
  if (btnReader) {
    btnReader.addEventListener('click', () => {
      isReaderActive = !isReaderActive;
      btnReader.classList.toggle('active', isReaderActive);
      window.bridge.send('toggle_reader', { active: isReaderActive });
    });
  }

  // ── 12. Full Settings Page / Modal (Ctrl+, or about:settings) ────────────
  function openSettings() {
    if (!modalOverlay || !settingsModal) return;
    isOverlayOpen = true;
    modalOverlay.classList.add('open');
    if (commandPalette) commandPalette.style.display = 'none';
    settingsModal.style.display = 'flex';
    window.bridge.send('overlay', { open: true });
    populateSettingsUI();
  }

  function closeSettings() {
    if (!modalOverlay || !settingsModal) return;
    isOverlayOpen = false;
    modalOverlay.classList.remove('open');
    settingsModal.style.display = 'none';
    window.bridge.send('overlay', { open: false });
  }

  if (btnSettings) btnSettings.addEventListener('click', openSettings);
  if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);

  const THEMES_LIST = [
    { id: 'midnight', name: 'Midnight', dot: '#8ab4f8' },
    { id: 'light', name: 'Light', dot: '#1a73e8' },
    { id: 'amoled', name: 'AMOLED', dot: '#3b82f6' },
    { id: 'aurora', name: 'Aurora', dot: '#2dd4bf' },
    { id: 'cyberpunk', name: 'Cyberpunk', dot: '#facc15' },
    { id: 'sunset', name: 'Sunset', dot: '#f97316' },
    { id: 'matcha', name: 'Matcha', dot: '#4ade80' },
    { id: 'sakura', name: 'Sakura', dot: '#f472b6' }
  ];

  function populateSettingsUI() {
    const root = document.documentElement;
    const currentSkin = root.getAttribute('data-skin') || 'minimal';
    const currentTheme = root.getAttribute('data-theme') || 'midnight';

    // Skin Cards
    const cardMin = document.getElementById('skin-card-minimal');
    const cardCrz = document.getElementById('skin-card-crazy');
    const badgeMin = document.getElementById('badge-minimal');
    const badgeCrz = document.getElementById('badge-crazy');

    if (cardMin && cardCrz) {
      cardMin.classList.toggle('active', currentSkin === 'minimal');
      cardCrz.classList.toggle('active', currentSkin === 'crazy');
      if (badgeMin) badgeMin.style.display = currentSkin === 'minimal' ? 'inline-block' : 'none';
      if (badgeCrz) badgeCrz.style.display = currentSkin === 'crazy' ? 'inline-block' : 'none';

      cardMin.onclick = () => {
        closeSettings();
        window.switchSkin('minimal');
      };
      cardCrz.onclick = () => {
        closeSettings();
        window.switchSkin('crazy');
      };
    }

    // Themes Grid
    const themesGrid = document.getElementById('themes-grid');
    if (themesGrid) {
      themesGrid.innerHTML = '';
      THEMES_LIST.forEach((thm) => {
        const swatch = document.createElement('div');
        swatch.className = `theme-swatch ${thm.id === currentTheme ? 'active' : ''}`;
        swatch.innerHTML = `
          <span class="theme-swatch-dot" style="background-color: ${thm.dot};"></span>
          <span>${escapeHtml(thm.name)}</span>
        `;
        swatch.addEventListener('click', () => {
          window.switchTheme(thm.id);
          populateSettingsUI();
        });
        themesGrid.appendChild(swatch);
      });
    }

    // Custom Accent Picker
    const accentPicker = document.getElementById('custom-accent-picker');
    if (accentPicker) {
      const savedAccent = window.Settings ? window.Settings.get('custom_accent') : '#f97316';
      if (savedAccent && /^#[0-9a-fA-F]{6}$/.test(savedAccent)) {
        accentPicker.value = savedAccent;
      }
      accentPicker.oninput = (e) => applyCustomAccent(e.target.value);
    }

    // Layout Dropdown
    const selLayout = document.getElementById('setting-tabs-layout');
    if (selLayout) {
      selLayout.value = root.getAttribute('data-tabs') || 'horizontal';
      selLayout.onchange = () => {
        if (window.Settings) window.Settings.set('tabs_layout', selLayout.value);
        root.setAttribute('data-tabs', selLayout.value);
        window.dispatchEvent(new CustomEvent('tabs-layout-changed'));
      };
    }

    // UI Density Dropdown
    const selDensity = document.getElementById('setting-density');
    if (selDensity) {
      selDensity.value = (window.Settings && window.Settings.get('density')) || 'normal';
      selDensity.onchange = () => {
        if (window.Settings) window.Settings.set('density', selDensity.value);
        root.setAttribute('data-density', selDensity.value);
        setTimeout(reportContentRect, 50);
      };
    }

    // Effects Intensity Slider
    const fxSlider = document.getElementById('setting-effects-intensity');
    const fxVal = document.getElementById('effects-intensity-val');
    if (fxSlider && fxVal) {
      const saved = window.Settings ? window.Settings.get('effects_intensity') : 80;
      fxSlider.value = saved !== undefined ? saved : 80;
      fxVal.textContent = `${fxSlider.value}%`;
      fxSlider.oninput = (e) => {
        fxVal.textContent = `${e.target.value}%`;
        if (window.Settings) window.Settings.set('effects_intensity', Number(e.target.value));
      };
    }

    // Individual Effects Toggles
    const fxToggles = [
      { id: 'setting-fx-glow', key: 'fx_glow' },
      { id: 'setting-fx-tilt', key: 'fx_tilt' },
      { id: 'setting-fx-magnetic', key: 'fx_magnetic' },
      { id: 'setting-fx-ripple', key: 'fx_ripple' },
      { id: 'setting-fx-trail', key: 'fx_trail' },
      { id: 'setting-fx-confetti', key: 'fx_confetti' },
      { id: 'setting-fx-canvas-bg', key: 'fx_canvas_bg' },
      { id: 'setting-ntp-clock', key: 'ntp_show_clock' },
      { id: 'setting-ntp-greeting', key: 'ntp_show_greeting' },
      { id: 'setting-ntp-speed-dial', key: 'ntp_show_speed_dial' },
      { id: 'setting-ntp-notes', key: 'ntp_show_notes' },
      { id: 'setting-ntp-weather', key: 'ntp_show_weather' },
      { id: 'setting-show-memory', key: 'show_memory_badge' }
    ];

    fxToggles.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (el && window.Settings) {
        const val = window.Settings.get(key);
        el.checked = val !== undefined ? Boolean(val) : el.checked;
        el.onchange = () => {
          window.Settings.set(key, el.checked);
          if (key === 'show_memory_badge' && memoryBadge) {
            memoryBadge.style.display = el.checked ? 'inline-flex' : 'none';
          }
        };
      }
    });

    // Search Engine Dropdown
    const selEngine = document.getElementById('setting-search-engine');
    if (selEngine) {
      selEngine.value = window.Settings ? window.Settings.get('default_search') || 'google' : 'google';
      selEngine.onchange = () => {
        if (window.Settings) window.Settings.set('default_search', selEngine.value);
        updateOmniboxPlaceholder(selEngine.value);
      };
    }

    // Memory Discard Timeout
    const selMemTimeout = document.getElementById('setting-memory-timeout');
    if (selMemTimeout) {
      const memTimeoutVal = window.Settings ? window.Settings.get('memory_saver_timeout_secs') : undefined;
      selMemTimeout.value = String(memTimeoutVal !== undefined ? memTimeoutVal : 600);
      selMemTimeout.onchange = () => {
        if (window.Settings) window.Settings.set('memory_saver_timeout_secs', Number(selMemTimeout.value));
      };
    }

    // Clear buttons
    const btnClrHist = document.getElementById('btn-clear-history');
    if (btnClrHist) {
      btnClrHist.onclick = () => {
        if (confirm('Delete all recorded history?')) {
          window.bridge.send('clear_browsing_data', { history: true });
          alert('Browsing history cleared.');
        }
      };
    }

    const btnClrCache = document.getElementById('btn-clear-cache');
    if (btnClrCache) {
      btnClrCache.onclick = () => {
        if (confirm('Clear cache and cookies?')) {
          window.bridge.send('clear_browsing_data', { cache: true });
          alert('Cache and cookies cleared.');
        }
      };
    }
  }

  function updateOmniboxPlaceholder(engineId) {
    if (!omniboxInput) return;
    const names = {
      google: 'Google',
      duckduckgo: 'DuckDuckGo',
      bing: 'Bing',
      brave: 'Brave Search',
      youtube: 'YouTube',
      github: 'GitHub'
    };
    const label = names[engineId] || 'Google';
    omniboxInput.placeholder = `Search with ${label} or enter address`;
  }

  // Automatic secondary accent calculation
  function applyCustomAccent(hex) {
    if (window.__applyAccentCss) {
      window.__applyAccentCss(hex);
    }
    if (window.Settings) {
      window.Settings.setMany({ custom_accent: hex, use_custom_accent: true });
    }
  }

  function applyHostSettingsToChrome(s) {
    if (!s || typeof s !== 'object') return;
    const root = document.documentElement;
    if (s.theme) root.setAttribute('data-theme', s.theme);
    if (s.tabs_layout) root.setAttribute('data-tabs', s.tabs_layout === 'vertical' ? 'vertical' : 'horizontal');
    if (s.vertical_collapsed !== undefined) {
      if (s.vertical_collapsed) root.setAttribute('data-sidebar-collapsed', 'true');
      else root.removeAttribute('data-sidebar-collapsed');
    }
    if (s.density) root.setAttribute('data-density', s.density);
    if (window.__applyAccentCss) {
      window.__applyAccentCss(s.use_custom_accent && s.custom_accent ? s.custom_accent : null);
    }
    if (s.show_memory_badge !== undefined && memoryBadge) {
      memoryBadge.style.display = s.show_memory_badge ? 'inline-flex' : 'none';
    }
    if (s.default_search) {
      updateOmniboxPlaceholder(s.default_search);
    }
    if (settingsModal && settingsModal.style.display === 'flex') {
      populateSettingsUI();
    }
  }

  // Initialize from loaded Settings
  if (window.Settings && window.Settings.data) {
    applyHostSettingsToChrome(window.Settings.data);
  }

  window.bridge.on('ui_settings_sync', (data) => {
    if (!data || !data.settings) return;
    if (window.Settings && typeof window.Settings.syncFromHost === 'function') {
      window.Settings.syncFromHost(data.settings);
    }
    const currentSkin = document.documentElement.getAttribute('data-skin');
    if (!window.__isSwitchingSkin && data.settings.skin && data.settings.skin !== currentSkin && window.switchSkin) {
      window.switchSkin(data.settings.skin);
      return;
    }
    applyHostSettingsToChrome(data.settings);
    setTimeout(reportContentRect, 40);
  });

  window.bridge.on('open_settings', openSettings);
  window.bridge.on('open_command_palette', openCommandPalette);
  window.bridge.on('open_side_panel', (data) => openSidePanel((data && data.panel) || 'bookmarks'));
  window.bridge.on('open_find_bar', openFindBar);

  // ── 13. State Update Listener from Bridge ─────────────────────────────────
  window.bridge.on('state_update', (data) => {
    if (data.groups) currentGroups = data.groups;
    if (data.bookmarks) currentBookmarks = data.bookmarks;
    if (data.history) currentHistory = data.history;
    if (data.downloads) currentDownloads = data.downloads;

    if (data.tabs) {
      currentTabs = data.tabs;
      renderTabs(tabsContainerH, false);
      renderTabs(tabsContainerV, true);
    }

    if (data.active_tab !== undefined) activeTabId = data.active_tab;

    if (data.url !== undefined) {
      activeUrl = data.url;
      if (omniboxInput && document.activeElement !== omniboxInput) {
        const isNewTab = !data.url || data.url === 'about:blank' || data.url === 'about:newtab' || data.url.includes('newtab.html');
        omniboxInput.value = isNewTab ? '' : data.url;
      }
      if (omniboxSecurity) {
        const isSecure = data.url.startsWith('https://');
        omniboxSecurity.className = `omnibox-security-icon ${isSecure ? 'secure' : ''}`;
        omniboxSecurity.innerHTML = window.Icons
          ? window.Icons.get(isSecure ? 'lock' : 'lock-open', '', 14)
          : (isSecure ? '🔒' : '🔓');
      }
    }

    if (data.can_go_back !== undefined && btnBack) btnBack.disabled = !data.can_go_back;
    if (data.can_go_forward !== undefined && btnForward) btnForward.disabled = !data.can_go_forward;

    if (data.is_bookmarked !== undefined && btnStar) {
      btnStar.className = `btn-star ${data.is_bookmarked ? 'bookmarked' : ''}`;
      btnStar.innerHTML = window.Icons
        ? window.Icons.get(data.is_bookmarked ? 'star-filled' : 'star', '', 15)
        : (data.is_bookmarked ? '★' : '☆');
    }

    if (data.memory) updateMemoryBadge(data.memory);

    if (window.bridge.isMock && viewport) updateMockViewport(activeUrl);

    if (activeSidePanel) renderSidePanel();

    reportContentRect();
  });

  // ── 14. Memory Badge Updates ─────────────────────────────────────────────
  function refreshMemoryBadgeDisplay() {
    if (!memoryText || !lastMemoryInfo) return;
    const totalMb = lastMemoryInfo.total_mb;
    memoryText.textContent = totalMb ? `${totalMb.toFixed(0)} MB` : '-- MB';
    if (memoryBadge) {
      const parts = [];
      if (totalMb) {
        parts.push(`Browser RAM tree: ${totalMb.toFixed(1)} MB`);
      }
      if (lastMemoryInfo.savings_percent !== undefined) {
        parts.push(`${lastMemoryInfo.savings_percent.toFixed(1)}% less than Chrome baseline`);
      }
      if (lastTelemetryInfo) {
        parts.push(`OS CPU: ${Math.round(lastTelemetryInfo.sys_cpu_percent)}%`);
        parts.push(`OS RAM: ${Math.round(lastTelemetryInfo.sys_ram_percent)}% (${lastTelemetryInfo.sys_ram_used_gb}/${lastTelemetryInfo.sys_ram_total_gb} GB)`);
      }
      memoryBadge.title = parts.join(' • ') || 'Live process memory';
    }
  }

  function updateMemoryBadge(mem) {
    lastMemoryInfo = mem;
    refreshMemoryBadgeDisplay();
  }

  window.bridge.on('memory_stats', updateMemoryBadge);
  window.bridge.on('telemetry_stats', (snap) => {
    lastTelemetryInfo = snap;
    refreshMemoryBadgeDisplay();
  });

  // ── 15. Mock Viewport Iframe for standalone browser preview ──────────────
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
    const root = document.documentElement;
    const skin = root.getAttribute('data-skin') || 'crazy';
    const theme = root.getAttribute('data-theme') || 'sunset';
    const targetSrc = (url === 'about:blank' || url.startsWith('about:'))
      ? `newtab.html?skin=${encodeURIComponent(skin)}&theme=${encodeURIComponent(theme)}`
      : url;
    if (mockIframe.src !== targetSrc && !mockIframe.src.endsWith(targetSrc)) {
      mockIframe.src = targetSrc;
    }
  }

  // ── 16. Command Palette (Ctrl+K) ─────────────────────────────────────────
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
    { title: 'Toggle Zen Focus Mode', action: toggleZenMode, badge: 'View' },
    { title: 'Find in Page', action: openFindBar, badge: 'Find' },
    { title: 'Open Bookmarks Panel', action: () => openSidePanel('bookmarks'), badge: 'Panel' },
    { title: 'Open History Panel', action: () => openSidePanel('history'), badge: 'Panel' },
    { title: 'Open Downloads Panel', action: () => openSidePanel('downloads'), badge: 'Panel' },
    { title: 'Open Browser Settings', action: openSettings, badge: 'Settings' },
    { title: 'Sleep Other Tabs (Reclaim RAM)', action: () => {
      currentTabs.forEach((t) => {
        if (!t.active && !t.pinned && !t.sleeping) {
          window.bridge.send('sleep_tab', { tab_id: t.id });
        }
      });
    }, badge: 'Memory' },
    { title: 'New Tab', action: handleNewTab, badge: 'Tabs' },
    { title: 'New Private / Incognito Window', action: () => window.bridge.send('new_window', { incognito: true }), badge: 'Window' }
  ];

  function openCommandPalette() {
    if (!modalOverlay || !commandPalette) return;
    isOverlayOpen = true;
    modalOverlay.classList.add('open');
    if (settingsModal) settingsModal.style.display = 'none';
    commandPalette.style.display = 'flex';
    window.bridge.send('overlay', { open: true });
    paletteSelectedIndex = 0;
    if (paletteInput) {
      paletteInput.value = '';
      renderPaletteResults('');
      paletteInput.focus();
    }
  }

  function closeCommandPalette() {
    if (!modalOverlay || !commandPalette) return;
    isOverlayOpen = false;
    modalOverlay.classList.remove('open');
    commandPalette.style.display = 'none';
    window.bridge.send('overlay', { open: false });
  }

  function renderPaletteResults(query) {
    if (!paletteResults) return;
    paletteResults.innerHTML = '';
    const q = query.trim().toLowerCase();
    paletteItems = [];

    function addHeader(label) {
      const h = document.createElement('div');
      h.className = 'palette-section-header';
      h.textContent = label;
      paletteResults.appendChild(h);
    }

    const filteredCmds = BASE_COMMANDS.filter((c) => c.title.toLowerCase().includes(q));
    if (filteredCmds.length > 0) {
      addHeader('Commands');
      filteredCmds.forEach((cmd) => paletteItems.push({ type: 'command', title: cmd.title, badge: cmd.badge, action: cmd.action }));
    }

    const filteredTabs = currentTabs.filter((t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
    if (filteredTabs.length > 0) {
      addHeader('Open Tabs');
      filteredTabs.forEach((tab) => paletteItems.push({
        type: 'tab',
        title: tab.title,
        sub: tab.url,
        badge: tab.sleeping ? 'Asleep' : 'Tab',
        action: () => {
          if (tab.sleeping) window.bridge.send('wake_tab', { tab_id: tab.id });
          else window.bridge.send('switch_tab', { tab_id: tab.id });
        }
      }));
    }

    const filteredBms = currentBookmarks.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
    if (filteredBms.length > 0) {
      addHeader('Bookmarks');
      filteredBms.forEach((b) => paletteItems.push({
        type: 'bookmark',
        title: b.title,
        sub: b.url,
        badge: 'Bookmark',
        action: () => window.bridge.send('navigate', { url: b.url })
      }));
    }

    const filteredHist = currentHistory.filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q));
    if (filteredHist.length > 0) {
      addHeader('History');
      filteredHist.forEach((h) => paletteItems.push({
        type: 'history',
        title: h.title,
        sub: h.url,
        badge: 'History',
        action: () => window.bridge.send('navigate', { url: h.url })
      }));
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

    if (paletteSelectedIndex >= paletteItems.length) paletteSelectedIndex = 0;

    paletteItems.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = `palette-item ${index === paletteSelectedIndex ? 'selected' : ''}`;
      el.innerHTML = `
        <span class="item-title">${escapeHtml(item.title)}</span>
        ${item.sub ? `<span class="item-sub">${escapeHtml(item.sub)}</span>` : ''}
        <span class="item-badge">${escapeHtml(item.badge)}</span>
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
      if (i === paletteSelectedIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  if (btnPalette) btnPalette.addEventListener('click', openCommandPalette);

  if (paletteInput) {
    paletteInput.addEventListener('input', (e) => {
      paletteSelectedIndex = 0;
      renderPaletteResults(e.target.value);
    });

    paletteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeCommandPalette();
      else if (e.key === 'ArrowDown') {
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
      if (e.target === modalOverlay) {
        closeCommandPalette();
        closeSettings();
      }
    });
  }

  // ── 17. Global Keyboard Accelerators ─────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    // Ctrl+K -> Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOverlayOpen) { closeCommandPalette(); closeSettings(); }
      else openCommandPalette();
    }
    // Ctrl+, -> Settings
    else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      openSettings();
    }
    // Ctrl+F -> Find in Page
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (isFindOpen) closeFindBar();
      else openFindBar();
    }
    // Ctrl+H -> History Panel
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      openSidePanel('history');
    }
    // Ctrl+J -> Downloads Panel
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      openSidePanel('downloads');
    }
    // F11 -> Zen Focus Mode
    else if (e.key === 'F11') {
      e.preventDefault();
      toggleZenMode();
    }
    // Ctrl+Shift+V -> Toggle Tabs Layout
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
      if (activeTabId !== null) window.bridge.send('close_tab', { tab_id: activeTabId });
    }
    // Ctrl+L -> Focus Omnibox
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (omniboxInput) omniboxInput.focus();
    }
    // Escape -> Close Context Menu, Find Bar, or Modals
    else if (e.key === 'Escape') {
      closeContextMenu();
      if (isFindOpen) closeFindBar();
      if (isOverlayOpen) { closeCommandPalette(); closeSettings(); }
    }
  });

  // Initial layout report
  setTimeout(reportContentRect, 100);
})();
