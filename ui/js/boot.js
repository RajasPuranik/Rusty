// Early boot loader: injects ONLY active skin CSS and JS before DOM render
(function () {
  'use strict';

  const STORAGE_KEY = 'rusty_browser_settings_v4';

  // 1. Parse URL overrides (e.g., ?skin=crazy&theme=aurora&tabs=side)
  const urlParams = new URLSearchParams(window.location.search);
  const paramSkin = urlParams.get('skin');
  const paramTheme = urlParams.get('theme');
  const paramTabs = urlParams.get('tabs');

  // 2. Load stored settings from localStorage with default fallbacks
  let settings = {
    skin: 'crazy',
    theme: 'sunset',
    tabs_layout: 'horizontal', // 'horizontal' | 'vertical'
    vertical_collapsed: false,
    density: 'normal',
    accent_custom: '#f97316',
    effects_intensity: 80,
    fx_glow: true,
    fx_tilt: true,
    fx_magnetic: true,
    fx_ripple: true,
    fx_trail: false,
    fx_confetti: true,
    fx_canvas_bg: true
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      settings = Object.assign(settings, JSON.parse(raw));
    }
  } catch (err) {
    console.warn('[boot] Failed to parse localStorage settings:', err);
  }

  // URL parameters take precedence when testing/mocking
  const activeSkin = (paramSkin === 'crazy' || paramSkin === 'minimal') ? paramSkin : settings.skin;
  const activeTheme = paramTheme || settings.theme;
  const activeTabs = paramTabs === 'side' || paramTabs === 'vertical' ? 'vertical' : settings.tabs_layout;

  // 3. Set data attributes on html element
  const root = document.documentElement;
  root.setAttribute('data-skin', activeSkin);
  root.setAttribute('data-theme', activeTheme);
  root.setAttribute('data-tabs', activeTabs);
  if (settings.vertical_collapsed) {
    root.setAttribute('data-sidebar-collapsed', 'true');
  }

  // 4. Inject ONLY the active skin CSS
  const head = document.head || document.getElementsByTagName('head')[0];
  const skinCssLink = document.createElement('link');
  skinCssLink.rel = 'stylesheet';
  skinCssLink.href = `css/skin-${activeSkin}.css`;
  head.appendChild(skinCssLink);

  // 5. Inject crazy effects script ONLY if Crazy skin is active
  if (activeSkin === 'crazy') {
    const fxScript = document.createElement('script');
    fxScript.src = 'js/fx-crazy.js';
    fxScript.defer = true;
    head.appendChild(fxScript);
  }

  // 6. Global skin and theme switcher
  window.switchSkin = function (newSkin) {
    if (newSkin !== 'minimal' && newSkin !== 'crazy') return;
    settings.skin = newSkin;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('set_setting', { key: 'skin', value: newSkin });
    }
    // Reload UI webview so unused skin/effects are completely discarded from memory
    window.location.reload();
  };

  window.switchTheme = function (newTheme) {
    settings.theme = newTheme;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
    root.setAttribute('data-theme', newTheme);
    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('set_setting', { key: 'theme', value: newTheme });
    }
  };

  window.toggleTabsLayout = function () {
    const next = root.getAttribute('data-tabs') === 'vertical' ? 'horizontal' : 'vertical';
    root.setAttribute('data-tabs', next);
    settings.tabs_layout = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
    if (window.bridge && typeof window.bridge.send === 'function') {
      window.bridge.send('set_setting', { key: 'tabs_layout', value: next });
    }
    window.dispatchEvent(new CustomEvent('tabs-layout-changed', { detail: { layout: next } }));
  };

  window.BOOT_SETTINGS = settings;
})();
