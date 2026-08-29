// Thin key-value storage wrapper. Uses the Capacitor Preferences plugin
// when running inside the native app shell; falls back to localStorage so
// the exact same code also runs in a plain browser (used for testing).
window.RT = window.RT || {};

(function () {
  "use strict";

  function nativePrefs() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
  }

  async function get(key) {
    const prefs = nativePrefs();
    if (prefs) {
      const { value } = await prefs.get({ key });
      return value;
    }
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  async function set(key, value) {
    const prefs = nativePrefs();
    if (prefs) { await prefs.set({ key, value }); return; }
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  async function getJSON(key, fallback) {
    const raw = await get(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  async function setJSON(key, value) {
    await set(key, JSON.stringify(value));
  }

  window.RT.storage = { get, set, getJSON, setJSON };
})();
