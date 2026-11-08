// Settings store: handles localStorage persistence, change listeners, and IPC synchronization
(function (root) {
  'use strict';

  const STORAGE_KEY = 'rusty_browser_settings_v4';

  const DEFAULT_SETTINGS = {
    skin: 'crazy',                    // 'crazy' | 'minimal'
    theme: 'sunset',                  // 'sunset' | 'midnight' | 'light' | 'amoled' | 'aurora' | 'cyberpunk' | 'matcha' | 'sakura'
    custom_accent: '#f97316',
    tabs_layout: 'horizontal',        // 'horizontal' | 'vertical'
    vertical_collapsed: false,
    density: 'normal',               // 'compact' | 'normal' | 'relaxed'
    default_search: 'google',        // 'google' | 'duckduckgo' | 'bing' | 'brave' | 'youtube' | 'github'
    effects_intensity: 80,           // 0 to 100
    fx_glow: true,
    fx_tilt: true,
    fx_magnetic: true,
    fx_ripple: true,
    fx_trail: false,
    fx_confetti: true,
    fx_canvas_bg: true,
    memory_saver_timeout_secs: 600,
    show_memory_badge: true,
    ntp_show_clock: true,
    ntp_show_greeting: true,
    ntp_show_speed_dial: true,
    ntp_show_notes: true,
    ntp_show_weather: true
  };

  class SettingsStore {
    constructor() {
      this.data = { ...DEFAULT_SETTINGS };
      this.listeners = new Set();
      this.load();
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
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error('[settings] Failed to save settings:', e);
      }
      if (root.bridge) {
        root.bridge.send('save_settings', { settings: this.data });
      }
      this.notify();
    }

    get(key) {
      return this.data[key];
    }

    set(key, value) {
      if (this.data[key] === value) return;
      this.data[key] = value;
      this.save();
    }

    setMany(obj) {
      let changed = false;
      for (const [k, v] of Object.entries(obj)) {
        if (this.data[k] !== v) {
          this.data[k] = v;
          changed = true;
        }
      }
      if (changed) this.save();
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
    }
  }

  root.Settings = new SettingsStore();
})(typeof window !== 'undefined' ? window : this);
