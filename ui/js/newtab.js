// New Tab Page Controller: Merged Time & Weather, Engine-Colored Search, Dials, Cards, Notes, Focus Timer, System Monitor
(function () {
  'use strict';

  const escapeHtml = (typeof window !== 'undefined' && typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : function (str) {
        if (str === null || str === undefined) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };

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

  // ── 4. Customizable Launch Cards (Milestone R7) ──────────────────────────
  const DEFAULT_LAUNCH_CARDS = [
    {
      id: 'card_search',
      card_type: 'action',
      title: 'Quick Search',
      subtitle: 'Jump to search or @shortcuts',
      icon: 'search',
      target: 'focus_search',
      accent_color: '#f97316'
    },
    {
      id: 'card_terminal',
      card_type: 'app',
      title: 'Terminal',
      subtitle: 'Open system terminal',
      icon: 'command',
      target: 'terminal',
      accent_color: '#38bdf8'
    },
    {
      id: 'card_focus',
      card_type: 'action',
      title: 'Focus Mode',
      subtitle: 'Study & Deep Work timers',
      icon: 'target',
      target: 'focus_mode',
      accent_color: '#4ade80'
    },
    {
      id: 'card_tabs',
      card_type: 'widget',
      title: 'Active Tabs',
      subtitle: 'Live tab counter',
      icon: 'layers',
      target: 'tabs_count',
      accent_color: '#a855f7'
    }
  ];

  function showToast(message, duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.25s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 260);
    }, duration);
  }

  window.showNtpToast = showToast;

  function getLaunchCards() {
    if (window.Settings) {
      const saved = window.Settings.get('launch_cards');
      if (Array.isArray(saved) && saved.length >= 3 && saved.length <= 6) {
        return saved;
      }
    }
    return DEFAULT_LAUNCH_CARDS;
  }

  function saveLaunchCards(cards) {
    if (window.Settings) {
      window.Settings.set('launch_cards', cards);
    }
    try {
    renderLaunchCards();
  } catch (err) {
    console.error('[newtab] renderLaunchCards failed:', err);
  }
  }

  function renderLaunchCards() {
    const grid = document.getElementById('launch-cards-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const cards = getLaunchCards();

    cards.forEach((card, index) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'action-card';
      cardEl.dataset.id = card.id;
      cardEl.dataset.type = card.card_type;
      cardEl.dataset.target = card.target;

      const iconBg = card.accent_color ? `${card.accent_color}25` : 'rgba(255, 255, 255, 0.1)';
      const iconFg = card.accent_color || 'var(--accent-primary)';

      cardEl.innerHTML = `
        <div class="action-card-icon" style="background: ${iconBg}; color: ${iconFg};">
          ${window.Icons ? window.Icons.get(card.icon || 'command', '', 18) : ''}
        </div>
        <div class="action-card-text">
          <div class="action-card-title">${escapeHtml(card.title)}</div>
          <div class="action-card-desc" id="card-desc-${card.id}">${escapeHtml(card.subtitle || '')}</div>
        </div>
        <div class="action-card-reorder">
          ${index > 0 ? `<button type="button" class="btn-icon-xs move-left" title="Move Left">${window.Icons ? window.Icons.get('chevron-left', '', 12) : '←'}</button>` : ''}
          ${index < cards.length - 1 ? `<button type="button" class="btn-icon-xs move-right" title="Move Right">${window.Icons ? window.Icons.get('chevron-right', '', 12) : '→'}</button>` : ''}
        </div>
        <button type="button" class="action-card-edit-btn" title="Edit Card">
          ${window.Icons ? window.Icons.get('pencil', '', 12) : '✎'}
        </button>
      `;

      // Card Execution Click
      cardEl.addEventListener('click', (e) => {
        if (e.target.closest('.action-card-edit-btn, .action-card-reorder')) return;
        executeLaunchCard(card);
      });

      // Edit Button
      const editBtn = cardEl.querySelector('.action-card-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openCardEditModal(card);
        });
      }

      // Reorder Buttons
      const leftBtn = cardEl.querySelector('.move-left');
      if (leftBtn) {
        leftBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (index > 0) {
            const nextCards = [...cards];
            const temp = nextCards[index - 1];
            nextCards[index - 1] = nextCards[index];
            nextCards[index] = temp;
            saveLaunchCards(nextCards);
          }
        });
      }

      const rightBtn = cardEl.querySelector('.move-right');
      if (rightBtn) {
        rightBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (index < cards.length - 1) {
            const nextCards = [...cards];
            const temp = nextCards[index + 1];
            nextCards[index + 1] = nextCards[index];
            nextCards[index] = temp;
            saveLaunchCards(nextCards);
          }
        });
      }

      grid.appendChild(cardEl);

      // Mini-widget auto-poll initial stat
      if (card.card_type === 'widget' && window.bridge && typeof window.bridge.send === 'function') {
        window.bridge.send('get_mini_widget_stat', { widget: card.target });
      }
    });
  }

  function executeLaunchCard(card) {
    if (!card) return;
    if (card.card_type === 'app') {
      if (window.bridge && typeof window.bridge.send === 'function') {
        window.bridge.send('launch_local_app', { app: card.target });
      } else {
        showToast('Local app launch preview: ' + card.target);
      }
    } else if (card.card_type === 'web') {
      const url = card.target.startsWith('http') ? card.target : `https://${card.target}`;
      if (window.bridge && typeof window.bridge.send === 'function') {
        window.bridge.send('navigate', { url });
      } else {
        window.location.href = url;
      }
    } else if (card.card_type === 'action') {
      if (card.target === 'focus_search') {
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      } else if (card.target === 'focus_mode') {
        const playBtn = document.getElementById('btn-focus-play');
        if (playBtn) playBtn.click();
      } else if (card.target === 'downloads') {
        window.bridge && window.bridge.send('open_downloads_panel');
      } else if (card.target === 'settings') {
        window.bridge && window.bridge.send('open_settings');
      } else if (card.target === 'command') {
        window.bridge && window.bridge.send('open_command_palette');
      }
    } else if (card.card_type === 'widget') {
      if (window.bridge && typeof window.bridge.send === 'function') {
        window.bridge.send('get_mini_widget_stat', { widget: card.target });
      }
    }
  }

  // Card Edit Modal Management
  const cardModalBackdrop = document.getElementById('card-edit-modal-backdrop');
  const cardEditForm = document.getElementById('card-edit-form');
  const btnCloseCardModal = document.getElementById('btn-close-card-modal');
  const btnCancelCard = document.getElementById('btn-cancel-card');
  const btnDeleteCard = document.getElementById('btn-delete-card');

  function openCardEditModal(card = null) {
    if (!cardModalBackdrop) return;
    cardModalBackdrop.style.display = 'flex';
    const isAdd = !card;
    const titleHeader = document.getElementById('modal-card-title-text');
    if (titleHeader) titleHeader.textContent = isAdd ? 'Add Launch Card' : 'Edit Launch Card';

    document.getElementById('edit-card-id').value = card ? card.id : `card_${Date.now()}`;
    document.getElementById('edit-card-title').value = card ? card.title : 'New Card';
    document.getElementById('edit-card-subtitle').value = card ? (card.subtitle || '') : 'Launch shortcut';
    document.getElementById('edit-card-type').value = card ? card.card_type : 'app';
    document.getElementById('edit-card-icon').value = card ? card.icon : 'command';
    document.getElementById('edit-card-target').value = card ? card.target : 'terminal';
    document.getElementById('edit-card-color').value = card ? (card.accent_color || '#38bdf8') : '#38bdf8';

    if (btnDeleteCard) {
      const cards = getLaunchCards();
      btnDeleteCard.style.display = (isAdd || cards.length <= 3) ? 'none' : 'block';
    }
  }

  function closeCardEditModal() {
    if (cardModalBackdrop) cardModalBackdrop.style.display = 'none';
  }

  if (btnCloseCardModal) btnCloseCardModal.onclick = closeCardEditModal;
  if (btnCancelCard) btnCancelCard.onclick = closeCardEditModal;

  if (cardEditForm) {
    cardEditForm.onsubmit = (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-card-id').value;
      const title = document.getElementById('edit-card-title').value.trim();
      const subtitle = document.getElementById('edit-card-subtitle').value.trim();
      const card_type = document.getElementById('edit-card-type').value;
      const icon = document.getElementById('edit-card-icon').value;
      const target = document.getElementById('edit-card-target').value.trim();
      const accent_color = document.getElementById('edit-card-color').value;

      const cards = [...getLaunchCards()];
      const existingIdx = cards.findIndex(c => c.id === id);
      const newCard = { id, title, subtitle, card_type, icon, target, accent_color };

      if (existingIdx >= 0) {
        cards[existingIdx] = newCard;
      } else {
        if (cards.length >= 6) {
          showToast('Maximum 6 launch cards reached');
          return;
        }
        cards.push(newCard);
      }

      saveLaunchCards(cards);
      closeCardEditModal();
      showToast('Card saved');
    };
  }

  if (btnDeleteCard) {
    btnDeleteCard.onclick = () => {
      const id = document.getElementById('edit-card-id').value;
      const cards = getLaunchCards().filter(c => c.id !== id);
      if (cards.length < 3) {
        showToast('Minimum 3 launch cards required');
        return;
      }
      saveLaunchCards(cards);
      closeCardEditModal();
      showToast('Card removed');
    };
  }

  // Add / Export / Import Action Handlers
  const btnAddCard = document.getElementById('btn-add-launch-card');
  if (btnAddCard) {
    btnAddCard.onclick = () => {
      const cards = getLaunchCards();
      if (cards.length >= 6) {
        showToast('Maximum 6 cards allowed');
        return;
      }
      openCardEditModal(null);
    };
  }

  const btnExportCards = document.getElementById('btn-export-launch-cards');
  if (btnExportCards) {
    btnExportCards.onclick = () => {
      const cards = getLaunchCards();
      const blob = new Blob([JSON.stringify(cards, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rusty_launch_cards.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported launch cards JSON');
    };
  }

  const btnImportCards = document.getElementById('btn-import-launch-cards');
  const importFileInput = document.getElementById('import-cards-file');
  if (btnImportCards && importFileInput) {
    btnImportCards.onclick = () => importFileInput.click();
    importFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const list = JSON.parse(evt.target.result);
          if (Array.isArray(list) && list.length >= 3 && list.length <= 6) {
            saveLaunchCards(list);
            showToast('Launch cards imported successfully');
          } else {
            showToast('Invalid cards file: must contain 3 to 6 cards');
          }
        } catch (_) {
          showToast('Failed to parse cards JSON');
        }
      };
      reader.readAsText(file);
      importFileInput.value = '';
    };
  }

  // Global IPC Listener for App Execution Result & Mini Widget Stat
  window.addEventListener('launch-app-result', (e) => {
    const detail = e.detail;
    if (!detail) return;
    if (detail.success) {
      showToast('Launched ' + detail.app + ' successfully');
    } else {
      showToast(detail.error || ('Application not found: ' + detail.app));
    }
  });

  window.addEventListener('mini-widget-stat', (e) => {
    const detail = e.detail;
    if (!detail || !detail.widget) return;
    const cards = getLaunchCards();
    cards.forEach(card => {
      if (card.card_type === 'widget' && card.target === detail.widget) {
        const descEl = document.getElementById('card-desc-' + card.id);
        if (descEl) descEl.textContent = detail.value;
      }
    });
  });

  if (window.bridge && typeof window.bridge.on === 'function') {
    window.bridge.on('launch_app_result', (detail) => {
      window.dispatchEvent(new CustomEvent('launch-app-result', { detail }));
    });
    window.bridge.on('mini_widget_stat', (detail) => {
      window.dispatchEvent(new CustomEvent('mini-widget-stat', { detail }));
    });
  }

  try {
    renderLaunchCards();
  } catch (err) {
    console.error('[newtab] renderLaunchCards failed:', err);
  }

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
      const keys = ['rusty_quick_notes', 'quick_notes', 'rusty_notes'];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map((item) => {
              if (typeof item === 'string') return { text: item, done: false };
              return { text: String(item.text || ''), done: Boolean(item.done) };
            });
          }
        }
      }
    } catch (_) {}
    return DEFAULT_NOTES.map((n) => ({ ...n }));
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
      const row = document.createElement('div');
      row.className = `note-item ${item.done ? 'completed' : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(item.done);
      cb.title = item.done ? 'Mark pending' : 'Mark completed';
      cb.onchange = () => {
        notes[index].done = cb.checked;
        saveNotes(notes);
        renderNotes();
      };

      const span = document.createElement('span');
      span.className = 'note-text';
      span.textContent = item.text;

      const actions = document.createElement('div');
      actions.className = 'note-actions';

      if (index > 0) {
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'btn-icon-xs btn-note-move';
        upBtn.title = 'Move up';
        upBtn.innerHTML = window.Icons ? window.Icons.get('chevron-up', '', 11) : '↑';
        upBtn.onclick = (e) => {
          e.stopPropagation();
          const temp = notes[index - 1];
          notes[index - 1] = notes[index];
          notes[index] = temp;
          saveNotes(notes);
          renderNotes();
        };
        actions.appendChild(upBtn);
      }

      if (index < notes.length - 1) {
        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'btn-icon-xs btn-note-move';
        downBtn.title = 'Move down';
        downBtn.innerHTML = window.Icons ? window.Icons.get('chevron-down', '', 11) : '↓';
        downBtn.onclick = (e) => {
          e.stopPropagation();
          const temp = notes[index + 1];
          notes[index + 1] = notes[index];
          notes[index] = temp;
          saveNotes(notes);
          renderNotes();
        };
        actions.appendChild(downBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon-xs btn-note-del';
      delBtn.title = 'Delete task';
      delBtn.innerHTML = window.Icons ? window.Icons.get('x', '', 11) : '×';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        notes.splice(index, 1);
        saveNotes(notes);
        renderNotes();
      };
      actions.appendChild(delBtn);

      row.appendChild(cb);
      row.appendChild(span);
      row.appendChild(actions);
      notesChecklist.appendChild(row);
    });

    // Inline add task row
    let addRow = document.getElementById('notes-inline-add-row');
    if (!addRow) {
      addRow = document.createElement('div');
      addRow.id = 'notes-inline-add-row';
      addRow.className = 'notes-inline-add-row';
      addRow.innerHTML = `
        <input type="text" id="notes-inline-input" class="notes-inline-input" placeholder="Add task & press Enter..." />
        <button type="button" id="notes-inline-btn" class="btn-icon-xs" title="Add">+</button>
      `;
      notesChecklist.parentNode.insertBefore(addRow, scratchpad);

      const inlineInput = addRow.querySelector('#notes-inline-input');
      const inlineBtn = addRow.querySelector('#notes-inline-btn');

      const submitInline = () => {
        const val = inlineInput ? inlineInput.value.trim() : '';
        if (val) {
          const curNotes = loadNotes();
          curNotes.push({ text: val, done: false });
          saveNotes(curNotes);
          if (inlineInput) inlineInput.value = '';
          renderNotes();
        }
      };

      if (inlineInput) {
        inlineInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitInline();
          }
        });
      }
      if (inlineBtn) {
        inlineBtn.addEventListener('click', submitInline);
      }
    }
  }

  if (btnAddNote) {
    btnAddNote.addEventListener('click', () => {
      const inlineInput = document.getElementById('notes-inline-input');
      if (inlineInput) {
        inlineInput.focus();
      } else {
        const text = prompt('New Note or Task:');
        if (text && text.trim()) {
          const notes = loadNotes();
          notes.push({ text: text.trim(), done: false });
          saveNotes(notes);
          renderNotes();
        }
      }
    });
  }

  try {
    renderNotes();
  } catch (err) {
    console.error('[newtab] renderNotes failed:', err);
  }

  if (scratchpad) {
    scratchpad.value = localStorage.getItem('rusty_scratchpad') || '';
    scratchpad.addEventListener('input', () => {
      localStorage.setItem('rusty_scratchpad', scratchpad.value);
    });
  }

  // ── 6. Focus / Pomodoro Timer (Study / Work / Deep + Rust Backend Sync) ────
  let activeFocusMode = 'study';
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

  function setFocusModeUi(mode) {
    activeFocusMode = mode;
    document.querySelectorAll('.focus-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (mode === 'study') pomodoroSeconds = 25 * 60;
    else if (mode === 'work') pomodoroSeconds = 50 * 60;
    else if (mode === 'deep') pomodoroSeconds = 90 * 60;
    updateTimerDisplay();
  }

  if (btnFocusPlay) {
    btnFocusPlay.addEventListener('click', () => {
      if (isTimerRunning) {
        clearInterval(timerInterval);
        isTimerRunning = false;
        btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
        if (window.bridge) {
          window.bridge.send('pause_focus');
        }
      } else {
        isTimerRunning = true;
        btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('pause', '', 14) : '⏸';
        if (window.bridge) {
          window.bridge.send('start_focus', {
            mode: activeFocusMode,
            duration_secs: pomodoroSeconds
          });
        }
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
          if (pomodoroSeconds > 0) {
            pomodoroSeconds--;
            updateTimerDisplay();
          } else {
            clearInterval(timerInterval);
            isTimerRunning = false;
            btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
            console.log('[focus] Session completed');
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
      if (window.bridge) {
        window.bridge.send('stop_focus');
      }
      setFocusModeUi(activeFocusMode);
    });
  }

  document.querySelectorAll('.focus-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setFocusModeUi(mode);
      if (isTimerRunning) {
        if (window.bridge) {
          window.bridge.send('start_focus', {
            mode: mode,
            duration_secs: pomodoroSeconds
          });
        }
      }
    });
  });

  // Listen for backend Focus events
  function handleFocusUpdate(data) {
    if (!data || typeof data !== 'object') return;
    const s = data.state || data;
    if (!s) return;
    if (typeof s.remaining_secs === 'number') {
      pomodoroSeconds = s.remaining_secs;
    }
    updateTimerDisplay();
    if (s.mode) {
      const m = (typeof s.mode === 'string' ? s.mode : s.mode.Study ? 'study' : s.mode.Work ? 'work' : 'deep').toLowerCase();
      activeFocusMode = m;
      document.querySelectorAll('.focus-mode-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === m);
      });
    }
    isTimerRunning = Boolean(s.is_active && !s.is_paused);
    if (btnFocusPlay) {
      btnFocusPlay.innerHTML = window.Icons ? window.Icons.get(isTimerRunning ? 'pause' : 'play', '', 14) : (isTimerRunning ? '⏸' : '▶');
    }
  }

  if (window.bridge && typeof window.bridge.on === 'function') {
    window.bridge.on('focus_state_changed', handleFocusUpdate);
    window.bridge.on('focus_state', handleFocusUpdate);
    window.bridge.on('focus_session_completed', () => {
      isTimerRunning = false;
      if (btnFocusPlay) btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
    });
  }

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'focus_state_changed' || data.type === 'focus_state') {
      handleFocusUpdate(data);
    } else if (data.type === 'focus_session_completed') {
      isTimerRunning = false;
      if (btnFocusPlay) {
        btnFocusPlay.innerHTML = window.Icons ? window.Icons.get('play', '', 14) : '▶';
      }
      console.log('[focus] Backend session finished');
    }
  });

  // Request initial focus state on boot
  if (window.bridge && typeof window.bridge.send === 'function') {
    window.bridge.send('get_focus_state');
  }

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
  function applyNtpSettings(s, fromHost = true) {
    if (!s || typeof s !== 'object') return;
    if (fromHost && window.Settings && typeof window.Settings.syncFromHost === 'function') {
      window.Settings.syncFromHost(s);
    }
    if (s.theme) {
      document.documentElement.setAttribute('data-theme', s.theme);
    }
    if (s.accent_palette) {
      document.documentElement.setAttribute('data-palette', s.accent_palette);
    } else {
      document.documentElement.removeAttribute('data-palette');
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: s.theme, palette: s.accent_palette } }));
    if (s.skin && s.skin !== document.documentElement.getAttribute('data-skin')) {
      document.documentElement.setAttribute('data-skin', s.skin);
      const urlSkin = new URLSearchParams(window.location.search).get('skin');
      if (urlSkin !== s.skin) {
        const next = new URL(window.location.href);
        next.searchParams.set('skin', s.skin);
        if (s.theme) next.searchParams.set('theme', s.theme);
        if (s.accent_palette) next.searchParams.set('palette', s.accent_palette);
        window.location.replace(next.toString());
        return;
      }
    }
    if (window.__applyAccentCss) {
      window.__applyAccentCss(s.use_custom_accent && s.custom_accent ? s.custom_accent : null);
    }
    if (window.BackgroundRegistry) {
      const bgStyle = s.bg_style || (window.Settings && window.Settings.get('bg_style')) || 'match_theme';
      const curSkin = s.skin || document.documentElement.getAttribute('data-skin') || 'crazy';
      if (bgStyle === 'match_theme') {
        const targetStyle = window.BackgroundRegistry.resolveThemeStyle(s.theme || document.documentElement.getAttribute('data-theme'), curSkin);
        window.BackgroundRegistry.switchTo(targetStyle);
      } else {
        window.BackgroundRegistry.switchTo(bgStyle);
      }
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
    applyNtpSettings(window.Settings.data, false);
  }

  window.addEventListener('settings-changed', (e) => {
    const s = (e && e.detail) || (window.Settings && window.Settings.data);
    if (s) {
      applyNtpSettings(s, false);
    }
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
  const workspacesListEl = document.getElementById('workspaces-list');
  const btnAddWorkspace = document.getElementById('btn-add-workspace');
  let currentWorkspaces = [];
  let activeWorkspaceId = 'main';

  function renderWorkspaces(workspaces, activeId) {
    if (!workspacesListEl || !Array.isArray(workspaces)) return;
    currentWorkspaces = workspaces;
    if (activeId) activeWorkspaceId = activeId;
    workspacesListEl.innerHTML = '';

    workspaces.forEach((ws, idx) => {
      const chip = document.createElement('button');
      chip.className = `workspace-chip${ws.id === activeWorkspaceId ? ' active' : ''}`;
      chip.dataset.ws = ws.id;
      chip.title = `${ws.name} (${ws.tab_count} tab${ws.tab_count === 1 ? '' : 's'}) [Ctrl+Alt+${idx + 1}]`;

      const iconName = ws.icon || 'folder';
      const iconHtml = (window.Icons && typeof window.Icons.get === 'function')
        ? window.Icons.get(iconName, '', 14)
        : '';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'ws-name';
      nameSpan.textContent = ws.name;

      const badge = document.createElement('span');
      badge.className = 'ws-tab-badge';
      badge.textContent = ws.tab_count || 0;

      chip.innerHTML = iconHtml;
      chip.appendChild(nameSpan);
      chip.appendChild(badge);

      chip.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          openNtpItemInNewTab('about:blank', `Workspace: ${ws.name}`, e);
          return;
        }
        if (ws.id !== activeWorkspaceId) {
          activeWorkspaceId = ws.id;
          document.querySelectorAll('.workspace-chip').forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          if (window.bridge && typeof window.bridge.send === 'function') {
            window.bridge.send('switch_workspace', { workspace_id: ws.id });
          }
        }
      });

      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const action = confirm(`Delete workspace "${ws.name}"?`);
        if (action && window.bridge) {
          window.bridge.send('delete_workspace', { workspace_id: ws.id });
        }
      });

      workspacesListEl.appendChild(chip);
    });
  }

  if (btnAddWorkspace) {
    btnAddWorkspace.addEventListener('click', () => {
      const name = prompt('Enter new workspace name:');
      if (name && name.trim() && window.bridge) {
        window.bridge.send('create_workspace', { name: name.trim() });
      }
    });
  }

  // Hotkeys Ctrl+Alt+1..9
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.key >= '1' && e.key <= '9') {
      const targetIdx = parseInt(e.key, 10) - 1;
      if (currentWorkspaces[targetIdx]) {
        e.preventDefault();
        const targetWs = currentWorkspaces[targetIdx];
        if (window.bridge) {
          window.bridge.send('switch_workspace', { workspace_id: targetWs.id });
        }
      }
    }
  });

  if (window.bridge) {
    window.bridge.on('workspaces_update', (data) => {
      if (data && data.workspaces) {
        renderWorkspaces(data.workspaces, data.active_workspace_id);
      }
    });
    window.bridge.send('get_workspaces');
    window.bridge.send('get_settings');
  }

  // Initial workspaces render so the left rail is never blank before IPC returns
  if (workspacesListEl && (!workspacesListEl.children || workspacesListEl.children.length === 0)) {
    renderWorkspaces([
      { id: 'main', name: 'Main', icon: 'folder', tab_count: 1 },
      { id: 'college', name: 'College', icon: 'book', tab_count: 0 },
      { id: 'projects', name: 'Projects', icon: 'code', tab_count: 0 },
      { id: 'media', name: 'Media', icon: 'play', tab_count: 0 },
      { id: 'games', name: 'Games', icon: 'terminal', tab_count: 0 }
    ], 'main');
  }
})();
