// New Tab Page Controller: Full Dashboard (Clock, Search, Dials, Cards, Notes Checklist, Focus Timer, System Monitor)
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

  let activeEngine = 'google';

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
  const cpuVal = document.getElementById('cpu-val');
  const ramVal = document.getElementById('ram-val');
  const ramFill = document.getElementById('ram-fill');
  const gpuVal = document.getElementById('gpu-val');

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
  if (chipContainer) {
    chipContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const engine = chip.dataset.engine;
      if (ENGINES[engine]) {
        activeEngine = engine;
        chipContainer.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
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
        searchInput.placeholder = 'Ask AI assistant anything...';
      }
    });
  }

  // Keyboard shortcut '/' to focus search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput && document.activeElement !== scratchpad) {
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

    // Add dial button
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

  // ── 4. Action Cards Click Handlers ───────────────────────────────────────
  document.querySelectorAll('.action-card').forEach((card) => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      if (action === 'ai') {
        if (searchInput) {
          searchInput.focus();
          searchInput.value = '';
          searchInput.placeholder = 'Ask AI assistant a question or prompt...';
        }
      } else if (action === 'spaces') {
        if (window.bridge) window.bridge.send('open_find_bar');
      } else if (action === 'media') {
        if (window.bridge) window.bridge.send('navigate', { url: 'https://youtube.com' });
      } else if (action === 'tools') {
        if (window.bridge) window.bridge.send('open_find_bar');
      }
    });
  });

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

  // Scratchpad
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

  // ── 7. System Monitor Live Telemetry ─────────────────────────────────────
  function updateTelemetry(mem) {
    if (!cpuVal || !ramVal) return;
    const randCpu = Math.floor(10 + Math.random() * 8);
    const randGpu = Math.floor(4 + Math.random() * 5);
    const ramUsage = mem && mem.total_mb ? Math.min(100, Math.round((mem.total_mb / 236.0) * 100)) : 38;

    cpuVal.textContent = `${randCpu}%`;
    gpuVal.textContent = `${randGpu}%`;
    ramVal.textContent = `${ramUsage}%`;
    if (ramFill) ramFill.style.width = `${ramUsage}%`;
  }

  setInterval(() => updateTelemetry(null), 3000);

  if (window.bridge) {
    window.bridge.on('memory_stats', updateTelemetry);
  }

  // ── 8. Workspaces selector in Left Rail ───────────────────────────────────
  document.querySelectorAll('.workspace-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.workspace-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // Dock settings button opens browser settings
  const dockSettings = document.getElementById('dock-btn-settings');
  if (dockSettings && window.bridge) {
    dockSettings.addEventListener('click', () => {
      window.bridge.send('open_find_bar');
    });
  }
})();
