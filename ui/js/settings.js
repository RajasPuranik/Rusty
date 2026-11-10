// Settings store: handles localStorage persistence, change listeners, and IPC synchronization
(function (root) {
  'use strict';

  const STORAGE_KEY = 'rusty_browser_settings_v4';

  const DEFAULT_SETTINGS = {
    lite_mode: false,
    skin: 'crazy',                    // 'crazy' | 'minimal' | 'mayank'
    accent_palette: 'slate',          // 'graphite' | 'slate' | 'mocha' | 'midnight_blue'
    bg_style: 'match_theme',
    theme: 'sunset',                  // 'sunset' | 'midnight' | 'light' | 'amoled' | 'aurora' | 'cyberpunk' | 'matcha' | 'sakura' | 'graphite' | 'slate' | 'mocha' | 'midnight_blue'
    custom_accent: '#f97316',
    use_custom_accent: false,
    tabs_layout: 'horizontal',        // 'horizontal' | 'vertical'
    vertical_collapsed: false,
    density: 'normal',                // 'compact' | 'normal' | 'relaxed'
    default_search: 'google',         // 'google' | 'yahoo' | 'duckduckgo' | 'bing' | 'brave' | 'youtube' | 'github' | custom id
    omnibox_engine_outline: true,
    custom_engines: [],
    effects_intensity: 80,            // 0 to 100
    fx_glow: true,
    fx_tilt: true,
    fx_magnetic: true,
    fx_ripple: true,
    fx_trail: false,
    fx_confetti: true,
    fx_canvas_bg: true,
    memory_saver_timeout_secs: 600,
    show_memory_badge: true,
    open_tabs_in_background: true,
    ntp_show_clock: true,
    ntp_show_greeting: true,
    ntp_show_speed_dial: true,
    ntp_show_notes: true,
    ntp_show_weather: true,
    ntp_globe_clouds: false,
    world_clocks: [],
    weather_location: '',
    pet_type: '',                     // '' | 'dog' | 'cat' | 'robot' | 'fox' | 'slime'
    pet_name: 'Pixel',
    pet_color: '#f97316',
    pet_accessory: 'none',            // 'none' | 'collar' | 'bow' | 'hat' | 'glasses'
    pet_mood: 'content',
    pet_roam: false,
    extensions_enabled: true,
    extensions: [],
    userscripts: []
  };

  class SettingsStore {
    constructor() {
      this.data = { ...DEFAULT_SETTINGS };
      this.listeners = new Set();
      this.load();
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', (e) => {
          if (e.key !== STORAGE_KEY || !e.newValue) return;
          try {
            const incoming = JSON.parse(e.newValue);
            if (!incoming || typeof incoming !== 'object') return;
            this.data = { ...DEFAULT_SETTINGS, ...incoming };
            if (root.BOOT_SETTINGS) {
              Object.assign(root.BOOT_SETTINGS, this.data);
            }
            this.notify();
          } catch (_) {}
        });
      }
    }

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.data = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        }
      } catch (e) {
        console.warn('[settings] Failed to load settings from storage:', e);
      }
      if (root.BOOT_SETTINGS) {
        this.data = { ...this.data, ...root.BOOT_SETTINGS };
      }
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error('[settings] Failed to save settings:', e);
      }
      if (root.BOOT_SETTINGS) {
        Object.assign(root.BOOT_SETTINGS, this.data);
      }
      if (root.bridge) {
        root.bridge.send('save_settings', { settings: this.data });
      }
      this.notify();
    }

    syncFromHost(hostSettings) {
      if (!hostSettings || typeof hostSettings !== 'object') return;
      this.data = { ...this.data, ...hostSettings };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (_) {}
      if (root.BOOT_SETTINGS) {
        Object.assign(root.BOOT_SETTINGS, this.data);
      }
      this.notify();
    }

    get(key) {
      return this.data[key];
    }

    set(key, value) {
      if (this.data[key] === value) return;
      this.data[key] = value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error('[settings] Failed to save settings:', e);
      }
      if (root.BOOT_SETTINGS) {
        Object.assign(root.BOOT_SETTINGS, this.data);
      }
      if (root.bridge) {
        root.bridge.send('set_setting', { key, value });
      }
      this.notify();
    }

    setMany(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.assign(this.data, obj);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error('[settings] Failed to save settings:', e);
      }
      if (root.BOOT_SETTINGS) {
        Object.assign(root.BOOT_SETTINGS, this.data);
      }
      if (root.bridge && typeof root.bridge.send === 'function') {
        root.bridge.send('save_settings', { settings: obj });
      }
      this.notify();
    }

    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    notify() {
      for (const fn of this.listeners) {
        try {
          fn(this.data);
        } catch (e) {
          console.error('[settings] Error in change listener:', e);
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settings-changed', { detail: this.data }));
      }
    }
  }

  root.Settings = new SettingsStore();
})(typeof window !== 'undefined' ? window : this);
