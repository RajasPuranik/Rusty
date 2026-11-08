// New Tab Page Controller: Clock, search routing, speed-dial, scratchpad, recently closed tabs
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

  const DEFAULT_SPEED_DIAL = [
    { title: 'GitHub', url: 'https://github.com', avatar: 'GH' },
    { title: 'YouTube', url: 'https://youtube.com', avatar: 'YT' },
    { title: 'Rust Lang', url: 'https://rust-lang.org', avatar: 'RS' },
    { title: 'Wikipedia', url: 'https://wikipedia.org', avatar: 'WK' },
    { title: 'Reddit', url: 'https://reddit.com', avatar: 'RD' },
    { title: 'Crates.io', url: 'https://crates.io', avatar: 'CR' }
  ];

  // DOM Elements
  const clockTime = document.getElementById('clock-time');
  const clockGreeting = document.getElementById('clock-greeting');
  const searchInput = document.getElementById('search-input');
  const chipContainer = document.getElementById('engine-chips');
  const speedDialGrid = document.getElementById('speed-dial-grid');
  const scratchpad = document.getElementById('scratchpad');
  const recentTabsList = document.getElementById('recent-tabs-list');

  // Apply widget visibility from settings
  try {
    const rawSettings = localStorage.getItem('rusty_browser_settings');
    if (rawSettings) {
      const s = JSON.parse(rawSettings);
      if (s.ntp_show_clock === false && clockTime) {
        const cs = clockTime.closest('.clock-section');
        if (cs) cs.style.display = 'none';
      }
      if (s.ntp_show_greeting === false && clockGreeting) {
        clockGreeting.style.display = 'none';
      }
      if (s.ntp_show_speed_dial === false && speedDialGrid) {
        const wg = speedDialGrid.closest('.widgets-grid');
        if (wg) wg.style.display = 'none';
      }
      if (s.ntp_show_notes === false && scratchpad) {
        const wc = scratchpad.closest('.widget-card');
        if (wc) wc.style.display = 'none';
      }
      const weatherEl = document.querySelector('.weather-widget');
      if (s.ntp_show_weather === false && weatherEl) {
        weatherEl.style.display = 'none';
      }
    }
  } catch (_) {}

  // ── 1. Digital Clock & Greeting ──────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');

    if (clockTime) {
      clockTime.textContent = `${hours}:${minutes}`;
    }

    if (clockGreeting) {
      let greeting = 'Welcome back';
      if (hours >= 5 && hours < 12) greeting = 'Good morning';
      else if (hours >= 12 && hours < 18) greeting = 'Good afternoon';
      else greeting = 'Good evening';
      clockGreeting.textContent = greeting;
    }
  }

  setInterval(updateClock, 1000);
  updateClock();

  // ── 2. Search Engine Chips ───────────────────────────────────────────────
  if (chipContainer) {
    chipContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const engine = chip.dataset.engine;
      if (ENGINES[engine]) {
        activeEngine = engine;
        chipContainer.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        searchInput.focus();
      }
    });
  }

  // ── 3. Search Bar Routing ────────────────────────────────────────────────
  function handleSearch(query) {
    const q = query.trim();
    if (!q) return;

    let targetUrl;
    // URL or domain?
    if (q.startsWith('http://') || q.startsWith('https://') || q.startsWith('about:')) {
      targetUrl = q;
    } else if (!q.includes(' ') && q.includes('.')) {
      targetUrl = `https://${q}`;
    } else {
      const template = ENGINES[activeEngine] || ENGINES.google;
      targetUrl = template.replace('%s', encodeURIComponent(q));
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
        handleSearch(searchInput.value);
      }
    });
  }

  // Press "/" anywhere to focus search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput && document.activeElement !== scratchpad) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // ── 4. Speed Dial Grid ───────────────────────────────────────────────────
  function loadSpeedDial() {
    try {
      const saved = localStorage.getItem('rusty_speed_dial');
      return saved ? JSON.parse(saved) : DEFAULT_SPEED_DIAL;
    } catch (_) {
      return DEFAULT_SPEED_DIAL;
    }
  }

  function saveSpeedDial(items) {
    try {
      localStorage.setItem('rusty_speed_dial', JSON.stringify(items));
    } catch (_) {}
  }

  function renderSpeedDial() {
    if (!speedDialGrid) return;
    speedDialGrid.innerHTML = '';
    const items = loadSpeedDial();

    items.forEach((item, index) => {
      const card = document.createElement('a');
      card.className = 'dial-card';
      card.href = item.url;
      card.innerHTML = `
        <div class="dial-avatar">${item.avatar || item.title.slice(0, 2).toUpperCase()}</div>
        <span class="dial-title">${item.title}</span>
      `;
      card.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.bridge && typeof window.bridge.send === 'function') {
          window.bridge.send('navigate', { url: item.url });
        } else {
          window.location.href = item.url;
        }
      });
      speedDialGrid.appendChild(card);
    });

    // Add button
    const addBtn = document.createElement('div');
    addBtn.className = 'dial-add-btn';
    addBtn.innerHTML = `
      <div style="font-size: 20px;">+</div>
      <span class="dial-title">Add Site</span>
    `;
    addBtn.addEventListener('click', () => {
      const title = prompt('Enter site name:');
      if (!title) return;
      let url = prompt('Enter site URL (e.g. reddit.com):');
      if (!url) return;
      if (!url.startsWith('http')) url = `https://${url}`;
      items.push({ title, url, avatar: title.slice(0, 2).toUpperCase() });
      saveSpeedDial(items);
      renderSpeedDial();
    });
    speedDialGrid.appendChild(addBtn);
  }

  renderSpeedDial();

  // ── 5. Scratchpad ────────────────────────────────────────────────────────
  if (scratchpad) {
    try {
      scratchpad.value = localStorage.getItem('rusty_scratchpad') || '';
    } catch (_) {}

    scratchpad.addEventListener('input', () => {
      try {
        localStorage.setItem('rusty_scratchpad', scratchpad.value);
      } catch (_) {}
    });
  }

  // ── 6. Recently Closed Tabs ──────────────────────────────────────────────
  const MOCK_RECENT_TABS = [
    { title: 'Rust Reference Manual', url: 'https://doc.rust-lang.org/reference/' },
    { title: 'WebView2 Win32 API Documentation', url: 'https://learn.microsoft.com/en-us/microsoft-edge/webview2/' },
    { title: 'crates.io: Rust Package Registry', url: 'https://crates.io' }
  ];

  function renderRecentTabs() {
    if (!recentTabsList) return;
    recentTabsList.innerHTML = '';
    MOCK_RECENT_TABS.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'recent-tab-item';
      row.innerHTML = `
        <span class="recent-tab-title">${t.title}</span>
        <span style="opacity: 0.5;">Restore ↗</span>
      `;
      row.addEventListener('click', () => {
        if (window.bridge && typeof window.bridge.send === 'function') {
          window.bridge.send('new_tab', { url: t.url });
        } else {
          window.location.href = t.url;
        }
      });
      recentTabsList.appendChild(row);
    });
  }

  renderRecentTabs();
})();
