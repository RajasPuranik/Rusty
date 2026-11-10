// Early boot loader: injects ONLY active skin CSS and JS before DOM render
(function () {
  'use strict';

  // Global HTML escaping utility for all internal pages (chrome, newtab, panels)
  window.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const STORAGE_KEY = 'rusty_browser_settings_v4';

  const DEFAULT_BOOT_SETTINGS = {
    skin: 'crazy',
    accent_palette: '',
    bg_style: 'match_theme',
    theme: 'sunset',
    tabs_layout: 'horizontal',
    vertical_collapsed: false,
    density: 'normal',
    custom_accent: '#f97316',
    use_custom_accent: false,
    effects_intensity: 80,
    fx_glow: true,
    fx_tilt: true,
    fx_magnetic: true,
    fx_ripple: true,
    fx_trail: false,
    fx_confetti: true,
    fx_canvas_bg: true,
    pet_type: '',
    pet_name: 'Pixel',
    pet_color: '#f97316',
    pet_accessory: 'none',
    pet_mood: 'content',
    pet_roam: false
  };

  function readLatestSettings() {
    let merged = { ...DEFAULT_BOOT_SETTINGS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        merged = Object.assign(merged, JSON.parse(raw));
      }
    } catch (err) {
      console.warn('[boot] Failed to parse localStorage settings:', err);
    }
    if (window.Settings && window.Settings.data) {
      merged = Object.assign(merged, window.Settings.data);
    }
    return merged;
  }

  function writeLatestSettings(updated) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (_) {}
    if (window.Settings && window.Settings.data) {
      Object.assign(window.Settings.data, updated);
    }
    window.BOOT_SETTINGS = updated;
  }

  // Shared custom accent CSS variable helper (pass null to restore theme defaults)
  window.__applyAccentCss = function (hex) {
    const style = document.documentElement.style;
    if (!hex || typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
      style.removeProperty('--accent');
      style.removeProperty('--accent-primary');
      style.removeProperty('--accent-hover');
      style.removeProperty('--accent-soft');
      style.removeProperty('--accent-2');
      style.removeProperty('--accent-secondary');
      style.removeProperty('--accent-contrast');
      style.removeProperty('--accent-highlight');
      style.removeProperty('--accent-glow');
      style.removeProperty('--bg-particle');
      window.dispatchEvent(new CustomEvent('themechange', { detail: { accent: null } }));
      return;
    }

    const r = parseInt(hex.slice(1, 3), 16) || 59;
    const g = parseInt(hex.slice(3, 5), 16) || 130;
    const b = parseInt(hex.slice(5, 7), 16) || 246;

    // WCAG contrast: calculate relative luminance
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const contrastText = lum > 0.55 ? '#000000' : '#ffffff';

    // Hover (15% darker or lighter)
    const hR = Math.max(0, Math.min(255, Math.floor(r * 0.85)));
    const hG = Math.max(0, Math.min(255, Math.floor(g * 0.85)));
    const hB = Math.max(0, Math.min(255, Math.floor(b * 0.85)));
    const hoverHex = `#${hR.toString(16).padStart(2, '0')}${hG.toString(16).padStart(2, '0')}${hB.toString(16).padStart(2, '0')}`;

    // Secondary hue-shifted accent
    const secR = Math.min(255, Math.floor(r * 0.7 + 60));
    const secG = Math.min(255, Math.floor(g * 0.7 + 80));
    const secB = Math.min(255, Math.floor(b * 0.7 + 120));
    const secHex = `#${secR.toString(16).padStart(2, '0')}${secG.toString(16).padStart(2, '0')}${secB.toString(16).padStart(2, '0')}`;

    style.setProperty('--accent', hex);
    style.setProperty('--accent-primary', hex);
    style.setProperty('--accent-hover', hoverHex);
    style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.22)`);
    style.setProperty('--accent-2', secHex);
    style.setProperty('--accent-secondary', secHex);
    style.setProperty('--accent-contrast', contrastText);
    style.setProperty('--accent-highlight', `rgba(${r}, ${g}, ${b}, 0.22)`);
    style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.48)`);
    style.setProperty('--bg-particle', hex);

    window.dispatchEvent(new CustomEvent('themechange', { detail: { accent: hex } }));
  };

  // 1. Parse URL overrides (passed from Rust host or ?skin=crazy&theme=aurora&tabs=side&palette=slate)
  const urlParams = new URLSearchParams(window.location.search);
  const paramSkin = urlParams.get('skin');
  const paramTheme = urlParams.get('theme');
  const paramTabs = urlParams.get('tabs');
  const paramPalette = urlParams.get('palette') || urlParams.get('accent_palette');

  const settings = readLatestSettings();
  let mutatedFromUrl = false;
  if (paramSkin === 'crazy' || paramSkin === 'minimal' || paramSkin === 'mayank') {
    settings.skin = paramSkin;
    mutatedFromUrl = true;
  }
  if (paramTheme) {
    settings.theme = paramTheme;
    mutatedFromUrl = true;
  }
  if (paramPalette === 'graphite' || paramPalette === 'slate' || paramPalette === 'mocha' || paramPalette === 'midnight_blue') {
    settings.accent_palette = paramPalette;
    mutatedFromUrl = true;
  }
  if (paramTabs === 'side' || paramTabs === 'vertical' || paramTabs === 'horizontal') {
    settings.tabs_layout = paramTabs === 'side' ? 'vertical' : paramTabs;
    mutatedFromUrl = true;
  }
  if (mutatedFromUrl) {
    writeLatestSettings(settings);
  }

  const activeSkin = (settings.skin === 'minimal' || settings.skin === 'mayank') ? settings.skin : 'crazy';
  const activeTheme = settings.theme || 'sunset';
  const activeTabs = settings.tabs_layout === 'vertical' ? 'vertical' : 'horizontal';
  const activePalette = (settings.accent_palette === 'graphite' || settings.accent_palette === 'slate' || settings.accent_palette === 'mocha' || settings.accent_palette === 'midnight_blue')
    ? settings.accent_palette
    : (activeTheme === 'graphite' || activeTheme === 'slate' || activeTheme === 'mocha' || activeTheme === 'midnight_blue' ? activeTheme : '');

  // 2. Set data attributes on <html> before body renders (zero FOUC)
  const root = document.documentElement;
  root.setAttribute('data-skin', activeSkin);
  if (activePalette) {
    root.setAttribute('data-palette', activePalette);
  } else {
    root.removeAttribute('data-palette');
  }
  root.setAttribute('data-theme', activeTheme);
  root.setAttribute('data-tabs', activeTabs);
  if (settings.density) {
    root.setAttribute('data-density', settings.density);
  }
  if (settings.vertical_collapsed) {
    root.setAttribute('data-sidebar-collapsed', 'true');
  }
  if (settings.use_custom_accent && settings.custom_accent) {
    window.__applyAccentCss(settings.custom_accent);
  }

  // 3. Inject ONLY the active skin CSS
  const head = document.head || document.getElementsByTagName('head')[0];
  const skinCssLink = document.createElement('link');
  skinCssLink.rel = 'stylesheet';
  skinCssLink.id = 'active-skin-stylesheet';
  skinCssLink.href = `css/skin-${activeSkin}.css`;
  head.appendChild(skinCssLink);

  // 4. Inject effects scripts ONLY for the active skin
  if (activeSkin === 'crazy') {
    const fxScript = document.createElement('script');
    fxScript.id = 'active-skin-fx-script';
    fxScript.src = 'js/fx-crazy.js';
    fxScript.defer = true;
    fxScript.async = false;
    head.appendChild(fxScript);

    const petScript = document.createElement('script');
    petScript.id = 'active-skin-pet-script';
    petScript.src = 'js/pet-crazy.js';
    petScript.defer = true;
    petScript.async = false;
    head.appendChild(petScript);
  } else if (activeSkin === 'mayank') {
    const fxScript = document.createElement('script');
    fxScript.id = 'active-skin-fx-script';
    fxScript.src = 'js/fx-mayank.js';
    fxScript.defer = true;
    fxScript.async = false;
    head.appendChild(fxScript);
  }

  // 5. Global skin switcher (hot-switch without browser restart; unloads old CSS/JS cleanly)
  window.switchSkin = function (newSkin) {
    if (newSkin !== 'minimal' && newSkin !== 'crazy' && newSkin !== 'mayank') return;

    const latest = readLatestSettings();
    latest.skin = newSkin;
    writeLatestSettings(latest);

    const currentActive = root.getAttribute('data-skin');
    if (currentActive === newSkin) {
      if (window.bridge && typeof window.bridge.send === 'function') {
        window.bridge.send('set_setting', { key: 'skin', value: newSkin });
        window.bridge.send('overlay', { open: false });
      }
      return;
    }

    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('overlay', { open: false });
      window.bridge.send('set_setting', { key: 'skin', value: newSkin });
    }

    window.__isSwitchingSkin = true;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('skin', newSkin);
    nextUrl.searchParams.set('theme', latest.theme || activeTheme);
    nextUrl.searchParams.set('palette', latest.accent_palette || activePalette);

    // Wait briefly so WebView2 IPC flushes before page navigation frees the old JS/CSS
    setTimeout(() => {
      window.location.replace(nextUrl.toString());
    }, 25);
  };

  // 6. Global accent palette switcher (live CSS variable updates, zero reload)
  window.switchPalette = function (newPalette) {
    if (newPalette !== 'graphite' && newPalette !== 'slate' && newPalette !== 'mocha' && newPalette !== 'midnight_blue') return;

    const latest = readLatestSettings();
    latest.accent_palette = newPalette;
    latest.use_custom_accent = false;
    writeLatestSettings(latest);

    window.__applyAccentCss(null);
    root.setAttribute('data-palette', newPalette);

    try {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('palette', newPalette);
      window.history.replaceState(null, '', nextUrl.toString());
    } catch (_) {}

    const payload = { accent_palette: newPalette, use_custom_accent: false };
    if (window.Settings) {
      Object.assign(window.Settings.data, payload);
      window.Settings.notify();
    }
    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('save_settings', { settings: payload });
      window.bridge.send('set_setting', { key: 'accent_palette', value: newPalette });
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: { palette: newPalette, theme: latest.theme } }));
  };

  window.switchTheme = function (newTheme) {
    const latest = readLatestSettings();
    latest.theme = newTheme;
    latest.use_custom_accent = false;

    if (newTheme === 'graphite' || newTheme === 'slate' || newTheme === 'mocha' || newTheme === 'midnight_blue') {
      latest.accent_palette = newTheme;
      root.setAttribute('data-palette', newTheme);
    } else {
      latest.accent_palette = '';
      root.removeAttribute('data-palette');
    }
    writeLatestSettings(latest);

    window.__applyAccentCss(null);
    root.setAttribute('data-theme', newTheme);

    try {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('theme', newTheme);
      if (latest.accent_palette) nextUrl.searchParams.set('palette', latest.accent_palette);
      else nextUrl.searchParams.delete('palette');
      window.history.replaceState(null, '', nextUrl.toString());
    } catch (_) {}

    const payload = { theme: newTheme, accent_palette: latest.accent_palette, use_custom_accent: false };
    if (window.Settings) {
      Object.assign(window.Settings.data, payload);
      window.Settings.notify();
    }
    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('save_settings', { settings: payload });
      window.bridge.send('set_setting', { key: 'theme', value: newTheme });
      window.bridge.send('set_setting', { key: 'accent_palette', value: latest.accent_palette });
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: newTheme, palette: latest.accent_palette } }));
  };

  window.toggleTabsLayout = function () {
    const next = root.getAttribute('data-tabs') === 'vertical' ? 'horizontal' : 'vertical';
    const latest = readLatestSettings();
    latest.tabs_layout = next;
    writeLatestSettings(latest);

    root.setAttribute('data-tabs', next);
    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('set_setting', { key: 'tabs_layout', value: next });
    }
    window.dispatchEvent(new CustomEvent('tabs-layout-changed', { detail: { layout: next } }));
  };

  window.BOOT_SETTINGS = settings;
})();
