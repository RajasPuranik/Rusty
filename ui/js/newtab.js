// New Tab Page Controller: Clock, Search, Dials, Cards, Live Weather, Quick Notes, Focus Timer, Real System Monitor
(function () {
  'use strict';

  const ENGINES = {
    google: 'https://www.google.com/search?q=%s',
    duckduckgo: 'https://duckduckgo.com/?q=%s',
    bing: 'https://www.bing.com/search?q=%s',
    brave: 'https://search.brave.com/search?q=%s',
    youtube: 'https://www.youtube.com/results?search_query=%s',
    github: 'https://github.com/search?q=%s'
  };

  let activeEngine = (window.Settings && window.Settings.get('default_search')) || 'google';
  let savedWeatherQuery = (window.Settings && window.Settings.get('weather_location')) || '';

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
  const searchInput = document.getElementById('search-input');
  const chipContainer = document.getElementById('engine-chips');
  const speedDialGrid = document.getElementById('speed-dial-grid');
  const notesChecklist = document.getElementById('notes-checklist');
  const scratchpad = document.getElementById('scratchpad');
  const btnAddNote = document.getElementById('btn-add-note');
  const btnSearchAi = document.getElementById('btn-search-ai');
  const focusTimeDisplay = document.getElementById('focus-time-display');
  const btnFocusPlay = document.getElementById('btn-focus-play');
  const btnFocusReset = document.getElementById('btn-focus-settings');

  // Weather Elements
  const weatherCard = document.getElementById('widget-weather');
  const weatherIcon = document.getElementById('weather-icon');
  const weatherTemp = document.getElementById('weather-temp');
  const weatherCondition = document.getElementById('weather-condition');
  const weatherLocation = document.getElementById('weather-location');
  const weatherMeta = document.getElementById('weather-meta');
  const btnWeatherRefresh = document.getElementById('btn-weather-refresh');
  const weatherCityForm = document.getElementById('weather-city-form');
  const weatherCityInput = document.getElementById('weather-city-input');

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
  const elWidgetClock = document.getElementById('widget-clock');
  const elWidgetNotes = document.getElementById('widget-notes');

  // ── 1. Digital Clock & Date ──────────────────────────────────────────────
  function updateClock() {
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
  }

  setInterval(updateClock, 1000);
  updateClock();

  // ── 2. Search Engine Chips & Navigation ───────────────────────────────────
  function syncActiveEngineChip() {
    if (!chipContainer) return;
    chipContainer.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.engine === activeEngine);
    });
  }
  syncActiveEngineChip();

  if (chipContainer) {
    chipContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const engine = chip.dataset.engine;
      if (ENGINES[engine]) {
        activeEngine = engine;
        syncActiveEngineChip();
        searchInput && searchInput.focus();
      }
    });
  }

  function handleSearch(query) {
    if (!query) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    let targetUrl;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed)) {
      targetUrl = trimmed;
    } else if (/^[^\s]+\.[^\s]+$/i.test(trimmed) && !trimmed.includes(' ')) {
      targetUrl = `https://${trimmed}`;
    } else {
      const template = ENGINES[activeEngine] || ENGINES.google;
      targetUrl = template.replace('%s', encodeURIComponent(trimmed));
    }

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
    const isTyping = active === searchInput || active === scratchpad || active === weatherCityInput;
    if (e.key === '/' && !isTyping) {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

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
      a.title = d.title;
      a.style.backgroundColor = d.color || '#1e293b';
      a.textContent = d.avatar || d.title.slice(0, 2).toUpperCase();

      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.bridge && typeof window.bridge.send === 'function') {
          window.bridge.send('navigate', { url: d.url });
        } else {
          window.location.href = d.url;
        }
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
    card.addEventListener('click', () => {
      const action = card.dataset.action;
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
  });

  const dockHome = document.getElementById('dock-btn-home');
  const dockApps = document.getElementById('dock-btn-apps');
  const dockSpaces = document.getElementById('dock-btn-spaces');
  const dockAi = document.getElementById('dock-btn-ai');
  const dockBookmarks = document.getElementById('dock-btn-bookmarks');
  const dockHistory = document.getElementById('dock-btn-history');
  const dockDownloads = document.getElementById('dock-btn-downloads');
  const dockSettings = document.getElementById('dock-btn-settings');

  if (dockHome && searchInput) dockHome.addEventListener('click', () => searchInput.focus());
  if (dockAi && searchInput) dockAi.addEventListener('click', () => searchInput.focus());
  if (dockApps) dockApps.addEventListener('click', () => window.bridge && window.bridge.send('open_command_palette'));
  if (dockSpaces) {
    dockSpaces.addEventListener('click', () => {
      const current = (window.Settings && window.Settings.get('tabs_layout')) || 'horizontal';
      const next = current === 'vertical' ? 'horizontal' : 'vertical';
      if (window.Settings) window.Settings.data.tabs_layout = next;
      window.bridge && window.bridge.send('set_setting', { key: 'tabs_layout', value: next });
    });
  }
  if (dockBookmarks) dockBookmarks.addEventListener('click', () => window.bridge && window.bridge.send('open_side_panel', { panel: 'bookmarks' }));
  if (dockHistory) dockHistory.addEventListener('click', () => window.bridge && window.bridge.send('open_side_panel', { panel: 'history' }));
  if (dockDownloads) dockDownloads.addEventListener('click', () => window.bridge && window.bridge.send('open_side_panel', { panel: 'downloads' }));
  if (dockSettings) dockSettings.addEventListener('click', () => window.bridge && window.bridge.send('open_settings'));

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

  // ── 7. Live Weather Widget (Real data pushed from Rust) ──────────────────
  const WEATHER_CACHE_KEY = 'rusty_weather_cache_v1';

  function renderWeatherData(data) {
    if (!data || typeof data.temperature_c !== 'number') return;
    if (weatherTemp) weatherTemp.textContent = `${Math.round(data.temperature_c)}°C`;
    if (weatherCondition) weatherCondition.textContent = data.condition || '';
    if (weatherLocation) weatherLocation.textContent = data.location || 'Local Area';
    if (weatherMeta) {
      const hum = typeof data.humidity === 'number' ? `${data.humidity}% humidity` : '';
      const wind = typeof data.wind_kmh === 'number' ? `${Math.round(data.wind_kmh)} km/h wind` : '';
      weatherMeta.textContent = [hum, wind].filter(Boolean).join(' • ');
    }
    if (weatherIcon && window.Icons) {
      const iconKey = data.icon || 'weather';
      weatherIcon.innerHTML = window.Icons.get(iconKey, '', 22);
    }
    if (typeof data.query === 'string') {
      savedWeatherQuery = data.query;
    }
  }

  try {
    const cachedRaw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      renderWeatherData(cached);
    }
  } catch (_) {}

  if (weatherCard) {
    weatherCard.addEventListener('click', (e) => {
      if (
        (weatherCityForm && weatherCityForm.contains(e.target)) ||
        (btnWeatherRefresh && btnWeatherRefresh.contains(e.target))
      ) {
        return;
      }
      if (weatherCityForm) {
        const isOpen = weatherCityForm.classList.toggle('open');
        if (isOpen && weatherCityInput) {
          weatherCityInput.value = savedWeatherQuery || '';
          weatherCityInput.focus();
          weatherCityInput.select();
        }
      }
    });
  }

  if (btnWeatherRefresh) {
    btnWeatherRefresh.addEventListener('click', (e) => {
      e.stopPropagation();
      if (weatherCondition) weatherCondition.textContent = 'Refreshing...';
      if (window.bridge) {
        window.bridge.send('fetch_weather', { location: savedWeatherQuery || '', force: true });
      }
    });
  }

  if (weatherCityForm) {
    weatherCityForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rawCity = weatherCityInput ? weatherCityInput.value.trim() : '';
      const query = rawCity.toLowerCase() === 'auto' ? '' : rawCity;
      savedWeatherQuery = query;
      if (weatherCondition) weatherCondition.textContent = 'Updating...';
      if (weatherLocation) weatherLocation.textContent = query ? `Searching ${query}...` : 'Detecting location...';
      weatherCityForm.classList.remove('open');
      if (window.bridge) {
        window.bridge.send('set_setting', { key: 'weather_location', value: query });
        window.bridge.send('fetch_weather', { location: query, force: true });
      }
    });
  }

  if (weatherCityInput) {
    weatherCityInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && weatherCityForm) {
        weatherCityForm.classList.remove('open');
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
    if (s.default_search && ENGINES[s.default_search]) {
      activeEngine = s.default_search;
      syncActiveEngineChip();
    }
    if (typeof s.weather_location === 'string') {
      savedWeatherQuery = s.weather_location;
    }
    if (elWidgetClock && s.ntp_show_clock !== undefined) {
      elWidgetClock.style.display = s.ntp_show_clock ? '' : 'none';
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
    if (weatherCard && s.ntp_show_weather !== undefined) {
      weatherCard.style.display = s.ntp_show_weather ? '' : 'none';
    }
  }

  if (window.Settings && window.Settings.data) {
    applyNtpSettings(window.Settings.data);
  }

  if (window.bridge) {
    window.bridge.on('telemetry_stats', handleTelemetryStats);
    window.bridge.on('memory_stats', handleMemoryStats);
    window.bridge.on('ui_settings_sync', (data) => {
      if (data && data.settings) {
        applyNtpSettings(data.settings);
      }
    });
    window.bridge.on('weather_update', (data) => {
      try {
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
      } catch (_) {}
      renderWeatherData(data);
    });
    window.bridge.on('weather_error', (err) => {
      const msg = (err && err.message) ? err.message : 'Weather unavailable';
      if (weatherCondition) weatherCondition.textContent = 'Offline';
      if (weatherMeta) weatherMeta.textContent = msg;
    });
  }

  // ── 10. Workspaces selector in Left Rail ──────────────────────────────────
  document.querySelectorAll('.workspace-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.workspace-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
})();
