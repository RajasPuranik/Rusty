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
  let splitState = {
    enabled: false,
    ratio: 0.5,
    focused_pane: 0,
    left_tab_id: null,
    right_tab_id: null,
    left_url: '',
    right_url: ''
  };
  let lastSentRectKey = '';
  let rectRafId = 0;
  let isDraggingSplit = false;

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
  const omniboxEl = document.querySelector('.omnibox');
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
  const splitBarLeft = document.getElementById('split-bar-left');
  const splitBarRight = document.getElementById('split-bar-right');
  const splitBadgeLeft = document.getElementById('split-badge-left');
  const splitBadgeRight = document.getElementById('split-badge-right');
  const splitLeftUrl = document.getElementById('split-left-url');
  const splitRightUrl = document.getElementById('split-right-url');
  const btnSplitSwap = document.getElementById('btn-split-swap');
  const btnSplitClose = document.getElementById('btn-split-close');
  const splitStage = document.getElementById('split-panes-stage');
  const splitPaneLeft = document.getElementById('split-pane-left');
  const splitPaneRight = document.getElementById('split-pane-right');
  const splitDivider = document.getElementById('split-divider');
  const modalOverlay = document.getElementById('modal-overlay');
  const commandPalette = document.getElementById('command-palette');
  const paletteInput = document.getElementById('palette-input');
  const paletteResults = document.getElementById('palette-results');
  const settingsModal = document.getElementById('settings-modal');
  const settingsCloseBtn = document.getElementById('settings-close-btn');
  const memoryModal = document.getElementById('memory-modal');
  const memoryCloseBtn = document.getElementById('memory-close-btn');
  const btnCloseMemoryFooter = document.getElementById('btn-close-memory-footer');
  const btnCopyMemoryReport = document.getElementById('btn-copy-memory-report');
  const memoryCopyStatus = document.getElementById('memory-copy-status');
  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitleEl = document.getElementById('confirm-modal-title');
  const confirmMessageEl = document.getElementById('confirm-modal-message');
  const confirmOkBtn = document.getElementById('confirm-modal-ok');
  const confirmCancelBtn = document.getElementById('confirm-modal-cancel');
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

  // Suppress Windows middle-click autoscroll icon across all browser chrome controls
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  }, true);

  function hideAllModalPanels() {
    if (commandPalette) commandPalette.style.display = 'none';
    if (settingsModal) settingsModal.style.display = 'none';
    if (memoryModal) memoryModal.style.display = 'none';
    if (confirmModal) confirmModal.style.display = 'none';
  }

  function closeAllModals() {
    if (!modalOverlay) return;
    isOverlayOpen = false;
    modalOverlay.classList.remove('open');
    hideAllModalPanels();
    pendingConfirmCallback = null;
    if (window.bridge) window.bridge.send('overlay', { open: false });
  }

  let pendingConfirmCallback = null;
  function openConfirmModal({ title, message, okLabel, onConfirm }) {
    if (!modalOverlay || !confirmModal) {
      if (onConfirm) onConfirm();
      return;
    }
    hideAllModalPanels();
    isOverlayOpen = true;
    modalOverlay.classList.add('open');
    if (confirmTitleEl) confirmTitleEl.textContent = title || 'Confirm';
    if (confirmMessageEl) confirmMessageEl.textContent = message || 'Are you sure?';
    if (confirmOkBtn) confirmOkBtn.textContent = okLabel || 'Confirm';
    pendingConfirmCallback = onConfirm || null;
    confirmModal.style.display = 'flex';
    if (window.bridge) window.bridge.send('overlay', { open: true });
    if (confirmOkBtn) confirmOkBtn.focus();
  }

  if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', closeAllModals);
  if (confirmOkBtn) {
    confirmOkBtn.addEventListener('click', () => {
      const cb = pendingConfirmCallback;
      closeAllModals();
      if (cb) cb();
    });
  }

  // ── 1. Content Rectangle Reporting (Deduplicated + RAF Debounced) ──
  function sendContentRectNow(force = false) {
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const ox = Math.round(rect.left);
    const oy = Math.round(rect.top);
    const ow = Math.round(rect.width);
    const oh = Math.round(rect.height);
    if (ow < 10 || oh < 10) return;

    const payload = { x: ox, y: oy, width: ow, height: oh };
    let rectKey = `${ox},${oy},${ow},${oh}|0`;

    if (splitState.enabled && viewport.classList.contains('split-active') && splitPaneLeft && splitPaneRight) {
      const lr = splitPaneLeft.getBoundingClientRect();
      const rr = splitPaneRight.getBoundingClientRect();
      const lx = Math.round(lr.left);
      const ly = Math.round(lr.top);
      const lw = Math.round(lr.width);
      const lh = Math.round(lr.height);
      const rx = Math.round(rr.left);
      const ry = Math.round(rr.top);
      const rw = Math.round(rr.width);
      const rh = Math.round(rr.height);
      if (lw >= 10 && lh >= 10 && rw >= 10 && rh >= 10) {
        payload.left = { x: lx, y: ly, width: lw, height: lh };
        payload.right = { x: rx, y: ry, width: rw, height: rh };
        payload.ratio = Number(splitState.ratio.toFixed(4));
        rectKey = `${ox},${oy},${ow},${oh}|1|${lx},${ly},${lw},${lh}|${rx},${ry},${rw},${rh}|${payload.ratio}`;
      }
    }

    if (!force && rectKey === lastSentRectKey) {
      return;
    }
    lastSentRectKey = rectKey;
    if (window.bridge) {
      window.bridge.send('content_rect', payload);
    }
  }

  function reportContentRect(force = false) {
    if (rectRafId) cancelAnimationFrame(rectRafId);
    rectRafId = requestAnimationFrame(() => {
      rectRafId = 0;
      sendContentRectNow(force === true);
    });
  }

  window.addEventListener('resize', () => reportContentRect(false));
  window.addEventListener('tabs-layout-changed', () => setTimeout(() => reportContentRect(false), 50));

  // ── 2. Navigation Actions (Click + Middle-click) ─────────────────────────
  if (btnBack) {
    btnBack.addEventListener('click', () => window.bridge.send('back'));
    btnBack.addEventListener('auxclick', (e) => {
      if (e.button !== 1 || btnBack.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      window.bridge.send('open_history_entry_in_new_tab', { direction: 'back', background: e.shiftKey ? false : null });
    });
  }
  if (btnForward) {
    btnForward.addEventListener('click', () => window.bridge.send('forward'));
    btnForward.addEventListener('auxclick', (e) => {
      if (e.button !== 1 || btnForward.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      window.bridge.send('open_history_entry_in_new_tab', { direction: 'forward', background: e.shiftKey ? false : null });
    });
  }
  if (btnReload) {
    btnReload.addEventListener('click', () => window.bridge.send('reload'));
    btnReload.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      if (activeTabId !== null) {
        window.bridge.send('duplicate_tab', { tab_id: activeTabId, background: e.shiftKey ? false : null });
      }
    });
  }
  if (btnStar) {
    btnStar.addEventListener('click', () => {
      window.bridge.send('toggle_bookmark', { url: activeUrl });
    });
  }

  // ── 3. Omnibox Enter, URL Detection & Engine Outline (A4) ─────────────────
  function updateOmniboxEngineOutline() {
    if (!omniboxEl || !omniboxInput) return;
    const enabled = !window.Settings || window.Settings.get('omnibox_engine_outline') !== false;
    const isSearch = Boolean(
      enabled &&
      window.RustyEngines &&
      window.RustyEngines.isSearchQueryText(omniboxInput.value)
    );
    if (isSearch) {
      const engineId = (window.Settings && window.Settings.get('default_search')) || 'google';
      const custom = (window.Settings && window.Settings.get('custom_engines')) || [];
      omniboxEl.classList.add('engine-outline-box', 'omnibox-search-active');
      window.RustyEngines.applyOutlineStyles(omniboxEl, engineId, custom);
    } else {
      omniboxEl.classList.remove('engine-outline-box', 'omnibox-search-active');
      if (window.RustyEngines) {
        window.RustyEngines.applyOutlineStyles(omniboxEl, null);
      }
    }
  }

  if (omniboxInput) {
    omniboxInput.addEventListener('input', updateOmniboxEngineOutline);
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
        updateOmniboxEngineOutline();
        omniboxInput.blur();
      }
    });

    omniboxInput.addEventListener('focus', () => {
      omniboxInput.select();
      updateOmniboxEngineOutline();
    });
    omniboxInput.addEventListener('blur', updateOmniboxEngineOutline);
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

  // ── 4. New Tab Buttons (Left-click = New Tab, Middle-click = Paste & Go) ─
  function handleNewTab() {
    window.bridge.send('new_tab', { url: 'about:blank', background: false });
  }
  function attachNewTabAuxHandler(btn) {
    if (!btn) return;
    btn.addEventListener('click', handleNewTab);
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      window.bridge.send('paste_new_tab');
    });
  }
  attachNewTabAuxHandler(btnNewTabH);
  attachNewTabAuxHandler(btnNewTabV);

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

    // Middle-click: Close tab (confirm via modal if pinned)
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      if (tab.pinned) {
        openConfirmModal({
          title: 'Close Pinned Tab',
          message: `Close pinned tab "${tab.title || tab.url}"?`,
          okLabel: 'Close Tab',
          onConfirm: () => window.bridge.send('close_tab', { tab_id: tab.id })
        });
      } else {
        if (window.fxTabPoof) {
          window.fxTabPoof(e.clientX, e.clientY);
        }
        window.bridge.send('close_tab', { tab_id: tab.id });
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
      window.bridge.send('duplicate_tab', { tab_id: tab.id, background: false });
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
        item.title = `${b.url} (Middle-click: open in new tab)`;
        item.innerHTML = `
          ${window.Icons ? window.Icons.get('star', '', 13) : '★'}
          <div class="item-title">${escapeHtml(b.title || b.url)}</div>
          <button class="btn-icon" title="Remove" style="width: 20px; height: 20px;">
            ${window.Icons ? window.Icons.get('close', '', 10) : '×'}
          </button>
        `;
        const removeBtn = item.querySelector('button');
        item.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            window.bridge.send('new_tab', { url: b.url, background: e.shiftKey ? false : null, title: b.title || null });
          } else {
            window.bridge.send('navigate', { url: b.url });
          }
        });
        item.addEventListener('auxclick', (e) => {
          if (e.button !== 1 || removeBtn.contains(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          window.bridge.send('new_tab', { url: b.url, background: e.shiftKey ? false : null, title: b.title || null });
        });
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
          openConfirmModal({
            title: 'Clear Browsing History',
            message: 'Delete all recorded browsing history from disk?',
            okLabel: 'Clear History',
            onConfirm: () => window.bridge.send('clear_browsing_data', { history: true })
          });
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
        item.title = `${h.url} (Middle-click: open in new tab)`;
        item.innerHTML = `
          ${window.Icons ? window.Icons.get('clock', '', 13) : '🕒'}
          <div style="flex: 1; overflow: hidden;">
            <div class="item-title">${escapeHtml(h.title || h.url)}</div>
            <div class="item-sub">${escapeHtml(h.url)}</div>
          </div>
        `;
        item.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            window.bridge.send('new_tab', { url: h.url, background: e.shiftKey ? false : null, title: h.title || null });
          } else {
            window.bridge.send('navigate', { url: h.url });
          }
        });
        item.addEventListener('auxclick', (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          window.bridge.send('new_tab', { url: h.url, background: e.shiftKey ? false : null, title: h.title || null });
        });
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
        const hasUrl = typeof dl.url === 'string' && /^https?:\/\//i.test(dl.url);
        const card = document.createElement('div');
        card.className = 'download-card';
        if (hasUrl) {
          card.style.cursor = 'pointer';
          card.title = `Source: ${dl.url} (Middle-click: open in new tab)`;
        }
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
        if (hasUrl) {
          card.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              e.preventDefault();
              window.bridge.send('new_tab', { url: dl.url, background: e.shiftKey ? false : null, title: dl.filename || null });
            }
          });
          card.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            window.bridge.send('new_tab', { url: dl.url, background: e.shiftKey ? false : null, title: dl.filename || null });
          });
        }
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

  // ── 11b. Split View Controls & Draggable Divider ─────────────────────────
  function isInternalNewTabUrl(u) {
    return !u || u === 'about:blank' || u === 'about:newtab' || u.includes('newtab.html');
  }

  function applySplitViewState(sv) {
    if (!sv || typeof sv !== 'object') return;
    const enabled = Boolean(sv.enabled);
    splitState.enabled = enabled;
    if (typeof sv.ratio === 'number' && !isDraggingSplit) {
      splitState.ratio = Math.max(0.20, Math.min(0.80, sv.ratio));
    }
    splitState.focused_pane = sv.focused_pane === 1 ? 1 : 0;
    splitState.left_tab_id = sv.left_tab_id ?? null;
    splitState.right_tab_id = sv.right_tab_id ?? null;
    splitState.left_url = sv.left_url || '';
    splitState.right_url = sv.right_url || '';

    if (btnSplitView) btnSplitView.classList.toggle('active', enabled);
    if (viewport) viewport.classList.toggle('split-active', enabled);
    if (splitStage) {
      splitStage.style.setProperty('--split-ratio', `${(splitState.ratio * 100).toFixed(3)}%`);
    }
    if (splitBarLeft) splitBarLeft.classList.toggle('focused', enabled && splitState.focused_pane === 0);
    if (splitBarRight) splitBarRight.classList.toggle('focused', enabled && splitState.focused_pane === 1);

    if (splitLeftUrl && document.activeElement !== splitLeftUrl) {
      splitLeftUrl.value = isInternalNewTabUrl(splitState.left_url) ? '' : splitState.left_url;
    }
    if (splitRightUrl && document.activeElement !== splitRightUrl) {
      splitRightUrl.value = isInternalNewTabUrl(splitState.right_url) ? '' : splitState.right_url;
    }
  }

  if (btnSplitView) {
    btnSplitView.addEventListener('click', () => {
      window.bridge.send('split_view');
    });
  }
  if (btnSplitSwap) {
    btnSplitSwap.addEventListener('click', (e) => {
      e.stopPropagation();
      window.bridge.send('split_swap');
    });
  }
  if (btnSplitClose) {
    btnSplitClose.addEventListener('click', (e) => {
      e.stopPropagation();
      window.bridge.send('split_close');
    });
  }
  if (splitBarLeft) {
    splitBarLeft.addEventListener('click', (e) => {
      if (e.target === splitLeftUrl) return;
      window.bridge.send('split_focus', { pane: 0 });
    });
  }
  if (splitBarRight) {
    splitBarRight.addEventListener('click', (e) => {
      if (e.target === splitRightUrl || (btnSplitSwap && btnSplitSwap.contains(e.target)) || (btnSplitClose && btnSplitClose.contains(e.target))) return;
      window.bridge.send('split_focus', { pane: 1 });
    });
  }

  function wireSplitUrlInput(inputEl, paneIdx) {
    if (!inputEl) return;
    inputEl.addEventListener('focus', () => {
      window.bridge.send('split_focus', { pane: paneIdx });
      inputEl.select();
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = inputEl.value.trim();
        if (q) {
          window.bridge.send('split_navigate', { pane: paneIdx, url: q });
          inputEl.blur();
        }
      } else if (e.key === 'Escape') {
        const cur = paneIdx === 0 ? splitState.left_url : splitState.right_url;
        inputEl.value = isInternalNewTabUrl(cur) ? '' : cur;
        inputEl.blur();
      }
    });
  }
  wireSplitUrlInput(splitLeftUrl, 0);
  wireSplitUrlInput(splitRightUrl, 1);

  if (splitDivider && splitStage) {
    const applyDividerRatio = (clientX, forceSend) => {
      const stageRect = splitStage.getBoundingClientRect();
      if (stageRect.width < 40) return;
      const rawRatio = (clientX - stageRect.left) / stageRect.width;
      const clamped = Math.max(0.20, Math.min(0.80, rawRatio));
      splitState.ratio = clamped;
      splitStage.style.setProperty('--split-ratio', `${(clamped * 100).toFixed(3)}%`);
      reportContentRect(forceSend);
    };

    const endDividerDrag = (e) => {
      if (!isDraggingSplit) return;
      isDraggingSplit = false;
      splitDivider.classList.remove('dragging');
      if (splitStage) splitStage.classList.remove('dragging-split');
      try {
        if (e && e.pointerId !== undefined && splitDivider.hasPointerCapture(e.pointerId)) {
          splitDivider.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      reportContentRect(true);
    };

    splitDivider.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !splitState.enabled) return;
      e.preventDefault();
      isDraggingSplit = true;
      splitDivider.classList.add('dragging');
      if (splitStage) splitStage.classList.add('dragging-split');
      try { splitDivider.setPointerCapture(e.pointerId); } catch (_) {}
      applyDividerRatio(e.clientX, false);
    });
    splitDivider.addEventListener('pointermove', (e) => {
      if (!isDraggingSplit) return;
      applyDividerRatio(e.clientX, false);
    });
    splitDivider.addEventListener('pointerup', endDividerDrag);
    splitDivider.addEventListener('pointercancel', endDividerDrag);
    splitDivider.addEventListener('dblclick', () => {
      if (!splitState.enabled) return;
      splitState.ratio = 0.5;
      splitStage.style.setProperty('--split-ratio', '50%');
      reportContentRect(true);
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
    hideAllModalPanels();
    isOverlayOpen = true;
    modalOverlay.classList.add('open');
    settingsModal.style.display = 'flex';
    window.bridge.send('overlay', { open: true });
    populateSettingsUI();
  }

  function closeSettings() {
    closeAllModals();
  }

  if (btnSettings) btnSettings.addEventListener('click', openSettings);
  if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);

  const THEMES_LIST = [
    { id: 'midnight', name: 'Midnight', dot: '#6366f1' },
    { id: 'light', name: 'Light', dot: '#1a73e8' },
    { id: 'amoled', name: 'AMOLED', dot: '#f43f5e' },
    { id: 'aurora', name: 'Aurora', dot: '#10b981' },
    { id: 'cyberpunk', name: 'Cyberpunk', dot: '#facc15' },
    { id: 'sunset', name: 'Sunset', dot: '#f97316' },
    { id: 'matcha', name: 'Matcha', dot: '#22c55e' },
    { id: 'sakura', name: 'Sakura', dot: '#ec4899' },
    { id: 'graphite', name: 'Graphite', dot: '#00d2ff' },
    { id: 'slate', name: 'Slate', dot: '#38bdf8' },
    { id: 'mocha', name: 'Mocha', dot: '#f59e0b' },
    { id: 'midnight_blue', name: 'Midnight Blue', dot: '#3b82f6' }
  ];

  function populateSettingsUI() {
    const root = document.documentElement;
    const currentSkin = root.getAttribute('data-skin') || 'minimal';
    const currentTheme = root.getAttribute('data-theme') || 'midnight';
    const currentPalette = root.getAttribute('data-palette') || 'slate';

    // Skin Cards
    const cardMin = document.getElementById('skin-card-minimal');
    const cardCrz = document.getElementById('skin-card-crazy');
    const cardMayank = document.getElementById('skin-card-mayank');
    const badgeMin = document.getElementById('badge-minimal');
    const badgeCrz = document.getElementById('badge-crazy');
    const badgeMayank = document.getElementById('badge-mayank');

    if (cardMin && cardCrz) {
      cardMin.classList.toggle('active', currentSkin === 'minimal');
      cardCrz.classList.toggle('active', currentSkin === 'crazy');
      if (cardMayank) cardMayank.classList.toggle('active', currentSkin === 'mayank');
      if (badgeMin) badgeMin.style.display = currentSkin === 'minimal' ? 'inline-block' : 'none';
      if (badgeCrz) badgeCrz.style.display = currentSkin === 'crazy' ? 'inline-block' : 'none';
      if (badgeMayank) badgeMayank.style.display = currentSkin === 'mayank' ? 'inline-block' : 'none';

      cardMin.onclick = () => {
        closeSettings();
        window.switchSkin('minimal');
      };
      cardCrz.onclick = () => {
        closeSettings();
        window.switchSkin('crazy');
      };
      if (cardMayank) {
        cardMayank.onclick = () => {
          closeSettings();
          window.switchSkin('mayank');
        };
      }
    }

    // Accent Palette Dropdown
    const selPalette = document.getElementById('setting-accent-palette');
    if (selPalette) {
      selPalette.value = currentPalette;
      selPalette.onchange = () => {
        if (typeof window.switchPalette === 'function') {
          window.switchPalette(selPalette.value);
          populateSettingsUI();
        }
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

    // Background Style Dropdown
    const selBgStyle = document.getElementById('setting-bg-style');
    if (selBgStyle) {
      const savedBg = window.Settings ? window.Settings.get('bg_style') : 'match_theme';
      selBgStyle.value = savedBg || 'match_theme';
      selBgStyle.onchange = () => {
        if (window.Settings) window.Settings.set('bg_style', selBgStyle.value);
        if (window.BackgroundRegistry) {
          window.BackgroundRegistry.switchTo(selBgStyle.value);
        }
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

    // Individual Effects, Tabs & Widget Toggles
    const fxToggles = [
      { id: 'setting-open-tabs-background', key: 'open_tabs_in_background' },
      { id: 'setting-omnibox-outline', key: 'omnibox_engine_outline' },
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
      { id: 'setting-ntp-globe-clouds', key: 'ntp_globe_clouds' },
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
          if (key === 'omnibox_engine_outline') {
            updateOmniboxEngineOutline();
          }
        };
      }
    });

    // Weather & Globe City setting (Priority 1 location source)
    const inpWeatherCity = document.getElementById('setting-weather-location');
    const btnApplyWeatherCity = document.getElementById('btn-apply-weather-location');
    if (inpWeatherCity && window.Settings) {
      const savedCity = window.Settings.get('weather_location') || '';
      if (document.activeElement !== inpWeatherCity) {
        inpWeatherCity.value = savedCity;
      }
      const commitWeatherCity = () => {
        const raw = inpWeatherCity.value.trim().slice(0, 64);
        const nextVal = raw.toLowerCase() === 'auto' ? '' : raw;
        inpWeatherCity.value = nextVal;
        window.Settings.set('weather_location', nextVal);
      };
      if (btnApplyWeatherCity) btnApplyWeatherCity.onclick = commitWeatherCity;
      inpWeatherCity.onchange = commitWeatherCity;
      inpWeatherCity.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitWeatherCity();
        }
      };
    }

    // Companion Pet Section (Crazy skin only)
    const petMinimalNote = document.getElementById('settings-pet-minimal-note');
    const petCrazyControls = document.getElementById('settings-pet-crazy-controls');
    if (petMinimalNote && petCrazyControls) {
      const isCrazy = currentSkin === 'crazy';
      petMinimalNote.style.display = isCrazy ? 'none' : 'block';
      petCrazyControls.style.display = isCrazy ? 'block' : 'none';
      if (isCrazy && window.Settings) {
        const selPetType = document.getElementById('setting-pet-type');
        const inpPetName = document.getElementById('setting-pet-name');
        const inpPetColor = document.getElementById('setting-pet-color');
        const selPetAcc = document.getElementById('setting-pet-accessory');
        const cbPetRoam = document.getElementById('setting-pet-roam');
        const moodLabel = document.getElementById('setting-pet-mood-label');
        const btnPetTreat = document.getElementById('btn-settings-pet-treat');
        const btnPetRemove = document.getElementById('btn-settings-pet-remove');

        const refreshPetControls = () => {
          const pType = window.Settings.get('pet_type') || '';
          const pName = window.Settings.get('pet_name') || 'Pixel';
          const pColor = window.Settings.get('pet_color') || '#f97316';
          const pAcc = window.Settings.get('pet_accessory') || 'none';
          const pRoam = Boolean(window.Settings.get('pet_roam'));
          const pMood = window.Settings.get('pet_mood') || 'content';
          const hasPet = Boolean(pType);

          if (selPetType) selPetType.value = pType;
          if (inpPetName) {
            if (document.activeElement !== inpPetName) inpPetName.value = pName;
            inpPetName.disabled = !hasPet;
          }
          if (inpPetColor) {
            inpPetColor.value = /^#[0-9a-fA-F]{6}$/.test(pColor) ? pColor : '#f97316';
            inpPetColor.disabled = !hasPet;
          }
          if (selPetAcc) {
            selPetAcc.value = pAcc;
            selPetAcc.disabled = !hasPet;
          }
          if (cbPetRoam) {
            cbPetRoam.checked = pRoam;
            cbPetRoam.disabled = !hasPet;
          }
          if (moodLabel) {
            moodLabel.textContent = hasPet ? `Mood: ${pMood}` : 'No companion adopted yet';
          }
          if (btnPetTreat) {
            const petState = window.RustyPet && typeof window.RustyPet.getState === 'function'
              ? window.RustyPet.getState()
              : null;
            const cd = petState ? Number(petState.treatCooldownRemainingSec || 0) : 0;
            btnPetTreat.disabled = !hasPet || cd > 0;
            btnPetTreat.textContent = cd > 0 ? `Cooldown (${cd}s)` : 'Feed Treat';
          }
          if (btnPetRemove) {
            btnPetRemove.disabled = !hasPet;
          }
        };

        refreshPetControls();

        if (selPetType) {
          selPetType.onchange = () => {
            const nextType = selPetType.value;
            if (!nextType) {
              window.Settings.setMany({ pet_type: '', pet_roam: false });
            } else {
              window.Settings.set('pet_type', nextType);
            }
            refreshPetControls();
          };
        }
        if (inpPetName) {
          inpPetName.onchange = () => {
            const clean = inpPetName.value.trim().slice(0, 24) || 'Pixel';
            inpPetName.value = clean;
            window.Settings.set('pet_name', clean);
          };
        }
        if (inpPetColor) {
          inpPetColor.onchange = () => {
            window.Settings.set('pet_color', inpPetColor.value || '#f97316');
          };
        }
        if (selPetAcc) {
          selPetAcc.onchange = () => {
            window.Settings.set('pet_accessory', selPetAcc.value || 'none');
          };
        }
        if (cbPetRoam) {
          cbPetRoam.onchange = () => {
            window.Settings.set('pet_roam', cbPetRoam.checked);
          };
        }
        if (btnPetTreat) {
          btnPetTreat.onclick = () => {
            if (window.RustyPet && typeof window.RustyPet.feedTreat === 'function') {
              window.RustyPet.feedTreat();
            } else if (window.Settings) {
              window.Settings.set('pet_mood', 'happy');
            }
            refreshPetControls();
          };
        }
        if (btnPetRemove) {
          btnPetRemove.onclick = () => {
            window.Settings.setMany({ pet_type: '', pet_roam: false, pet_mood: 'content' });
            refreshPetControls();
          };
        }
      }
    }

    // Search Engine Dropdown + Custom Search Engines Manager
    function renderSearchEngineSettingsSection() {
      const selEngine = document.getElementById('setting-search-engine');
      const customListEl = document.getElementById('custom-engines-list');
      const engines = window.RustyEngines ? window.RustyEngines.getAll() : [];
      const activeId = (window.Settings && window.Settings.get('default_search')) || 'google';

      if (selEngine) {
        if (engines.length > 0) {
          selEngine.innerHTML = '';
          engines.forEach((eng) => {
            const opt = document.createElement('option');
            opt.value = eng.id;
            opt.textContent = eng.builtin ? eng.name : `${eng.name} (Custom)`;
            selEngine.appendChild(opt);
          });
        }
        selEngine.value = activeId;
        selEngine.onchange = () => {
          if (window.Settings) window.Settings.set('default_search', selEngine.value);
          updateOmniboxPlaceholder(selEngine.value);
          updateOmniboxEngineOutline();
        };
      }

      if (customListEl && window.RustyEngines) {
        const customs = window.RustyEngines.getCustomEngines();
        customListEl.innerHTML = '';
        customs.forEach((eng) => {
          const resolved = window.RustyEngines.resolveOutlineColors(eng);
          const row = document.createElement('div');
          row.className = 'custom-engine-row';
          row.innerHTML = `
            <span class="custom-engine-swatch" style="background: ${escapeHtml(resolved.swatch)};"></span>
            <span class="custom-engine-name">${escapeHtml(eng.name)}</span>
            <span class="custom-engine-tpl">${escapeHtml(eng.template)}</span>
            <button type="button" class="btn-icon" title="Remove ${escapeHtml(eng.name)}" style="width: 22px; height: 22px;">×</button>
          `;
          row.querySelector('button').addEventListener('click', () => {
            window.RustyEngines.removeCustomEngine(eng.id);
            renderSearchEngineSettingsSection();
            updateOmniboxPlaceholder(window.Settings ? window.Settings.get('default_search') : 'google');
            updateOmniboxEngineOutline();
          });
          customListEl.appendChild(row);
        });
      }
    }
    renderSearchEngineSettingsSection();

    const customEngineForm = document.getElementById('settings-custom-engine-form');
    const customNameInput = document.getElementById('custom-engine-name');
    const customTplInput = document.getElementById('custom-engine-template');
    const customColorInput = document.getElementById('custom-engine-color');
    if (customColorInput && window.RustyEngines) {
      customColorInput.value = window.RustyEngines.getDefaultAccentHex();
    }
    if (customEngineForm && window.RustyEngines) {
      customEngineForm.onsubmit = (e) => {
        e.preventDefault();
        const name = customNameInput ? customNameInput.value.trim() : '';
        const template = customTplInput ? customTplInput.value.trim() : '';
        const color = customColorInput ? customColorInput.value : window.RustyEngines.getDefaultAccentHex();
        if (!name || !template) return;
        const added = window.RustyEngines.addCustomEngine({ name, template, color });
        if (added) {
          if (customNameInput) customNameInput.value = '';
          if (customTplInput) customTplInput.value = '';
          renderSearchEngineSettingsSection();
          updateOmniboxEngineOutline();
        }
      };
    }

    // Lite Mode Toggle
    const chkLiteMode = document.getElementById('setting-lite-mode');
    if (chkLiteMode) {
      chkLiteMode.checked = Boolean(window.Settings && window.Settings.get('lite_mode'));
      chkLiteMode.onchange = () => {
        const enabled = chkLiteMode.checked;
        if (window.Settings) {
          window.Settings.set('lite_mode', enabled);
          if (enabled) {
            window.Settings.set('skin', 'minimal');
            window.Settings.set('fx_canvas_bg', false);
            window.Settings.set('fx_glow', false);
            window.Settings.set('fx_tilt', false);
            window.Settings.set('fx_magnetic', false);
            window.Settings.set('fx_ripple', false);
            window.Settings.set('fx_trail', false);
            window.Settings.set('fx_confetti', false);
            window.Settings.set('memory_saver_timeout_secs', 60);
            const selMem = document.getElementById('setting-memory-timeout');
            if (selMem) selMem.value = '60';
            updateSkinCards('minimal');
            document.documentElement.dataset.skin = 'minimal';
          }
        }
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

    // Clear buttons (non-blocking confirmation modal)
    const btnClrHist = document.getElementById('btn-clear-history');
    if (btnClrHist) {
      btnClrHist.onclick = () => {
        openConfirmModal({
          title: 'Clear Browsing History',
          message: 'Delete all recorded browsing history from disk?',
          okLabel: 'Clear History',
          onConfirm: () => window.bridge.send('clear_browsing_data', { history: true })
        });
      };
    }

    const btnClrCache = document.getElementById('btn-clear-cache');
    if (btnClrCache) {
      btnClrCache.onclick = () => {
        openConfirmModal({
          title: 'Clear Cookies & Cache',
          message: 'Clear cached files, cookies, and browsing session state?',
          okLabel: 'Clear Cache',
          onConfirm: () => window.bridge.send('clear_browsing_data', { cache: true })
        });
      };
    }

    renderExtensionsAndScriptsSection();
  }

  // ── Milestone R8: Extensions & Userscripts Logic ────────────────────────────
  function renderExtensionsAndScriptsSection() {
    const btnLoadExt = document.getElementById('btn-load-unpacked-ext');
    const btnAddUs = document.getElementById('btn-add-userscript');

    if (btnLoadExt) {
      btnLoadExt.onclick = () => {
        const path = prompt('Enter absolute folder path to unpacked extension (containing manifest.json):');
        if (path && path.trim()) {
          window.bridge.send('load_unpacked_extension', { path: path.trim() });
        }
      };
    }

    if (btnAddUs) {
      btnAddUs.onclick = () => {
        openUserscriptEditor({
          id: 'us_' + Date.now(),
          name: 'New Custom Script',
          version: '1.0.0',
          description: '',
          matches: ['<all_urls>'],
          run_at: 'document_end',
          enabled: true,
          code: '// Write JavaScript to execute on matched pages\n(function() {\n  console.log("Rusty Userscript active on: " + window.location.href);\n})();'
        });
      };
    }

    // Request fresh state from Rust backend
    window.bridge.send('get_extensions_and_scripts', {});
  }

  function renderExtensionsList(extensions, isWindows, vaultActive) {
    const listEl = document.getElementById('extensions-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (vaultActive) {
      const vNote = document.createElement('div');
      vNote.style.cssText = 'padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.12); color: #ef4444; font-size: 11px;';
      vNote.textContent = '🔒 Extensions and userscripts are strictly inhibited in Vault workspace to prevent credential leakage.';
      listEl.appendChild(vNote);
      return;
    }

    if (!isWindows) {
      const linNote = document.createElement('div');
      linNote.style.cssText = 'padding: 8px 12px; border-radius: 6px; background: var(--bg-surface-alt); border: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 11px;';
      linNote.textContent = 'ℹ️ WebKitGTK 4.1 engine does not implement Chrome Manifest V3 APIs. Use the Userscripts Manager below for user script customizations.';
      listEl.appendChild(linNote);
      return;
    }

    if (!extensions || extensions.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; border: 1px dashed var(--border-subtle); border-radius: 6px;';
      empty.textContent = 'No unpacked extensions loaded. Click "+ Load Unpacked Folder" to inspect and mount a Manifest V2/V3 extension.';
      listEl.appendChild(empty);
      return;
    }

    extensions.forEach((ext) => {
      const card = document.createElement('div');
      card.className = 'extension-card';

      const hasAllUrls = ext.permissions && ext.permissions.some(p => p === '<all_urls>' || p === '*://*/*');
      const hasWebRequest = ext.permissions && ext.permissions.some(p => p.includes('webRequest'));
      const riskClass = (hasAllUrls || hasWebRequest) ? 'high' : (ext.permissions && ext.permissions.length > 4 ? 'medium' : 'low');
      const riskLabel = (hasAllUrls || hasWebRequest) ? 'Broad Host Access' : (ext.permissions && ext.permissions.length > 4 ? 'Moderate' : 'Low Risk');

      const permsHtml = (ext.permissions || []).map(p => `<span class="perm-chip">${escapeHtml(p)}</span>`).join('');

      card.innerHTML = `
        <div class="ext-info">
          <div class="ext-title-row">
            <span class="ext-name">${escapeHtml(ext.name)}</span>
            <span class="ext-version">v${escapeHtml(ext.version)}</span>
            <span class="risk-badge ${riskClass}">${riskLabel}</span>
          </div>
          <div class="ext-desc">${escapeHtml(ext.description || ext.path)}</div>
          <div class="ext-perms-row">${permsHtml}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <input type="checkbox" class="ext-toggle" ${ext.enabled ? 'checked' : ''} title="Enable/Disable extension" style="accent-color: var(--accent-primary); width: 16px; height: 16px; cursor: pointer;">
          <button type="button" class="btn-icon ext-remove-btn" title="Remove extension" style="color: #ef4444; width: 24px; height: 24px;">×</button>
        </div>
      `;

      card.querySelector('.ext-toggle').onchange = (e) => {
        window.bridge.send('toggle_extension', { id: ext.id, enabled: e.target.checked });
      };

      card.querySelector('.ext-remove-btn').onclick = () => {
        if (confirm(`Remove extension "${ext.name}"?`)) {
          window.bridge.send('remove_extension', { id: ext.id });
        }
      };

      listEl.appendChild(card);
    });
  }

  function renderUserscriptsList(scripts, vaultActive) {
    const listEl = document.getElementById('userscripts-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (vaultActive) {
      const vNote = document.createElement('div');
      vNote.style.cssText = 'padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.12); color: #ef4444; font-size: 11px;';
      vNote.textContent = '🔒 Userscripts are strictly inhibited in Vault workspace.';
      listEl.appendChild(vNote);
      return;
    }

    if (!scripts || scripts.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; border: 1px dashed var(--border-subtle); border-radius: 6px;';
      empty.textContent = 'No userscripts installed. Click "+ Add Userscript" to create one.';
      listEl.appendChild(empty);
      return;
    }

    scripts.forEach((us) => {
      const card = document.createElement('div');
      card.className = 'userscript-card';

      const matchesHtml = (us.matches || []).map(m => `<span class="match-chip">${escapeHtml(m)}</span>`).join('');
      const timingLabel = us.run_at === 'document_start' ? 'document_start' : 'document_end';

      card.innerHTML = `
        <div class="us-info">
          <div class="us-title-row">
            <span class="us-name">${escapeHtml(us.name)}</span>
            <span class="us-version">v${escapeHtml(us.version || '1.0.0')}</span>
            <span class="timing-badge">${timingLabel}</span>
          </div>
          <div class="us-desc">${escapeHtml(us.description || '')}</div>
          <div class="us-matches-row">${matchesHtml}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <button type="button" class="btn-secondary-xs us-edit-btn" title="Edit userscript code">Edit</button>
          <input type="checkbox" class="us-toggle" ${us.enabled ? 'checked' : ''} title="Enable/Disable userscript" style="accent-color: var(--accent-primary); width: 16px; height: 16px; cursor: pointer;">
          <button type="button" class="btn-icon us-delete-btn" title="Delete userscript" style="color: #ef4444; width: 24px; height: 24px;">×</button>
        </div>
      `;

      card.querySelector('.us-edit-btn').onclick = () => openUserscriptEditor(us);
      card.querySelector('.us-toggle').onchange = (e) => {
        window.bridge.send('toggle_userscript', { id: us.id, enabled: e.target.checked });
      };
      card.querySelector('.us-delete-btn').onclick = () => {
        if (confirm(`Delete userscript "${us.name}"?`)) {
          window.bridge.send('delete_userscript', { id: us.id });
        }
      };

      listEl.appendChild(card);
    });
  }

  function openUserscriptEditor(script) {
    const backdrop = document.getElementById('userscript-editor-modal-backdrop');
    if (!backdrop) return;
    document.getElementById('edit-us-id').value = script.id || ('us_' + Date.now());
    document.getElementById('edit-us-name').value = script.name || '';
    document.getElementById('edit-us-version').value = script.version || '1.0.0';
    document.getElementById('edit-us-desc').value = script.description || '';
    document.getElementById('edit-us-matches').value = (script.matches || ['<all_urls>']).join(', ');
    document.getElementById('edit-us-run-at').value = script.run_at || 'document_end';
    document.getElementById('edit-us-code').value = script.code || '';
    backdrop.style.display = 'flex';
  }

  function closeUserscriptEditor() {
    const backdrop = document.getElementById('userscript-editor-modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  const closeUsBtn = document.getElementById('btn-close-userscript-modal');
  const cancelUsBtn = document.getElementById('btn-cancel-userscript');
  if (closeUsBtn) closeUsBtn.onclick = closeUserscriptEditor;
  if (cancelUsBtn) cancelUsBtn.onclick = closeUserscriptEditor;

  const usForm = document.getElementById('userscript-editor-form');
  if (usForm) {
    usForm.onsubmit = (e) => {
      e.preventDefault();
      const rawMatches = document.getElementById('edit-us-matches').value || '<all_urls>';
      const matches = rawMatches.split(',').map(m => m.trim()).filter(Boolean);
      const script = {
        id: document.getElementById('edit-us-id').value,
        name: document.getElementById('edit-us-name').value.trim() || 'Custom Script',
        version: document.getElementById('edit-us-version').value.trim() || '1.0.0',
        description: document.getElementById('edit-us-desc').value.trim(),
        matches: matches.length > 0 ? matches : ['<all_urls>'],
        run_at: document.getElementById('edit-us-run-at').value,
        enabled: true,
        code: document.getElementById('edit-us-code').value
      };
      window.bridge.send('save_userscript', { script });
      closeUserscriptEditor();
    };
  }

  window.bridge.on('extensions_and_scripts', (data) => {
    if (!data) return;
    renderExtensionsList(data.extensions || [], data.is_windows !== false, data.vault_active === true);
    renderUserscriptsList(data.userscripts || [], data.vault_active === true);
  });

  window.bridge.on('extension_loaded', (data) => {
    if (data && data.success) {
      window.bridge.send('get_extensions_and_scripts', {});
    } else if (data && data.error) {
      alert('Extension load failed: ' + data.error);
    }
  });

  window.bridge.on('extension_toggled', () => window.bridge.send('get_extensions_and_scripts', {}));
  window.bridge.on('extension_removed', () => window.bridge.send('get_extensions_and_scripts', {}));
  window.bridge.on('userscript_saved', () => window.bridge.send('get_extensions_and_scripts', {}));
  window.bridge.on('userscript_toggled', () => window.bridge.send('get_extensions_and_scripts', {}));
  window.bridge.on('userscript_deleted', () => window.bridge.send('get_extensions_and_scripts', {}));

  function updateOmniboxPlaceholder(engineId) {
    if (!omniboxInput) return;
    const custom = (window.Settings && window.Settings.get('custom_engines')) || [];
    const eng = window.RustyEngines ? window.RustyEngines.getById(engineId || 'google', custom) : null;
    const label = eng ? eng.name : 'Google';
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
    if (s.accent_palette) {
      root.setAttribute('data-palette', s.accent_palette);
      const selPalette = document.getElementById('setting-accent-palette');
      if (selPalette && selPalette.value !== s.accent_palette) {
        selPalette.value = s.accent_palette;
      }
    }
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
    updateOmniboxEngineOutline();
    if (settingsModal && settingsModal.style.display === 'flex') {
      populateSettingsUI();
    }
  }

  // Initialize from loaded Settings
  if (window.Settings && window.Settings.data) {
    applyHostSettingsToChrome(window.Settings.data);
  }
  window.addEventListener('settings-changed', () => updateOmniboxEngineOutline());

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
  window.bridge.on('focus_omnibox', () => {
    if (omniboxInput) {
      omniboxInput.focus();
      omniboxInput.select();
    }
  });

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
      updateOmniboxEngineOutline();
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

    if (data.split_view) applySplitViewState(data.split_view);

    if (window.bridge.isMock && viewport) updateMockViewport(activeUrl);

    if (activeSidePanel) renderSidePanel();

    reportContentRect();
  });

  // ── 14. Memory Badge Updates & Process Breakdown Modal ────────────────────
  function getMemoryPrivateWs(mem) {
    if (!mem) return 0;
    return typeof mem.private_ws_mb === 'number' ? mem.private_ws_mb : (Number(mem.total_mb) || 0);
  }

  function refreshMemoryBadgeDisplay() {
    if (!memoryText || !lastMemoryInfo) return;
    const privateWs = getMemoryPrivateWs(lastMemoryInfo);
    const workingSet = Number(lastMemoryInfo.working_set_mb) || privateWs;
    const commitMb = Number(lastMemoryInfo.commit_mb) || privateWs;
    const hostMb = Number(lastMemoryInfo.host_private_ws_mb) || 0;
    const procCount = Number(lastMemoryInfo.process_count) || (Array.isArray(lastMemoryInfo.processes) ? lastMemoryInfo.processes.length : 1);

    memoryText.textContent = privateWs > 0 ? `${privateWs.toFixed(0)} MB` : '-- MB';
    if (memoryBadge) {
      const lines = [
        `Metric: Private Working Set (Task Manager "Memory" column)`,
        `Browser Tree Total: ${privateWs.toFixed(1)} MB across ${procCount} processes (Host: ${hostMb.toFixed(1)} MB)`,
        `Working Set (incl. shared): ${workingSet.toFixed(1)} MB • Commit: ${commitMb.toFixed(1)} MB`
      ];
      if (lastMemoryInfo.savings_percent !== undefined) {
        const cmpMode = lastMemoryInfo.chrome_live_measured
          ? `live Chrome tree (${Number(lastMemoryInfo.chrome_baseline_mb).toFixed(1)} MB Private WS, ${lastMemoryInfo.chrome_process_count} procs)`
          : `Chrome Private WS baseline (${Number(lastMemoryInfo.chrome_baseline_mb).toFixed(1)} MB)`;
        const sav = Number(lastMemoryInfo.savings_percent);
        const dirWord = sav >= 0 ? 'less' : 'more';
        lines.push(`${Math.abs(sav).toFixed(1)}% ${dirWord} vs ${cmpMode}`);
      }
      if (lastTelemetryInfo) {
        lines.push(`OS CPU: ${Math.round(lastTelemetryInfo.sys_cpu_percent)}% • OS RAM: ${Math.round(lastTelemetryInfo.sys_ram_percent)}% (${lastTelemetryInfo.sys_ram_used_gb}/${lastTelemetryInfo.sys_ram_total_gb} GB)`);
      }
      lines.push('Click for per-process breakdown & Task Manager guide');
      memoryBadge.title = lines.join('\n');
    }
  }

  function renderMemoryModal() {
    const subEl = document.getElementById('memory-modal-subtitle');
    const summaryEl = document.getElementById('memory-summary-grid');
    const noteEl = document.getElementById('memory-taskmgr-note');
    const tbody = document.getElementById('memory-table-body');
    const tfoot = document.getElementById('memory-table-foot');
    if (!summaryEl || !tbody || !tfoot) return;

    const mem = lastMemoryInfo || {
      private_ws_mb: 0,
      total_mb: 0,
      working_set_mb: 0,
      commit_mb: 0,
      host_private_ws_mb: 0,
      process_count: 0,
      processes: []
    };

    const pws = getMemoryPrivateWs(mem);
    const ws = Number(mem.working_set_mb) || 0;
    const commit = Number(mem.commit_mb) || 0;
    const host = Number(mem.host_private_ws_mb) || 0;
    const webviewPrivate = Math.max(0, pws - host);
    const procs = Array.isArray(mem.processes) ? mem.processes : [];
    const procCount = Number(mem.process_count) || procs.length;

    if (subEl) {
      subEl.textContent = `Metric: Private Working Set (Task Manager "Memory" column) • ${procCount} process(es) in Rusty Browser tree`;
    }

    const sav = Number(mem.savings_percent || 0);
    const chromeMb = Number(mem.chrome_baseline_mb || 0);
    const chromeText = mem.chrome_live_measured
      ? `Chrome live tree: ${chromeMb.toFixed(1)} MB (${mem.chrome_process_count} procs)`
      : `Chrome baseline: ${chromeMb.toFixed(1)} MB Private WS`;

    summaryEl.innerHTML = `
      <div class="memory-summary-card">
        <div class="memory-summary-label">Private Working Set</div>
        <div class="memory-summary-value">${pws.toFixed(1)} MB</div>
        <div class="memory-summary-sub">Host ${host.toFixed(1)} MB + WebView2 ${webviewPrivate.toFixed(1)} MB</div>
      </div>
      <div class="memory-summary-card">
        <div class="memory-summary-label">Working Set (Shared)</div>
        <div class="memory-summary-value">${ws.toFixed(1)} MB</div>
        <div class="memory-summary-sub">Includes shared DLL &amp; GPU pages</div>
      </div>
      <div class="memory-summary-card">
        <div class="memory-summary-label">Private Commit</div>
        <div class="memory-summary-value">${commit.toFixed(1)} MB</div>
        <div class="memory-summary-sub">Pagefile-backed virtual commit</div>
      </div>
      <div class="memory-summary-card">
        <div class="memory-summary-label">vs Chrome (Private WS)</div>
        <div class="memory-summary-value">${sav >= 0 ? `-${sav.toFixed(1)}%` : `+${Math.abs(sav).toFixed(1)}%`}</div>
        <div class="memory-summary-sub">${escapeHtml(chromeText)}</div>
      </div>
    `;

    if (noteEl) {
      noteEl.innerHTML = `<strong>Which Task Manager row matches?</strong> Windows lists the tiny Rust host (<code>${host.toFixed(1)} MB</code>) separately from <code>msedgewebview2.exe</code> children in the Processes tab unless grouped under the app. Open <strong>Task Manager → Details</strong>, enable the <strong>"Memory (active private working set)"</strong> column, and look up the PIDs below — their Private WS sum matches the badge.`;
    }

    tbody.innerHTML = '';
    procs.forEach((p) => {
      const tr = document.createElement('tr');
      const roleClass = String(p.kind || '').includes('Host') ? 'role-host' : '';
      tr.innerHTML = `
        <td class="${roleClass}">${escapeHtml(p.kind || 'Process')}</td>
        <td><code>${escapeHtml(p.exe_name || '')}</code></td>
        <td>${Number(p.pid) || 0}</td>
        <td class="num"><strong>${Number(p.private_ws_mb || 0).toFixed(1)} MB</strong></td>
        <td class="num">${Number(p.working_set_mb || 0).toFixed(1)} MB</td>
        <td class="num">${Number(p.commit_mb || 0).toFixed(1)} MB</td>
      `;
      tbody.appendChild(tr);
    });

    tfoot.innerHTML = `
      <tr>
        <td colspan="3">Total (${procCount} processes)</td>
        <td class="num">${pws.toFixed(1)} MB</td>
        <td class="num">${ws.toFixed(1)} MB</td>
        <td class="num">${commit.toFixed(1)} MB</td>
      </tr>
    `;
  }

  function openMemoryModal() {
    if (!modalOverlay || !memoryModal) return;
    hideAllModalPanels();
    isOverlayOpen = true;
    modalOverlay.classList.add('open');
    memoryModal.style.display = 'flex';
    if (memoryCopyStatus) memoryCopyStatus.textContent = '';
    window.bridge.send('overlay', { open: true });
    renderMemoryModal();
  }

  function buildMemoryReportText() {
    const mem = lastMemoryInfo;
    if (!mem) return 'No memory telemetry sampled yet.';
    const pws = getMemoryPrivateWs(mem);
    const ws = Number(mem.working_set_mb) || 0;
    const commit = Number(mem.commit_mb) || 0;
    const procs = Array.isArray(mem.processes) ? mem.processes : [];
    const lines = [
      `Rusty Browser Memory Report (${new Date().toISOString()})`,
      `Headline Metric: Private Working Set (Task Manager "Memory" metric)`,
      `Total Private Working Set: ${pws.toFixed(1)} MB (${mem.process_count || procs.length} processes)`,
      `Total Working Set (incl. shared): ${ws.toFixed(1)} MB`,
      `Total Commit Charge: ${commit.toFixed(1)} MB`,
      `Host Process Private WS: ${Number(mem.host_private_ws_mb || 0).toFixed(1)} MB`,
      mem.chrome_live_measured
        ? `Comparison vs Live Chrome Tree (Private WS): ${Number(mem.savings_percent || 0).toFixed(1)}% (${Number(mem.chrome_baseline_mb || 0).toFixed(1)} MB across ${mem.chrome_process_count} Chrome processes)`
        : `Comparison vs Chrome Private WS Baseline: ${Number(mem.savings_percent || 0).toFixed(1)}% (${Number(mem.chrome_baseline_mb || 0).toFixed(1)} MB baseline)`,
      ``,
      `PID\tPPID\tRole\tExecutable\tPrivateWS_MB\tWorkingSet_MB\tCommit_MB`
    ];
    procs.forEach((p) => {
      lines.push(
        `${p.pid}\t${p.parent_pid}\t${p.kind}\t${p.exe_name}\t${Number(p.private_ws_mb || 0).toFixed(1)}\t${Number(p.working_set_mb || 0).toFixed(1)}\t${Number(p.commit_mb || 0).toFixed(1)}`
      );
    });
    return lines.join('\n');
  }

  if (memoryBadge) memoryBadge.addEventListener('click', openMemoryModal);
  if (memoryCloseBtn) memoryCloseBtn.addEventListener('click', closeAllModals);
  if (btnCloseMemoryFooter) btnCloseMemoryFooter.addEventListener('click', closeAllModals);
  if (btnCopyMemoryReport) {
    btnCopyMemoryReport.addEventListener('click', () => {
      const reportText = buildMemoryReportText();
      if (window.bridge) {
        window.bridge.send('copy_to_clipboard', { text: reportText });
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(reportText).catch(() => {});
      }
      if (memoryCopyStatus) {
        memoryCopyStatus.textContent = 'Copied report to clipboard!';
        setTimeout(() => {
          if (memoryCopyStatus) memoryCopyStatus.textContent = '';
        }, 2500);
      }
    });
  }

  function updateMemoryBadge(mem) {
    lastMemoryInfo = mem;
    refreshMemoryBadgeDisplay();
    if (memoryModal && memoryModal.style.display === 'flex') {
      renderMemoryModal();
    }
  }

  window.bridge.on('memory_stats', updateMemoryBadge);
  window.bridge.on('telemetry_stats', (snap) => {
    lastTelemetryInfo = snap;
    refreshMemoryBadgeDisplay();
  });

  // ── 15. Mock Viewport Iframe for standalone browser preview ──────────────
  let mockIframe = null;
  let mockSplitLeftIframe = null;
  let mockSplitRightIframe = null;

  function resolveMockSrc(url, skin, theme, palette) {
    const pal = palette || (document.documentElement.getAttribute('data-palette') || 'slate');
    return (!url || url === 'about:blank' || url.startsWith('about:') || url.includes('newtab.html'))
      ? `newtab.html?skin=${encodeURIComponent(skin)}&theme=${encodeURIComponent(theme)}&palette=${encodeURIComponent(pal)}`
      : url;
  }

  function updateMockViewport(url) {
    if (!viewport) return;
    const root = document.documentElement;
    const skin = root.getAttribute('data-skin') || 'crazy';
    const theme = root.getAttribute('data-theme') || 'sunset';
    const palette = root.getAttribute('data-palette') || 'slate';

    if (splitState.enabled && splitPaneLeft && splitPaneRight) {
      if (mockIframe) mockIframe.style.display = 'none';
      if (!mockSplitLeftIframe) {
        mockSplitLeftIframe = document.createElement('iframe');
        mockSplitLeftIframe.style.cssText = 'width:100%;height:100%;border:none;';
        splitPaneLeft.appendChild(mockSplitLeftIframe);
      }
      if (!mockSplitRightIframe) {
        mockSplitRightIframe = document.createElement('iframe');
        mockSplitRightIframe.style.cssText = 'width:100%;height:100%;border:none;';
        splitPaneRight.appendChild(mockSplitRightIframe);
      }
      mockSplitLeftIframe.style.display = 'block';
      mockSplitRightIframe.style.display = 'block';

      const leftSrc = resolveMockSrc(splitState.left_url || 'about:blank', skin, theme, palette);
      const rightSrc = resolveMockSrc(splitState.right_url || 'about:blank', skin, theme, palette);
      if (mockSplitLeftIframe.src !== leftSrc && !mockSplitLeftIframe.src.endsWith(leftSrc)) {
        mockSplitLeftIframe.src = leftSrc;
      }
      if (mockSplitRightIframe.src !== rightSrc && !mockSplitRightIframe.src.endsWith(rightSrc)) {
        mockSplitRightIframe.src = rightSrc;
      }
      return;
    }

    if (mockSplitLeftIframe) mockSplitLeftIframe.style.display = 'none';
    if (mockSplitRightIframe) mockSplitRightIframe.style.display = 'none';
    if (!mockIframe) {
      mockIframe = document.createElement('iframe');
      mockIframe.style.width = '100%';
      mockIframe.style.height = '100%';
      mockIframe.style.border = 'none';
      viewport.appendChild(mockIframe);
    }
    mockIframe.style.display = 'block';
    const targetSrc = resolveMockSrc(url, skin, theme, palette);
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
    { title: 'Toggle Split View', action: () => window.bridge.send('split_view'), badge: 'Layout' },
    { title: 'Toggle Vertical Tabs', action: () => window.toggleTabsLayout(), badge: 'Layout' },
    { title: 'Toggle Compact Sidebar', action: () => btnCollapseSidebar && btnCollapseSidebar.click(), badge: 'Layout' },
    { title: 'Toggle Zen Focus Mode', action: toggleZenMode, badge: 'View' },
    { title: 'Find in Page', action: openFindBar, badge: 'Find' },
    { title: 'Open Bookmarks Panel', action: () => openSidePanel('bookmarks'), badge: 'Panel' },
    { title: 'Open History Panel', action: () => openSidePanel('history'), badge: 'Panel' },
    { title: 'Open Downloads Panel', action: () => openSidePanel('downloads'), badge: 'Panel' },
    { title: 'Inspect Process Memory Breakdown', action: openMemoryModal, badge: 'Memory' },
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
    hideAllModalPanels();
    isOverlayOpen = true;
    modalOverlay.classList.add('open');
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
    closeAllModals();
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
        url: b.url,
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
        url: h.url,
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
      el.addEventListener('click', (e) => {
        closeCommandPalette();
        if (item.url && (e.ctrlKey || e.metaKey || e.shiftKey)) {
          window.bridge.send('new_tab', {
            url: item.url,
            background: e.shiftKey ? false : null,
            title: item.title
          });
        } else {
          item.action();
        }
      });
      if (item.url) {
        el.addEventListener('auxclick', (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          closeCommandPalette();
          window.bridge.send('new_tab', {
            url: item.url,
            background: e.shiftKey ? false : null,
            title: item.title
          });
        });
      }
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
      if (e.key === 'Escape') closeAllModals();
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
        closeAllModals();
      }
    });
  }

  // ── 17. Global Keyboard Accelerators ─────────────────────────────────────
  let currentWorkspaces = [];
  let currentActiveWorkspaceId = 'main';

  window.bridge.on('workspaces_update', (data) => {
    if (data && data.workspaces) {
      currentWorkspaces = data.workspaces;
      if (data.active_workspace_id) currentActiveWorkspaceId = data.active_workspace_id;
    }
  });

  window.addEventListener('keydown', (e) => {
    // Ctrl+Alt+1..9 -> Switch Workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key >= '1' && e.key <= '9') {
      const targetIdx = parseInt(e.key, 10) - 1;
      if (currentWorkspaces[targetIdx]) {
        e.preventDefault();
        window.bridge.send('switch_workspace', { workspace_id: currentWorkspaces[targetIdx].id });
        return;
      }
    }
    // Ctrl+K -> Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOverlayOpen) closeAllModals();
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
    // Ctrl+\ -> Toggle Split View
    else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      window.bridge.send('split_view');
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
      if (omniboxInput) {
        omniboxInput.focus();
        omniboxInput.select();
      }
    }
    // Escape -> Close Context Menu, Find Bar, or Modals
    else if (e.key === 'Escape') {
      closeContextMenu();
      if (isFindOpen) closeFindBar();
      if (isOverlayOpen) closeAllModals();
    }
  });

  // Initial layout report
  setTimeout(reportContentRect, 100);
})();

