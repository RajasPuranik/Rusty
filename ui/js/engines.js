// Shared Search Engine Table & Outline Palette Controller (A4)
// Single source of truth for New Tab Search Bar, Omnibox Search Outline, and Settings.
(function (root) {
  'use strict';

  const BUILTIN_ENGINES = [
    {
      id: 'google',
      name: 'Google',
      template: 'https://www.google.com/search?q=%s',
      // Four-color segmented outline strictly in Blue, Red, Yellow, Green order (no logo/wordmark)
      colors: ['#4285F4', '#EA4335', '#FBBC05', '#34A853'],
      colorsLight: ['#2563EB', '#DC2626', '#A16207', '#15803D'],
      caret: '#4285F4',
      caretLight: '#1D4ED8',
      swatch: 'linear-gradient(90deg, #4285F4 0% 25%, #EA4335 25% 50%, #FBBC05 50% 75%, #34A853 75% 100%)',
      builtin: true
    },
    {
      id: 'yahoo',
      name: 'Yahoo',
      template: 'https://search.yahoo.com/search?p=%s',
      color: '#A855F7',
      colorLight: '#7E22CE',
      caret: '#A855F7',
      caretLight: '#7E22CE',
      builtin: true
    },
    {
      id: 'bing',
      name: 'Bing',
      template: 'https://www.bing.com/search?q=%s',
      color: '#38BDF8',
      colorLight: '#0284C7',
      caret: '#38BDF8',
      caretLight: '#0284C7',
      builtin: true
    },
    {
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      template: 'https://duckduckgo.com/?q=%s',
      color: '#DE5833',
      colorLight: '#C2410C',
      caret: '#DE5833',
      caretLight: '#C2410C',
      builtin: true
    },
    {
      id: 'brave',
      name: 'Brave',
      template: 'https://search.brave.com/search?q=%s',
      color: '#FB923C',
      colorLight: '#C84B0F',
      caret: '#FB923C',
      caretLight: '#C84B0F',
      builtin: true
    },
    {
      id: 'youtube',
      name: 'YouTube',
      template: 'https://www.youtube.com/results?search_query=%s',
      color: '#EF4444',
      colorLight: '#DC2626',
      caret: '#EF4444',
      caretLight: '#DC2626',
      builtin: true
    },
    {
      id: 'github',
      name: 'GitHub',
      template: 'https://github.com/search?q=%s',
      color: '#E2E8F0',
      colorLight: '#475569',
      caret: '#F8FAFC',
      caretLight: '#334155',
      builtin: true
    }
  ];

  function normalizeHex(hex, fallback = '#f97316') {
    if (typeof hex !== 'string') return fallback;
    const t = hex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(t)) return t;
    if (/^#[0-9a-fA-F]{3}$/.test(t)) {
      return '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    }
    return fallback;
  }

  function hexLuminance(hex) {
    const h = normalizeHex(hex, '#808080');
    const r = parseInt(h.slice(1, 3), 16) / 255;
    const g = parseInt(h.slice(3, 5), 16) / 255;
    const b = parseInt(h.slice(5, 7), 16) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function adjustColorForTheme(hex, isLightTheme) {
    let cur = normalizeHex(hex, '#3b82f6');
    const lum = hexLuminance(cur);
    if (isLightTheme && lum > 0.22) {
      // Darken lighter custom colors on Light theme so border keeps >=3.2:1 contrast on #e2e8f0/#fff
      for (let i = 0; i < 8 && hexLuminance(cur) > 0.21; i++) {
        const r = Math.max(0, Math.round(parseInt(cur.slice(1, 3), 16) * 0.78));
        const g = Math.max(0, Math.round(parseInt(cur.slice(3, 5), 16) * 0.78));
        const b = Math.max(0, Math.round(parseInt(cur.slice(5, 7), 16) * 0.78));
        cur = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }
      return cur;
    }
    if (!isLightTheme && lum < 0.08) {
      // Lift very dark custom colors on dark backgrounds
      const r = Math.min(255, Math.round(parseInt(cur.slice(1, 3), 16) + 110));
      const g = Math.min(255, Math.round(parseInt(cur.slice(3, 5), 16) + 110));
      const b = Math.min(255, Math.round(parseInt(cur.slice(5, 7), 16) + 110));
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
    return cur;
  }

  function getDefaultAccentHex() {
    try {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
      return normalizeHex(val, '#f97316');
    } catch (_) {
      return '#f97316';
    }
  }

  function sanitizeCustomEngines(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set(BUILTIN_ENGINES.map((e) => e.id));
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      const name = String(item.name || '').trim();
      const template = String(item.template || '').trim();
      if (!id || seen.has(id) || !name || !template.includes('%s')) continue;
      seen.add(id);
      out.push({
        id,
        name: name.slice(0, 32),
        template,
        color: normalizeHex(item.color, getDefaultAccentHex()),
        builtin: false
      });
    }
    return out;
  }

  function getCustomEngines(overrideList) {
    if (Array.isArray(overrideList)) return sanitizeCustomEngines(overrideList);
    if (root.Settings && Array.isArray(root.Settings.get('custom_engines'))) {
      return sanitizeCustomEngines(root.Settings.get('custom_engines'));
    }
    return [];
  }

  function getAll(customOverride) {
    return BUILTIN_ENGINES.concat(getCustomEngines(customOverride));
  }

  function getById(id, customOverride) {
    const all = getAll(customOverride);
    return all.find((e) => e.id === id) || BUILTIN_ENGINES[0];
  }

  function getActiveTheme() {
    if (typeof document !== 'undefined' && document.documentElement) {
      return document.documentElement.getAttribute('data-theme') || 'sunset';
    }
    return 'sunset';
  }

  function resolveOutlineColors(engineOrId, customOverride, themeOverride) {
    const eng = typeof engineOrId === 'string'
      ? getById(engineOrId, customOverride)
      : (engineOrId || BUILTIN_ENGINES[0]);
    const theme = themeOverride || getActiveTheme();
    const isLight = theme === 'light';

    if (Array.isArray(eng.colors) && eng.colors.length === 4) {
      const palette = isLight && Array.isArray(eng.colorsLight) ? eng.colorsLight : eng.colors;
      return {
        colors: palette.slice(0, 4),
        caret: (isLight && eng.caretLight) ? eng.caretLight : (eng.caret || palette[0]),
        swatch: eng.swatch || palette[0]
      };
    }

    const baseColor = eng.builtin
      ? ((isLight && eng.colorLight) ? eng.colorLight : eng.color)
      : adjustColorForTheme(eng.color || getDefaultAccentHex(), isLight);
    const caret = eng.builtin
      ? ((isLight && eng.caretLight) ? eng.caretLight : baseColor)
      : baseColor;

    return {
      colors: [baseColor, baseColor, baseColor, baseColor],
      caret,
      swatch: baseColor
    };
  }

  function applyOutlineStyles(el, engineId, customOverride) {
    if (!el) return;
    if (!engineId) {
      el.style.removeProperty('--outline-c1');
      el.style.removeProperty('--outline-c2');
      el.style.removeProperty('--outline-c3');
      el.style.removeProperty('--outline-c4');
      el.style.removeProperty('--engine-caret');
      return;
    }
    const resolved = resolveOutlineColors(engineId, customOverride);
    el.style.setProperty('--outline-c1', resolved.colors[0]);
    el.style.setProperty('--outline-c2', resolved.colors[1]);
    el.style.setProperty('--outline-c3', resolved.colors[2]);
    el.style.setProperty('--outline-c4', resolved.colors[3]);
    el.style.setProperty('--engine-caret', resolved.caret);
  }

  function isSearchQueryText(raw) {
    if (typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    if (/^about:/i.test(trimmed)) return false;
    if (/^rusty:/i.test(trimmed)) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed)) return false;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed)) return false;
    if (!trimmed.includes(' ') && /^[^\s]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed)) return false;
    return true;
  }

  function buildSearchUrl(query, engineId, customOverride) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return 'about:blank';
    if (!isSearchQueryText(trimmed)) {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) return trimmed;
      return `https://${trimmed}`;
    }
    const eng = getById(engineId, customOverride);
    const tpl = (eng && eng.template && eng.template.includes('%s'))
      ? eng.template
      : BUILTIN_ENGINES[0].template;
    return tpl.replace('%s', encodeURIComponent(trimmed));
  }

  function addCustomEngine({ name, template, color }) {
    const cleanName = String(name || '').trim().slice(0, 32);
    let cleanTpl = String(template || '').trim();
    if (!cleanName || !cleanTpl) return null;
    if (!cleanTpl.includes('%s')) {
      cleanTpl += (cleanTpl.includes('?') ? '&q=%s' : '?q=%s');
    }
    if (!/^https?:\/\//i.test(cleanTpl)) {
      cleanTpl = `https://${cleanTpl}`;
    }
    const id = 'custom_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 100);
    const entry = {
      id,
      name: cleanName,
      template: cleanTpl,
      color: normalizeHex(color, getDefaultAccentHex())
    };
    const existing = getCustomEngines().map(({ id: cid, name: cname, template: ctpl, color: ccol }) => ({
      id: cid,
      name: cname,
      template: ctpl,
      color: ccol
    }));
    const next = existing.concat([entry]);
    if (root.Settings) {
      root.Settings.set('custom_engines', next);
    }
    return entry;
  }

  function removeCustomEngine(id) {
    const existing = getCustomEngines().filter((e) => e.id !== id).map(({ id: cid, name, template, color }) => ({
      id: cid,
      name,
      template,
      color
    }));
    if (root.Settings) {
      const updates = { custom_engines: existing };
      if (root.Settings.get('default_search') === id) {
        updates.default_search = 'google';
      }
      root.Settings.setMany(updates);
    }
  }

  root.RustyEngines = {
    BUILTIN_ENGINES,
    getAll,
    getById,
    getCustomEngines,
    resolveOutlineColors,
    applyOutlineStyles,
    getDefaultAccentHex,
    isSearchQueryText,
    buildSearchUrl,
    addCustomEngine,
    removeCustomEngine
  };
})(typeof window !== 'undefined' ? window : this);
