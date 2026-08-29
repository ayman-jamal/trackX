import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.recomptracker.app',
  appName: 'Recomp Tracker',
  webDir: 'www',
  // Routes window.fetch/XMLHttpRequest through native HTTP instead of the
  // WebView, which bypasses CORS entirely — needed because a plain WebView
  // fetch to script.google.com would otherwise be blocked cross-origin.
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
