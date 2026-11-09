// Early boot loader: injects ONLY active skin CSS and JS before DOM render
(function () {
  'use strict';

  const STORAGE_KEY = 'rusty_browser_settings_v4';

  const DEFAULT_BOOT_SETTINGS = {
    skin: 'crazy',
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
    fx_canvas_bg: true
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
      style.removeProperty('--accent-primary');
      style.removeProperty('--accent-secondary');
      style.removeProperty('--accent-highlight');
      style.removeProperty('--accent-glow');
      return;
    }

    const r = parseInt(hex.slice(1, 3), 16) || 59;
    const g = parseInt(hex.slice(3, 5), 16) || 130;
    const b = parseInt(hex.slice(5, 7), 16) || 246;

    const secR = Math.min(255, Math.floor(r * 0.7 + 60));
    const secG = Math.min(255, Math.floor(g * 0.7 + 80));
    const secB = Math.min(255, Math.floor(b * 0.7 + 120));
    const secHex = `#${secR.toString(16).padStart(2, '0')}${secG.toString(16).padStart(2, '0')}${secB.toString(16).padStart(2, '0')}`;

    style.setProperty('--accent-primary', hex);
    style.setProperty('--accent-secondary', secHex);
    style.setProperty('--accent-highlight', `rgba(${r}, ${g}, ${b}, 0.22)`);
    style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.48)`);
  };

  // 1. Parse URL overrides (passed from Rust host or ?skin=crazy&theme=aurora&tabs=side)
  const urlParams = new URLSearchParams(window.location.search);
  const paramSkin = urlParams.get('skin');
  const paramTheme = urlParams.get('theme');
  const paramTabs = urlParams.get('tabs');

  const settings = readLatestSettings();
  let mutatedFromUrl = false;
  if (paramSkin === 'crazy' || paramSkin === 'minimal') {
    settings.skin = paramSkin;
    mutatedFromUrl = true;
  }
  if (paramTheme) {
    settings.theme = paramTheme;
    mutatedFromUrl = true;
  }
  if (paramTabs === 'side' || paramTabs === 'vertical' || paramTabs === 'horizontal') {
    settings.tabs_layout = paramTabs === 'side' ? 'vertical' : paramTabs;
    mutatedFromUrl = true;
  }
  if (mutatedFromUrl) {
    writeLatestSettings(settings);
  }

  const activeSkin = (settings.skin === 'minimal' || settings.skin === 'crazy') ? settings.skin : 'crazy';
  const activeTheme = settings.theme || 'sunset';
  const activeTabs = settings.tabs_layout === 'vertical' ? 'vertical' : 'horizontal';

  // 2. Set data attributes on <html> before body renders (zero FOUC)
  const root = document.documentElement;
  root.setAttribute('data-skin', activeSkin);
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
  skinCssLink.href = `css/skin-${activeSkin}.css`;
  head.appendChild(skinCssLink);

  // 4. Inject crazy effects script ONLY if Crazy skin is active
  if (activeSkin === 'crazy') {
    const fxScript = document.createElement('script');
    fxScript.src = 'js/fx-crazy.js';
    fxScript.defer = true;
    head.appendChild(fxScript);
  }

  // 5. Global skin switcher (no browser restart needed; unloads old CSS/JS cleanly)
  window.switchSkin = function (newSkin) {
    if (newSkin !== 'minimal' && newSkin !== 'crazy') return;

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

    // Wait briefly so WebView2 IPC flushes before page navigation frees the old JS/CSS
    setTimeout(() => {
      window.location.replace(nextUrl.toString());
    }, 25);
  };

  window.switchTheme = function (newTheme) {
    const latest = readLatestSettings();
    latest.theme = newTheme;
    latest.use_custom_accent = false;
    writeLatestSettings(latest);

    window.__applyAccentCss(null);
    root.setAttribute('data-theme', newTheme);

    try {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('theme', newTheme);
      window.history.replaceState(null, '', nextUrl.toString());
    } catch (_) {}

    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('set_setting', { key: 'use_custom_accent', value: false });
      window.bridge.send('set_setting', { key: 'theme', value: newTheme });
    }
    if (window.Settings) {
      window.Settings.notify();
    }
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
