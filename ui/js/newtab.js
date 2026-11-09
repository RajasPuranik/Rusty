// New Tab Page Controller: Merged Time & Weather, Engine-Colored Search, Dials, Cards, Notes, Focus Timer, System Monitor
(function () {
  'use strict';

  const WEATHER_CACHE_KEY = 'rusty_weather_cache_v2';
  const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

  let activeEngine = (window.Settings && window.Settings.get('default_search')) || 'google';
  let savedWeatherQuery = (window.Settings && window.Settings.get('weather_location')) || '';
  let lastWeatherData = null;
  let manualGeoCoords = null;

  const DEFAULT_SPEED_DIALS = [
    { title: 'YouTube', url: 'https://youtube.com', avatar: 'YT', color: '#ef4444' },
    { title: 'GitHub', url: 'https://github.com', avatar: 'GH', color: '#1e293b' },
    { title: 'Notion', url: 'https://notion.so', avatar: 'N', color: '#0f172a' },
    { title: 'Google Drive', url: 'https://drive.google.com', avatar: 'GD', color: '#3b82f6' },
    { title: 'Blender', url: 'https://blender.org', avatar: 'BL', color: '#f97316' },
    { title: 'Steam', url: 'https://store.steampowered.com', avatar: 'ST', color: '#172554' }
  ];

  const DEFAULT_NOTES = [
    { text: 'Finish SIH PPT', done: false },
    { text: 'Render Animation', done: false },
    { text: 'Thermo - Unit I', done: true }
  ];

  // DOM Elements
  const clockTime = document.getElementById('clock-time');
  const clockDate = document.getElementById('clock-date');
  const searchBox = document.getElementById('search-box');
  const searchInput = document.getElementById('search-input');
  const chipContainer = document.getElementById('engine-chips');
  const ntpCustomForm = document.getElementById('ntp-custom-engine-form');
  const ntpEngineName = document.getElementById('ntp-engine-name');
  const ntpEngineTemplate = document.getElementById('ntp-engine-template');
  const ntpEngineColor = document.getElementById('ntp-engine-color');
  const ntpEngineCancel = document.getElementById('ntp-engine-cancel');
  const speedDialGrid = document.getElementById('speed-dial-grid');
  const notesChecklist = document.getElementById('notes-checklist');
  const scratchpad = document.getElementById('scratchpad');
  const btnAddNote = document.getElementById('btn-add-note');
  const btnSearchAi = document.getElementById('btn-search-ai');
  const focusTimeDisplay = document.getElementById('focus-time-display');
  const btnFocusPlay = document.getElementById('btn-focus-play');
  const btnFocusReset = document.getElementById('btn-focus-settings');

  // Merged Time & Weather Elements
  const twCard = document.getElementById('widget-time-weather');
  const twCompactRow = document.getElementById('tw-compact-row');
  const twClockBlock = document.getElementById('tw-clock-block');
  const twWeatherBlock = document.getElementById('tw-weather-block');
  const twExpanded = document.getElementById('tw-expanded');
  const twExpandBtn = document.getElementById('tw-expand-btn');
  const twOfflineBadge = document.getElementById('weather-offline-badge');
  const twForecastSection = document.getElementById('tw-forecast-section');
  const weatherForecastRow = document.getElementById('weather-forecast-row');
  const worldClockList = document.getElementById('world-clock-list');
  const btnToggleWorldClockAdd = document.getElementById('btn-toggle-worldclock-add');
  const worldClockForm = document.getElementById('world-clock-form');
  const worldClockSelect = document.getElementById('world-clock-select');
  const weatherIcon = document.getElementById('weather-icon');
  const weatherTemp = document.getElementById('weather-temp');
  const weatherCondition = document.getElementById('weather-condition');
  const weatherLocation = document.getElementById('weather-location');
  const weatherMeta = document.getElementById('weather-meta');
  const btnWeatherRefresh = document.getElementById('btn-weather-refresh');
  const weatherCityForm = document.getElementById('weather-city-form');
  const weatherCityInput = document.getElementById('weather-city-input');
  const btnUseMyLocation = document.getElementById('btn-use-my-location');
  const toggleGlobeClouds = document.getElementById('toggle-globe-clouds');
  const globeSlot = document.getElementById('globe-slot');

  // System Monitor Elements
  const cpuVal = document.getElementById('cpu-val');
  const ramVal = document.getElementById('ram-val');
  const ramFill = document.getElementById('ram-fill');
  const gpuVal = document.getElementById('gpu-val');
  const cpuSparkPath = document.getElementById('cpu-spark-path');
  const gpuSparkPath = document.getElementById('gpu-spark-path');
  const monitorAppMem = document.getElementById('monitor-app-mem');
  const monitorNetSpeed = document.getElementById('monitor-net-speed');

  // Widget Containers (for live settings toggle)
  const elBrandHero = document.getElementById('brand-hero');
  const elSpeedDialSec = document.getElementById('speed-dial-section');
  const elWidgetNotes = document.getElementById('widget-notes');

  // ── 1. Digital Clock, Date & World Clocks ────────────────────────────────
  function formatWorldClockTime(tz) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(new Date());
    } catch (_) {
      return '--:--';
    }
  }

  function updateWorldClockTimesOnly() {
    if (!worldClockList || (twExpanded && twExpanded.hidden)) return;
    worldClockList.querySelectorAll('.world-clock-time[data-tz]').forEach((el) => {
      el.textContent = formatWorldClockTime(el.dataset.tz);
    });
  }

  function updateClock() {
    if (document.hidden) return;
    const now = new Date();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    if (clockTime) {
      clockTime.innerHTML = `${hoursStr}:${minutes} <span class="clock-ampm">${ampm}</span>`;
    }

    if (clockDate) {
      const options = { weekday: 'short', month: 'short', day: 'numeric' };
      clockDate.textContent = now.toLocaleDateString(undefined, options);
    }

    updateWorldClockTimesOnly();
  }

  setInterval(updateClock, 1000);
  updateClock();

  // ── 2. Search Engine Chips, Crisp Outline & Navigation (A4) ──────────────
  function getCustomEngines() {
    return (window.Settings && Array.isArray(window.Settings.get('custom_engines')))
      ? window.Settings.get('custom_engines')
      : [];
  }

  function applySearchBoxOutline() {
    if (!window.RustyEngines) return;
    const custom = getCustomEngines();
    const eng = window.RustyEngines.getById(activeEngine, custom);
    activeEngine = eng.id;
    if (searchBox) {
      window.RustyEngines.applyOutlineStyles(searchBox, eng.id, custom);
    }
    if (searchInput) {
      searchInput.placeholder = `Search with ${eng.name} or enter a URL...`;
    }
    if (chipContainer) {
      const resolved = window.RustyEngines.resolveOutlineColors(eng, custom);
      chipContainer.querySelectorAll('.chip[data-engine]').forEach((c) => {
        const isActive = c.dataset.engine === activeEngine;
        c.classList.toggle('active', isActive);
        if (isActive) {
          c.style.setProperty('--chip-color', resolved.caret);
        } else {
          c.style.removeProperty('--chip-color');
        }
      });
    }
  }

  function renderEngineChips() {
    if (!chipContainer || !window.RustyEngines) return;
    const custom = getCustomEngines();
    const engines = window.RustyEngines.getAll(custom);
    chipContainer.innerHTML = '';

    engines.forEach((eng) => {
      const resolved = window.RustyEngines.resolveOutlineColors(eng, custom);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip ${eng.id === activeEngine ? 'active' : ''}`;
      chip.dataset.engine = eng.id;

      const dot = document.createElement('span');
      dot.className = 'chip-color-dot';
      dot.style.background = resolved.swatch;
      chip.appendChild(dot);

      const label = document.createElement('span');
      label.textContent = eng.name;
      chip.appendChild(label);

      if (!eng.builtin) {
        const rem = document.createElement('span');
        rem.className = 'chip-remove';
        rem.title = `Remove ${eng.name}`;
        rem.textContent = '×';
        rem.addEventListener('click', (e) => {
          e.stopPropagation();
          window.RustyEngines.removeCustomEngine(eng.id);
          activeEngine = (window.Settings && window.Settings.get('default_search')) || 'google';
          renderEngineChips();
        });
        chip.appendChild(rem);
      }

      chip.addEventListener('click', () => {
        activeEngine = eng.id;
        applySearchBoxOutline();
        if (window.Settings) {
          window.Settings.set('default_search', eng.id);
        }
        searchInput && searchInput.focus();
      });

      chipContainer.appendChild(chip);
    });

    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.id = 'btn-add-engine-ntp';
    addChip.className = 'chip chip-add-engine';
    addChip.title = 'Add custom search engine';
    addChip.textContent = '+ Custom';
    addChip.addEventListener('click', () => {
      if (!ntpCustomForm) return;
      const open = ntpCustomForm.hidden;
      ntpCustomForm.hidden = !open;
      if (open) {
        if (ntpEngineColor && window.RustyEngines) {
          ntpEngineColor.value = window.RustyEngines.getDefaultAccentHex();
        }
        ntpEngineName && ntpEngineName.focus();
      }
    });
    chipContainer.appendChild(addChip);

    applySearchBoxOutline();
  }

  renderEngineChips();

  if (ntpEngineCancel && ntpCustomForm) {
    ntpEngineCancel.addEventListener('click', () => {
      ntpCustomForm.hidden = true;
    });
  }

  if (ntpCustomForm && window.RustyEngines) {
    ntpCustomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = ntpEngineName ? ntpEngineName.value.trim() : '';
      const template = ntpEngineTemplate ? ntpEngineTemplate.value.trim() : '';
      const color = ntpEngineColor ? ntpEngineColor.value : window.RustyEngines.getDefaultAccentHex();
      const added = window.RustyEngines.addCustomEngine({ name, template, color });
      if (added) {
        activeEngine = added.id;
        if (window.Settings) window.Settings.set('default_search', added.id);
        if (ntpEngineName) ntpEngineName.value = '';
        if (ntpEngineTemplate) ntpEngineTemplate.value = '';
        ntpCustomForm.hidden = true;
        renderEngineChips();
        searchInput && searchInput.focus();
      }
    });
  }

  function handleSearch(query) {
    if (!query) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    const custom = getCustomEngines();
    const targetUrl = window.RustyEngines
      ? window.RustyEngines.buildSearchUrl(trimmed, activeEngine, custom)
      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;

    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('navigate', { url: targetUrl });
    } else {
      window.location.href = targetUrl;
    }
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch(searchInput.value);
      }
    });
  }

  if (btnSearchAi) {
    btnSearchAi.addEventListener('click', () => {
      if (searchInput && searchInput.value) {
        handleSearch(searchInput.value);
      } else if (searchInput) {
        searchInput.focus();
        searchInput.placeholder = 'Search the web, @yt, @gh, or @w...';
      }
    });
  }

  // Keyboard shortcut '/' to focus search
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (e.key === '/' && !isTyping) {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  // Suppress Windows middle-click autoscroll icon on NTP interactive controls
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target && e.target.closest('a, button, .dial-pill, .workspace-chip, .dock-btn, .action-card')) {
      e.preventDefault();
    }
  }, true);

  function openNtpItemInNewTab(url, title, e) {
    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('new_tab', {
        url: url || 'about:blank',
        background: (e && e.shiftKey) ? false : null,
        title: title || null
      });
    } else if (url && !url.startsWith('about:')) {
      window.open(url, '_blank', 'noopener');
    }
  }

  // ── 3. Speed Dial Row ────────────────────────────────────────────────────
  function loadSpeedDials() {
    let dials = DEFAULT_SPEED_DIALS;
    try {
      const raw = localStorage.getItem('rusty_speed_dials');
      if (raw) dials = JSON.parse(raw);
    } catch (_) {}
    return dials;
  }

  function renderSpeedDials() {
    if (!speedDialGrid) return;
    speedDialGrid.innerHTML = '';
    const dials = loadSpeedDials();

    dials.forEach((d) => {
      const a = document.createElement('a');
      a.className = 'dial-pill';
      a.href = d.url;
      a.title = `${d.title} (Middle-click: open in new tab)`;
      a.style.backgroundColor = d.color || '#1e293b';
      a.textContent = d.avatar || d.title.slice(0, 2).toUpperCase();

      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          openNtpItemInNewTab(d.url, d.title, e);
          return;
        }
        if (window.bridge && typeof window.bridge.send === 'function') {
          window.bridge.send('navigate', { url: d.url });
        } else {
          window.location.href = d.url;
        }
      });

      a.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        openNtpItemInNewTab(d.url, d.title, e);
      });
      speedDialGrid.appendChild(a);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'dial-pill add-btn';
    addBtn.title = 'Add Site to Speed Dial';
    addBtn.innerHTML = window.Icons ? window.Icons.get('plus', '', 18) : '+';
    addBtn.addEventListener('click', () => {
      const title = prompt('Site Name (e.g. Reddit):');
      if (!title) return;
      const url = prompt('Site URL (e.g. https://reddit.com):');
      if (!url) return;
      const current = loadSpeedDials();
      current.push({
        title,
        url: url.startsWith('http') ? url : `https://${url}`,
        avatar: title.slice(0, 2).toUpperCase(),
        color: '#1e293b'
      });
      localStorage.setItem('rusty_speed_dials', JSON.stringify(current));
      renderSpeedDials();
    });
    speedDialGrid.appendChild(addBtn);
  }

  renderSpeedDials();

  // ── 4. Action Cards & Left Rail Dock Handlers ────────────────────────────
  document.querySelectorAll('.action-card').forEach((card) => {
    const action = card.dataset.action;
    const titleEl = card.querySelector('.action-card-title');
    const cardTitle = titleEl ? titleEl.textContent.trim() : 'New Tab';
    const newTabUrl = action === 'media'
      ? 'https://youtube.com'
      : action === 'tools'
        ? 'about:settings'
        : 'about:blank';

    card.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        openNtpItemInNewTab(newTabUrl, cardTitle, e);
        return;
      }
      if (action === 'ai') {
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      } else if (action === 'spaces') {
        window.bridge && window.bridge.send('open_command_palette');
      } else if (action === 'media') {
        window.bridge && window.bridge.send('navigate', { url: 'https://youtube.com' });
      } else if (action === 'tools') {
        window.bridge && window.bridge.send('open_settings');
      }
    });

    card.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      openNtpItemInNewTab(newTabUrl, cardTitle, e);
    });
  });

  const dockHome = document.getElementById('dock-btn-home');
  const dockApps = document.getElementById('dock-btn-apps');
  const dockSpaces = document.getElementById('dock-btn-spaces');
  const dockAi = document.getElementById('dock-btn-ai');
  const dockBookmarks = document.getElementById('dock-btn-bookmarks');
  const dockHistory = document.getElementById('dock-btn-history');
  const dockDownloads = document.getElementById('dock-btn-downloads');
  const dockSettings = document.getElementById('dock-btn-settings');

  function bindDockButton(btn, url, title, onNormalClick) {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        openNtpItemInNewTab(url, title, e);
        return;
      }
      onNormalClick();
    });
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      openNtpItemInNewTab(url, title, e);
    });
  }

  bindDockButton(dockHome, 'about:blank', 'New Tab', () => searchInput && searchInput.focus());
  bindDockButton(dockAi, 'about:blank', 'New Tab', () => searchInput && searchInput.focus());
  bindDockButton(dockApps, 'about:blank', 'New Tab', () => window.bridge && window.bridge.send('open_command_palette'));
  bindDockButton(dockSpaces, 'about:blank', 'New Tab', () => {
    const current = (window.Settings && window.Settings.get('tabs_layout')) || 'horizontal';
    const next = current === 'vertical' ? 'horizontal' : 'vertical';
    if (window.Settings) window.Settings.data.tabs_layout = next;
    window.bridge && window.bridge.send('set_setting', { key: 'tabs_layout', value: next });
  });
  bindDockButton(dockBookmarks, 'about:bookmarks', 'Bookmarks', () => window.bridge && window.bridge.send('open_side_panel', { panel: 'bookmarks' }));
  bindDockButton(dockHistory, 'about:history', 'History', () => window.bridge && window.bridge.send('open_side_panel', { panel: 'history' }));
  bindDockButton(dockDownloads, 'about:downloads', 'Downloads', () => window.bridge && window.bridge.send('open_side_panel', { panel: 'downloads' }));
  bindDockButton(dockSettings, 'about:settings', 'Settings', () => window.bridge && window.bridge.send('open_settings'));

  // ── 5. Quick Notes Checklist ─────────────────────────────────────────────
  function loadNotes() {
    try {
      const raw = localStorage.getItem('rusty_quick_notes');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return DEFAULT_NOTES;
  }

  function saveNotes(notes) {
    try {
      localStorage.setItem('rusty_quick_notes', JSON.stringify(notes));
    } catch (_) {}
  }

  function renderNotes() {
    if (!notesChecklist) return;
    const notes = loadNotes();
    notesChecklist.innerHTML = '';

    notes.forEach((item, index) => {
      const row = document.createElement('label');
      row.className = `note-item ${item.done ? 'completed' : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(item.done);
      cb.onchange = () => {
        notes[index].done = cb.checked;
        saveNotes(notes);
        renderNotes();
      };

      const span = document.createElement('span');
      span.textContent = item.text;

      row.appendChild(cb);
      row.appendChild(span);
      notesChecklist.appendChild(row);
    });
  }

  if (btnAddNote) {
    btnAddNote.addEventListener('click', () => {
      const text = prompt('New Note or Task:');
      if (text && text.trim()) {
        const notes = loadNotes();
        notes.push({ text: text.trim(), done: false });
        saveNotes(notes);
        renderNotes();
      }
    });
  }

  renderNotes();

  if (scratchpad) {
    scratchpad.value = localStorage.getItem('rusty_scratchpad') || '';
    scratchpad.addEventListener('input', () => {
      localStorage.setItem('rusty_scratchpad', scratchpad.value);
    });
  }

  // ── 6. Focus / Pomodoro Timer ────────────────────────────────────────────
  let pomodoroSeconds = 25 * 60;
  let isTimerRunning = false;
  let timerInterval = null;

  function formatTimer(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateTimerDisplay() {
    if (focusTimeDisplay) {
      focusTimeDisplay.textContent = formatTimer(pomodoroSeconds);
    }
  }

  if (btnFocusPlay) {
    btnFocusPlay.addEventListener('click', () => {
      if (isTimerRunning) {
        clearInterval(timerInterval);
        isTimerRunning = false;
        btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
      } else {
        isTimerRunning = true;
        btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('pause', '', 14) : '⏸';
        timerInterval = setInterval(() => {
          if (pomodoroSeconds > 0) {
            pomodoroSeconds--;
            updateTimerDisplay();
          } else {
            clearInterval(timerInterval);
            isTimerRunning = false;
            btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
            alert('Focus session completed! Take a break.');
          }
        }, 1000);
      }
    });
  }

  if (btnFocusReset) {
    btnFocusReset.addEventListener('click', () => {
      clearInterval(timerInterval);
      isTimerRunning = false;
      if (btnFocusPlay) btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
      pomodoroSeconds = 25 * 60;
      updateTimerDisplay();
    });
  }

  document.querySelectorAll('.focus-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.focus-mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      if (mode === 'study') pomodoroSeconds = 25 * 60;
      else if (mode === 'work') pomodoroSeconds = 50 * 60;
      else if (mode === 'deep') pomodoroSeconds = 90 * 60;
      clearInterval(timerInterval);
      isTimerRunning = false;
      if (btnFocusPlay) btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
      updateTimerDisplay();
    });
  });

  updateTimerDisplay();

  // ── 7. Merged Time & Weather Card (5-Day Forecast, World Clocks, Cache, Offline) ──
  function normalizeWorldClockEntry(c) {
    if (!c || typeof c !== 'object') return null;
    const city = String(c.city || c.name || '').trim();
    const tz = String(c.tz || c.timezone || '').trim();
    if (!city || !tz) return null;
    const id = String(c.id || tz.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    return { id, name: city, timezone: tz, city, tz };
  }

  function getSavedWorldClocks() {
    const raw = window.Settings && window.Settings.get('world_clocks');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeWorldClockEntry).filter(Boolean);
  }

  function populateWorldClockSelect() {
    if (!worldClockSelect || !window.RustyLocations) return;
    const existing = new Set(getSavedWorldClocks().map((c) => c.tz));
    worldClockSelect.innerHTML = '';
    const seenTz = new Set();
    const choices = [];
    window.RustyLocations.WORLD_CLOCK_PRESETS.forEach((p) => {
      if (!seenTz.has(p.tz)) {
        seenTz.add(p.tz);
        choices.push(p);
      }
    });
    Object.entries(window.RustyLocations.TZ_MAP).forEach(([tz, info]) => {
      if (!seenTz.has(tz)) {
        seenTz.add(tz);
        choices.push({ city: info.city, country: info.country, tz });
      }
    });
    choices.forEach((c) => {
      if (existing.has(c.tz)) return;
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ city: c.city, tz: c.tz });
      opt.textContent = `${c.city} (${c.country})`;
      worldClockSelect.appendChild(opt);
    });
  }

  function renderWorldClocks() {
    if (!worldClockList) return;
    const clocks = getSavedWorldClocks();
    worldClockList.innerHTML = '';
    if (clocks.length === 0) {
      const empty = document.createElement('span');
      empty.style.cssText = 'font-size: 11px; color: var(--text-muted);';
      empty.textContent = 'No extra cities added yet.';
      worldClockList.appendChild(empty);
      populateWorldClockSelect();
      return;
    }

    clocks.forEach((wc, idx) => {
      const pill = document.createElement('div');
      pill.className = 'world-clock-pill';

      const cityEl = document.createElement('span');
      cityEl.className = 'world-clock-city';
      cityEl.textContent = wc.city;

      const timeEl = document.createElement('span');
      timeEl.className = 'world-clock-time';
      timeEl.dataset.tz = wc.tz;
      timeEl.textContent = formatWorldClockTime(wc.tz);

      const remBtn = document.createElement('button');
      remBtn.type = 'button';
      remBtn.className = 'world-clock-remove';
      remBtn.title = `Remove ${wc.city}`;
      remBtn.textContent = '×';
      remBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = getSavedWorldClocks().filter((_, i) => i !== idx);
        if (window.Settings) window.Settings.set('world_clocks', next);
        renderWorldClocks();
      });

      pill.appendChild(cityEl);
      pill.appendChild(timeEl);
      pill.appendChild(remBtn);
      worldClockList.appendChild(pill);
    });
    populateWorldClockSelect();
  }

  renderWorldClocks();

  if (btnToggleWorldClockAdd && worldClockForm) {
    btnToggleWorldClockAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      populateWorldClockSelect();
      worldClockForm.hidden = !worldClockForm.hidden;
    });
  }

  if (worldClockForm && worldClockSelect) {
    worldClockForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!worldClockSelect.value) return;
      try {
        const picked = normalizeWorldClockEntry(JSON.parse(worldClockSelect.value));
        if (!picked) return;
        const cur = getSavedWorldClocks();
        if (!cur.some((c) => c.tz === picked.tz)) {
          const next = cur.concat([picked]);
          if (window.Settings) window.Settings.set('world_clocks', next);
        }
        worldClockForm.hidden = true;
        renderWorldClocks();
      } catch (_) {}
    });
  }

  function renderForecast(list) {
    if (!weatherForecastRow) return;
    weatherForecastRow.innerHTML = '';
    const days = Array.isArray(list) ? list.slice(0, 5) : [];
    if (days.length === 0) {
      if (twForecastSection) twForecastSection.style.display = 'none';
      return;
    }
    if (twForecastSection) twForecastSection.style.display = '';
    days.forEach((day, idx) => {
      const tile = document.createElement('div');
      tile.className = 'tw-forecast-day';

      let dayLabel = day.date || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayLabel)) {
        const [y, m, d] = dayLabel.split('-').map(Number);
        const localDate = new Date(y, m - 1, d);
        dayLabel = idx === 0
          ? 'Today'
          : localDate.toLocaleDateString(undefined, { weekday: 'short' });
      }

      const nameEl = document.createElement('span');
      nameEl.className = 'tw-forecast-name';
      nameEl.textContent = dayLabel;

      const iconEl = document.createElement('span');
      iconEl.className = 'tw-forecast-icon';
      iconEl.title = day.condition || '';
      iconEl.innerHTML = window.Icons ? window.Icons.get(day.icon || 'weather', '', 14) : '';

      const tempsEl = document.createElement('span');
      tempsEl.className = 'tw-forecast-temps';
      const hi = Math.round(Number(day.temp_max_c) || 0);
      const lo = Math.round(Number(day.temp_min_c) || 0);
      tempsEl.innerHTML = `${hi}° <span class="tw-forecast-lo">${lo}°</span>`;

      tile.appendChild(nameEl);
      tile.appendChild(iconEl);
      tile.appendChild(tempsEl);
      weatherForecastRow.appendChild(tile);
    });
  }

  function emitGlobeLocation(lat, lon, city, country, source) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    window.dispatchEvent(new CustomEvent('rusty-globe-location', {
      detail: { lat, lon, city: city || '', country: country || '', source: source || 'weather' }
    }));
  }

  function renderWeatherData(data) {
    if (!data || typeof data.temperature_c !== 'number') return;
    lastWeatherData = data;
    if (weatherTemp) weatherTemp.textContent = `${Math.round(data.temperature_c)}°C`;
    if (weatherCondition) weatherCondition.textContent = data.condition || '';
    if (weatherLocation) weatherLocation.textContent = data.location || 'Local Area';
    if (weatherMeta) {
      const hum = typeof data.humidity === 'number' ? `${data.humidity}%` : '';
      const wind = typeof data.wind_kmh === 'number' ? `${Math.round(data.wind_kmh)} km/h` : '';
      weatherMeta.textContent = [hum, wind].filter(Boolean).join(' • ');
    }
    if (weatherIcon && window.Icons) {
      weatherIcon.innerHTML = window.Icons.get(data.icon || 'weather', '', 18);
    }
    if (twOfflineBadge) {
      const isOff = Boolean(data.offline) || (typeof navigator !== 'undefined' && navigator.onLine === false);
      twOfflineBadge.hidden = !isOff;
    }
    if (typeof data.query === 'string') {
      savedWeatherQuery = data.query;
    }
    renderForecast(data.forecast);
    if (typeof data.latitude === 'number' && typeof data.longitude === 'number' && (data.latitude !== 0 || data.longitude !== 0)) {
      emitGlobeLocation(data.latitude, data.longitude, data.location, data.country, data.query ? 'city' : 'centroid');
    }
  }

  function getActiveWeatherTarget() {
    const city = String(savedWeatherQuery || '').trim();
    if (city) {
      return {
        key: `city:${city.toLowerCase()}`,
        payload: { location: city }
      };
    }
    if (manualGeoCoords) {
      return {
        key: `geo:${manualGeoCoords.lat.toFixed(2)},${manualGeoCoords.lon.toFixed(2)}`,
        payload: {
          location: '',
          lat: manualGeoCoords.lat,
          lon: manualGeoCoords.lon,
          label: 'My Location',
          country: ''
        }
      };
    }
    const c = (window.RustyLocations && typeof window.RustyLocations.resolveLocalCentroid === 'function')
      ? window.RustyLocations.resolveLocalCentroid()
      : { lat: 51.51, lon: -0.13, city: 'London', country: 'United Kingdom' };
    return {
      key: `tz:${c.city.toLowerCase()}`,
      payload: {
        location: '',
        lat: c.lat,
        lon: c.lon,
        label: c.city,
        country: c.country
      }
    };
  }

  function requestWeatherFetch(force = false) {
    if (!window.bridge) return;
    const target = getActiveWeatherTarget();
    window.bridge.send('fetch_weather', { ...target.payload, force });
  }

  function emitPriority1OfflineFallback(query) {
    const q = String(query || '').trim();
    if (!q || !window.RustyLocations) return false;
    const byCountry = typeof window.RustyLocations.findCountryCentroid === 'function'
      ? window.RustyLocations.findCountryCentroid(q)
      : null;
    if (byCountry && Number.isFinite(byCountry.lat) && Number.isFinite(byCountry.lon)) {
      emitGlobeLocation(byCountry.lat, byCountry.lon, q, byCountry.name, 'city');
      return true;
    }
    const byTz = typeof window.RustyLocations.findTimezoneForCity === 'function'
      ? window.RustyLocations.findTimezoneForCity(q)
      : null;
    const tzInfo = byTz && window.RustyLocations.TZ_MAP ? window.RustyLocations.TZ_MAP[byTz.tz] : null;
    if (tzInfo && Number.isFinite(tzInfo.lat) && Number.isFinite(tzInfo.lon)) {
      emitGlobeLocation(tzInfo.lat, tzInfo.lon, tzInfo.city || q, tzInfo.country || '', 'city');
      return true;
    }
    return false;
  }

  // Hydrate 30-min weather cache immediately, then fetch if missing or expired
  (function initWeatherCacheAndFetch() {
    const target = getActiveWeatherTarget();
    let hasFreshCache = false;
    try {
      const cachedRaw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && cached.data && typeof cached.data.temperature_c === 'number') {
          renderWeatherData(cached.data);
          const age = Date.now() - Number(cached.cachedAtMs || 0);
          if (!cached.data.offline && cached.queryKey === target.key && age >= 0 && age < WEATHER_CACHE_TTL_MS) {
            hasFreshCache = true;
          }
        }
      }
    } catch (_) {}

    if (!hasFreshCache) {
      if (savedWeatherQuery) {
        emitPriority1OfflineFallback(savedWeatherQuery);
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (twOfflineBadge) twOfflineBadge.hidden = false;
        if (!lastWeatherData && weatherCondition) weatherCondition.textContent = 'Offline';
      } else {
        requestWeatherFetch(false);
      }
    }
  })();

  function setTimeWeatherExpanded(expanded) {
    if (!twCard || !twExpanded) return;
    twExpanded.hidden = !expanded;
    twCard.classList.toggle('expanded', expanded);
    if (expanded) {
      if (weatherCityInput && document.activeElement !== weatherCityInput) {
        weatherCityInput.value = savedWeatherQuery || '';
      }
      renderWorldClocks();
      updateWorldClockTimesOnly();
    }
  }

  if (twCard) {
    twCard.addEventListener('click', (e) => {
      if (globeSlot && globeSlot.contains(e.target)) return;
      const interactive = e.target.closest('button, input, select, label, form, a');
      if (interactive && interactive !== twExpandBtn) return;
      if (twExpanded) setTimeWeatherExpanded(twExpanded.hidden);
    });
  }

  if (btnWeatherRefresh) {
    btnWeatherRefresh.addEventListener('click', (e) => {
      e.stopPropagation();
      if (twOfflineBadge) twOfflineBadge.hidden = true;
      if (weatherCondition) weatherCondition.textContent = 'Refreshing...';
      requestWeatherFetch(true);
    });
  }

  if (weatherCityForm) {
    weatherCityForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rawCity = weatherCityInput ? weatherCityInput.value.trim() : '';
      const query = rawCity.toLowerCase() === 'auto' ? '' : rawCity;
      manualGeoCoords = null;
      savedWeatherQuery = query;
      if (weatherCondition) weatherCondition.textContent = 'Updating...';
      if (weatherLocation) weatherLocation.textContent = query ? `Searching ${query}...` : 'Using timezone city...';
      if (window.Settings) {
        window.Settings.set('weather_location', query);
      }
      if (query) {
        emitPriority1OfflineFallback(query);
      } else if (window.RustyLocations && typeof window.RustyLocations.resolveLocalCentroid === 'function') {
        const c = window.RustyLocations.resolveLocalCentroid();
        emitGlobeLocation(c.lat, c.lon, c.city, c.country, 'centroid');
      }
      requestWeatherFetch(true);
    });
  }

  if (btnUseMyLocation) {
    btnUseMyLocation.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!navigator.geolocation) {
        if (weatherMeta) weatherMeta.textContent = 'Geolocation not supported';
        return;
      }
      btnUseMyLocation.disabled = true;
      btnUseMyLocation.textContent = 'Locating...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btnUseMyLocation.disabled = false;
          btnUseMyLocation.textContent = 'Use my location';
          manualGeoCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          savedWeatherQuery = '';
          if (window.Settings) window.Settings.set('weather_location', '');
          if (weatherCityInput) weatherCityInput.value = '';
          emitGlobeLocation(pos.coords.latitude, pos.coords.longitude, 'My Location', '', 'geolocation');
          requestWeatherFetch(true);
        },
        () => {
          btnUseMyLocation.disabled = false;
          btnUseMyLocation.textContent = 'Use my location';
          if (weatherMeta) weatherMeta.textContent = 'Location permission denied';
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
      );
    });
  }

  if (toggleGlobeClouds) {
    toggleGlobeClouds.checked = Boolean(window.Settings && window.Settings.get('ntp_globe_clouds'));
    toggleGlobeClouds.addEventListener('change', () => {
      if (window.Settings) window.Settings.set('ntp_globe_clouds', toggleGlobeClouds.checked);
    });
  }

  if (weatherCityInput) {
    weatherCityInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        weatherCityInput.blur();
      }
    });
  }

  // ── 8. System Monitor (100% Real Windows OS Telemetry) ───────────────────
  const MAX_SPARK_POINTS = 24;
  const cpuHistory = [];
  const gpuHistory = [];
  let lastBrowserMb = null;
  let lastSysRamText = '';

  function buildSparkPath(values) {
    if (!values || values.length === 0) return 'M0,18 L100,18';
    if (values.length === 1) {
      const y = (18 - (Math.max(0, Math.min(100, values[0])) / 100) * 16).toFixed(1);
      return `M0,${y} L100,${y}`;
    }
    const stepX = 100 / (values.length - 1);
    return values
      .map((val, idx) => {
        const x = (idx * stepX).toFixed(1);
        const clamped = Math.max(0, Math.min(100, val));
        const y = (18 - (clamped / 100) * 16).toFixed(1);
        return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  }

  function formatNetRate(kbps) {
    if (typeof kbps !== 'number' || !Number.isFinite(kbps) || kbps < 0) return 'Net --';
    if (kbps >= 1024) return `Net ${(kbps / 1024).toFixed(1)} MB/s`;
    return `Net ${Math.round(kbps)} KB/s`;
  }

  function updateAppMemLine() {
    if (!monitorAppMem) return;
    const appPart = typeof lastBrowserMb === 'number' ? `App ${Math.round(lastBrowserMb)} MB` : 'App -- MB';
    monitorAppMem.textContent = lastSysRamText ? `${appPart} • ${lastSysRamText}` : appPart;
  }

  function handleTelemetryStats(snap) {
    if (!snap || typeof snap !== 'object') return;

    if (typeof snap.sys_cpu_percent === 'number') {
      const cpuPct = Math.round(snap.sys_cpu_percent);
      if (cpuVal) cpuVal.textContent = `${cpuPct}%`;
      cpuHistory.push(snap.sys_cpu_percent);
      if (cpuHistory.length > MAX_SPARK_POINTS) cpuHistory.shift();
      if (cpuSparkPath) cpuSparkPath.setAttribute('d', buildSparkPath(cpuHistory));
    }

    if (typeof snap.sys_ram_percent === 'number') {
      const ramPct = Math.max(0, Math.min(100, Math.round(snap.sys_ram_percent)));
      if (ramVal) ramVal.textContent = `${ramPct}%`;
      if (ramFill) ramFill.style.width = `${ramPct}%`;
    }

    if (typeof snap.sys_gpu_percent === 'number') {
      const gpuPct = Math.round(snap.sys_gpu_percent);
      if (gpuVal) gpuVal.textContent = `${gpuPct}%`;
      gpuHistory.push(snap.sys_gpu_percent);
      if (gpuHistory.length > MAX_SPARK_POINTS) gpuHistory.shift();
      if (gpuSparkPath) gpuSparkPath.setAttribute('d', buildSparkPath(gpuHistory));
    } else if (snap.sys_gpu_percent === null) {
      if (gpuVal) gpuVal.textContent = 'N/A';
      if (gpuSparkPath) gpuSparkPath.setAttribute('d', 'M0,18 L100,18');
    }

    if (typeof snap.browser_mb === 'number' && snap.browser_mb > 0) {
      lastBrowserMb = snap.browser_mb;
    }
    if (typeof snap.sys_ram_used_gb === 'number' && typeof snap.sys_ram_total_gb === 'number' && snap.sys_ram_total_gb > 0) {
      lastSysRamText = `${snap.sys_ram_used_gb.toFixed(1)}/${snap.sys_ram_total_gb.toFixed(0)} GB`;
    }
    updateAppMemLine();

    if (monitorNetSpeed) {
      monitorNetSpeed.textContent = formatNetRate(snap.net_kbps);
    }
  }

  function handleMemoryStats(mem) {
    if (!mem || typeof mem.total_mb !== 'number') return;
    lastBrowserMb = mem.total_mb;
    updateAppMemLine();
  }

  // ── 9. Host IPC Listeners (Settings sync, Weather, Telemetry) ────────────
  function applyNtpSettings(s) {
    if (!s || typeof s !== 'object') return;
    if (window.Settings && typeof window.Settings.syncFromHost === 'function') {
      window.Settings.syncFromHost(s);
    }
    if (s.theme) {
      document.documentElement.setAttribute('data-theme', s.theme);
    }
    if (window.__applyAccentCss) {
      window.__applyAccentCss(s.use_custom_accent && s.custom_accent ? s.custom_accent : null);
    }
    if (s.default_search) {
      activeEngine = s.default_search;
    }
    renderEngineChips();

    if (typeof s.weather_location === 'string' && s.weather_location !== savedWeatherQuery) {
      savedWeatherQuery = s.weather_location;
      manualGeoCoords = null;
      if (weatherCityInput && document.activeElement !== weatherCityInput) {
        weatherCityInput.value = savedWeatherQuery;
      }
      if (savedWeatherQuery) {
        emitPriority1OfflineFallback(savedWeatherQuery);
      } else if (window.RustyLocations && typeof window.RustyLocations.resolveLocalCentroid === 'function') {
        const c = window.RustyLocations.resolveLocalCentroid();
        emitGlobeLocation(c.lat, c.lon, c.city, c.country, 'centroid');
      }
      requestWeatherFetch(false);
    }
    if (twClockBlock && s.ntp_show_clock !== undefined) {
      twClockBlock.style.display = s.ntp_show_clock ? '' : 'none';
    }
    if (twWeatherBlock && s.ntp_show_weather !== undefined) {
      twWeatherBlock.style.display = s.ntp_show_weather ? '' : 'none';
    }
    if (twCard) {
      const showClock = s.ntp_show_clock !== undefined ? Boolean(s.ntp_show_clock) : true;
      const showWeather = s.ntp_show_weather !== undefined ? Boolean(s.ntp_show_weather) : true;
      twCard.style.display = (!showClock && !showWeather) ? 'none' : '';
    }
    if (elBrandHero && s.ntp_show_greeting !== undefined) {
      elBrandHero.style.display = s.ntp_show_greeting ? '' : 'none';
    }
    if (elSpeedDialSec && s.ntp_show_speed_dial !== undefined) {
      elSpeedDialSec.style.display = s.ntp_show_speed_dial ? '' : 'none';
    }
    if (elWidgetNotes && s.ntp_show_notes !== undefined) {
      elWidgetNotes.style.display = s.ntp_show_notes ? '' : 'none';
    }
    if (toggleGlobeClouds && s.ntp_globe_clouds !== undefined) {
      toggleGlobeClouds.checked = Boolean(s.ntp_globe_clouds);
    }
    if (s.world_clocks !== undefined) {
      renderWorldClocks();
    }
  }

  if (window.Settings && window.Settings.data) {
    applyNtpSettings(window.Settings.data);
  }

  window.addEventListener('settings-changed', () => {
    renderEngineChips();
    renderWorldClocks();
  });

  if (window.bridge) {
    window.bridge.on('telemetry_stats', handleTelemetryStats);
    window.bridge.on('memory_stats', handleMemoryStats);
    window.bridge.on('ui_settings_sync', (data) => {
      if (data && data.settings) {
        applyNtpSettings(data.settings);
      }
    });
    window.bridge.on('weather_update', (data) => {
      const target = getActiveWeatherTarget();
      try {
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
          queryKey: target.key,
          cachedAtMs: Date.now(),
          data
        }));
      } catch (_) {}
      renderWeatherData(data);
    });
    window.bridge.on('weather_error', (err) => {
      const msg = (err && err.message) ? err.message : 'Unavailable offline';
      if (twOfflineBadge) twOfflineBadge.hidden = false;
      if (!lastWeatherData) {
        if (weatherCondition) weatherCondition.textContent = 'Offline';
        if (weatherMeta) weatherMeta.textContent = msg;
      }
    });
  }

  // ── 10. Workspaces selector in Left Rail ──────────────────────────────────
  document.querySelectorAll('.workspace-chip').forEach((chip) => {
    const wsName = chip.textContent ? chip.textContent.trim() : (chip.dataset.ws || 'Workspace');
    chip.title = `${wsName} workspace (Middle-click: open in new tab)`;
    chip.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        openNtpItemInNewTab('about:blank', `Workspace: ${wsName}`, e);
        return;
      }
      document.querySelectorAll('.workspace-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
    chip.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      openNtpItemInNewTab('about:blank', `Workspace: ${wsName}`, e);
    });
  });
})();
