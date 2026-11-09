// IPC Bridge: Bidirectional messaging between Chrome UI webview and Rust backend
// Includes a standalone MOCK mode when window.ipc is absent (for previewing in any browser).
(function (root) {
  'use strict';

  const isRealIpc = typeof window.ipc !== 'undefined' && typeof window.ipc.postMessage === 'function';
  const listeners = new Map();

  // Mock state for standalone browser preview
  let mockGroups = [
    { id: 'dev', name: 'Dev & Docs', color: '#3b82f6', collapsed: false },
    { id: 'media', name: 'Entertainment', color: '#ec4899', collapsed: false }
  ];

  let mockTabs = [
    { id: 1, title: 'New Tab', url: 'about:blank', active: true, sleeping: false, pinned: false, muted: false, group_id: null },
    { id: 2, title: 'GitHub: Where the world builds software', url: 'https://github.com', active: false, sleeping: false, pinned: false, muted: false, group_id: 'dev' },
    { id: 3, title: 'The Rust Programming Language', url: 'https://www.rust-lang.org', active: false, sleeping: true, pinned: false, muted: false, group_id: 'dev' },
    { id: 4, title: 'YouTube: Music & Videos', url: 'https://youtube.com', active: false, sleeping: false, pinned: true, muted: true, group_id: null }
  ];

  let mockBookmarks = [
    { id: 1, title: 'GitHub', url: 'https://github.com', created_at: Date.now() - 86400000 },
    { id: 2, title: 'Rust Lang', url: 'https://www.rust-lang.org', created_at: Date.now() - 43200000 },
    { id: 3, title: 'Crates.io', url: 'https://crates.io', created_at: Date.now() - 20000000 }
  ];

  let mockHistory = [
    { title: 'DuckDuckGo — Privacy, simplified', url: 'https://duckduckgo.com', visited_at: Date.now() - 600000 },
    { title: 'GitHub: Where the world builds software', url: 'https://github.com', visited_at: Date.now() - 1200000 },
    { title: 'The Rust Programming Language', url: 'https://www.rust-lang.org', visited_at: Date.now() - 3600000 }
  ];

  let mockDownloads = [
    { id: 1, filename: 'rusty_browser-v0.2.0-windows-x64.zip', url: 'https://github.com/rusty/browser/releases', state: 'completed', progress: 100 },
    { id: 2, filename: 'rustup-init.exe', url: 'https://win.rustup.rs', state: 'in_progress', progress: 68 }
  ];

  let mockMemory = {
    total_mb: 84.5,
    chrome_baseline_mb: 236.0,
    savings_percent: 64.2
  };

  const Bridge = {
    isMock: !isRealIpc,

    send(action, payload = {}) {
      const msg = { action, ...payload };
      if (isRealIpc) {
        try {
          window.ipc.postMessage(JSON.stringify(msg));
        } catch (err) {
          console.error('[bridge] Failed to send IPC message:', err);
        }
      } else {
        // Handle mock actions
        this._handleMockAction(action, payload);
      }
    },

    on(event, handler) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
    },

    off(event, handler) {
      if (listeners.has(event)) {
        listeners.get(event).delete(handler);
      }
    },

    dispatch(event, data) {
      if (listeners.has(event)) {
        listeners.get(event).forEach((cb) => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[bridge] Error in handler for event "${event}":`, e);
          }
        });
      }
    },

    _handleMockAction(action, payload) {
      // console.log(`[bridge:mock] Action: ${action}`, payload);
      switch (action) {
        case 'new_tab': {
          const newId = Date.now();
          const tab = {
            id: newId,
            title: 'New Tab',
            url: payload.url || 'about:blank',
            active: true,
            sleeping: false,
            pinned: false,
            group_id: null
          };
          mockTabs.forEach((t) => (t.active = false));
          mockTabs.push(tab);
          this._emitMockState();
          break;
        }
        case 'switch_tab': {
          mockTabs.forEach((t) => (t.active = t.id === payload.tab_id));
          const activeTab = mockTabs.find((t) => t.id === payload.tab_id);
          if (activeTab && activeTab.sleeping) {
            activeTab.sleeping = false; // wake tab
          }
          this._emitMockState();
          break;
        }
        case 'close_tab': {
          const idx = mockTabs.findIndex((t) => t.id === payload.tab_id);
          if (idx !== -1) {
            const wasActive = mockTabs[idx].active;
            mockTabs.splice(idx, 1);
            if (wasActive && mockTabs.length > 0) {
              mockTabs[Math.max(0, idx - 1)].active = true;
            }
          }
          this._emitMockState();
          break;
        }
        case 'navigate': {
          const active = mockTabs.find((t) => t.active);
          if (active) {
            active.url = payload.url;
            active.title = payload.url.replace(/^https?:\/\//, '');
          }
          this._emitMockState();
          break;
        }
        case 'toggle_bookmark': {
          const active = mockTabs.find((t) => t.active);
          if (active) {
            const existsIdx = mockBookmarks.findIndex((b) => b.url === active.url);
            if (existsIdx >= 0) {
              mockBookmarks.splice(existsIdx, 1);
            } else {
              mockBookmarks.push({ id: Date.now(), title: active.title, url: active.url, created_at: Date.now() });
            }
          }
          this._emitMockState();
          break;
        }
        case 'wake_tab': {
          const tab = mockTabs.find((t) => t.id === payload.tab_id);
          if (tab) {
            tab.sleeping = false;
            tab.active = true;
            mockTabs.forEach((t) => { if (t.id !== tab.id) t.active = false; });
          }
          this._emitMockState();
          break;
        }
        case 'sleep_tab': {
          const tab = mockTabs.find((t) => t.id === payload.tab_id);
          if (tab) {
            tab.sleeping = true;
          }
          this._emitMockState();
          break;
        }
        case 'pin_tab': {
          const tab = mockTabs.find((t) => t.id === payload.tab_id);
          if (tab) {
            tab.pinned = payload.pinned !== undefined ? payload.pinned : !tab.pinned;
          }
          this._emitMockState();
          break;
        }
        case 'mute_tab': {
          const tab = mockTabs.find((t) => t.id === payload.tab_id);
          if (tab) {
            tab.muted = payload.muted !== undefined ? payload.muted : !tab.muted;
          }
          this._emitMockState();
          break;
        }
        case 'duplicate_tab': {
          const tab = mockTabs.find((t) => t.id === payload.tab_id);
          if (tab) {
            const idx = mockTabs.indexOf(tab);
            const copy = {
              ...tab,
              id: Date.now(),
              active: false,
              title: `${tab.title} (Copy)`
            };
            mockTabs.splice(idx + 1, 0, copy);
          }
          this._emitMockState();
          break;
        }
        case 'close_other_tabs': {
          mockTabs = mockTabs.filter((t) => t.id === payload.tab_id || t.pinned);
          this._emitMockState();
          break;
        }
        case 'close_tabs_below': {
          const idx = mockTabs.findIndex((t) => t.id === payload.tab_id);
          if (idx !== -1) {
            mockTabs = mockTabs.filter((t, i) => i <= idx || t.pinned);
          }
          this._emitMockState();
          break;
        }
        case 'reorder_tabs': {
          const fromIdx = mockTabs.findIndex((t) => t.id === payload.from_id);
          const toIdx = mockTabs.findIndex((t) => t.id === payload.to_id);
          if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
            const [moved] = mockTabs.splice(fromIdx, 1);
            // If dragging into another group, update group_id
            const target = mockTabs[toIdx > fromIdx ? toIdx - 1 : toIdx];
            if (target && !moved.pinned) {
              moved.group_id = target.group_id;
            }
            const insertAt = payload.position === 'after' ? (toIdx > fromIdx ? toIdx : toIdx + 1) : (toIdx > fromIdx ? toIdx - 1 : toIdx);
            mockTabs.splice(Math.max(0, insertAt), 0, moved);
          }
          this._emitMockState();
          break;
        }
        case 'create_group': {
          const newGrp = {
            id: 'grp_' + Date.now(),
            name: payload.name || 'New Group',
            color: payload.color || '#3b82f6',
            collapsed: false
          };
          mockGroups.push(newGrp);
          if (payload.tab_id) {
            const tab = mockTabs.find((t) => t.id === payload.tab_id);
            if (tab) tab.group_id = newGrp.id;
          }
          this._emitMockState();
          break;
        }
        case 'set_tab_group': {
          const tab = mockTabs.find((t) => t.id === payload.tab_id);
          if (tab) {
            tab.group_id = payload.group_id || null;
          }
          this._emitMockState();
          break;
        }
        case 'toggle_group_collapse': {
          const grp = mockGroups.find((g) => g.id === payload.group_id);
          if (grp) {
            grp.collapsed = !grp.collapsed;
          }
          this._emitMockState();
          break;
        }
        case 'content_rect': {
          // Track layout changes
          break;
        }
        case 'set_setting': {
          const settings = root.Settings ? { ...root.Settings.data, [payload.key]: payload.value } : { [payload.key]: payload.value };
          this.dispatch('ui_settings_sync', { settings });
          break;
        }
        case 'save_settings': {
          this.dispatch('ui_settings_sync', { settings: payload.settings || {} });
          break;
        }
        case 'fetch_weather': {
          const loc = (payload && payload.location) ? payload.location.trim() : 'Preview City';
          this.dispatch('weather_update', {
            temperature_c: 26.4,
            apparent_c: 27.0,
            humidity: 44,
            wind_kmh: 9.2,
            condition: 'Clear Sky (Preview)',
            icon: 'sun',
            location: loc || 'Preview City',
            is_day: true,
            weather_code: 0,
            updated_secs: Math.floor(Date.now() / 1000),
            query: (payload && payload.location) || ''
          });
          break;
        }
        case 'open_settings': {
          this.dispatch('open_settings', {});
          break;
        }
        case 'open_command_palette': {
          this.dispatch('open_command_palette', {});
          break;
        }
        case 'open_side_panel': {
          this.dispatch('open_side_panel', { panel: payload.panel || 'bookmarks' });
          break;
        }
        case 'open_find_bar': {
          this.dispatch('open_find_bar', {});
          break;
        }
        default:
          break;
      }
    },

    _emitMockState() {
      const active = mockTabs.find((t) => t.active) || mockTabs[0];
      const isBookmarked = active ? mockBookmarks.some((b) => b.url === active.url) : false;
      this.dispatch('state_update', {
        tabs: mockTabs,
        groups: mockGroups,
        bookmarks: mockBookmarks,
        history: mockHistory,
        downloads: mockDownloads,
        active_tab: active ? active.id : 1,
        url: active ? active.url : 'about:blank',
        title: active ? active.title : 'New Tab',
        can_go_back: true,
        can_go_forward: false,
        is_bookmarked: isBookmarked,
        zoom_percent: 100,
        memory: mockMemory
      });
    }
  };

  // Real IPC receiver: Rust evaluates `window.__onRustMessage(msg)` or calls bridge directly
  window.__onRustMessage = function (data) {
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        console.error('[bridge] Bad JSON from Rust:', e);
        return;
      }
    }
    const type = data.type || 'state_update';
    Bridge.dispatch(type, data);
  };

  function getUiRole() {
    if (document.body && document.body.classList.contains('ntp-body')) {
      return 'newtab';
    }
    if (window.location && String(window.location.pathname).includes('newtab')) {
      return 'newtab';
    }
    return 'chrome';
  }

  function onDomReady() {
    if (Bridge.isMock) {
      console.info('%c[bridge:mock] Standalone preview mode active (no native IPC found).', 'color: #3b82f6; font-weight: bold;');
      setTimeout(() => {
        Bridge._emitMockState();
        Bridge.dispatch('telemetry_stats', {
          sys_cpu_percent: 14.0,
          sys_ram_percent: 42.0,
          sys_ram_used_gb: 6.7,
          sys_ram_total_gb: 16.0,
          sys_gpu_percent: 5.0,
          net_kbps: 12.4,
          browser_mb: mockMemory.total_mb
        });
        Bridge._handleMockAction('fetch_weather', { location: '' });
        setInterval(() => {
          mockMemory.total_mb = +(84.0 + Math.random() * 2.5).toFixed(1);
          mockMemory.savings_percent = +(100 - (mockMemory.total_mb / mockMemory.chrome_baseline_mb) * 100).toFixed(1);
          Bridge.dispatch('memory_stats', mockMemory);
        }, 5000);
      }, 30);
    } else {
      // Wait one tick after DOMContentLoaded so deferred listeners register first
      setTimeout(() => {
        Bridge.send('ui_ready', { role: getUiRole() });
      }, 0);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
  } else {
    onDomReady();
  }

  root.bridge = Bridge;
})(typeof window !== 'undefined' ? window : this);
