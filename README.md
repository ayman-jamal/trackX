# Recomp Tracker

An Android app that logs your workouts straight into your Google Sheet in
real time — pick a day, log Actual Reps + Kg exercise by exercise, and it
writes directly into the matching row of your `Week-N` tab. Exercise names,
sets, and rep ranges all come from the sheet itself; adding a new exercise
in the app adds it back to every week tab that has that day.

**Start here → [SETUP.md](SETUP.md)** for the full walkthrough: deploying the
Apps Script backend, building the APK with GitHub Actions, and installing it.

## Project layout

```
recomp-tracker-app/
├── apps-script/
│   └── Code.gs              Paste this into your Sheet's Apps Script editor
├── www/                     The app itself (plain HTML/CSS/JS, no build step)
│   ├── index.html
│   ├── css/app.css
│   ├── js/{storage,api,match,app}.js
│   └── data/                Bundled exercise-image index (public domain)
├── android/                 Native Android project (Capacitor)
├── test/
│   ├── mock-server.js       Stand-in backend for testing without touching Sheets
│   ├── sheet-logic.js       Sheet-parsing logic, shared with Code.gs's design
│   └── parse_test.js        Verifies parsing against a real sheet dump
├── .github/workflows/
│   └── build-apk.yml        Builds the APK on every push (or manually)
├── capacitor.config.ts
└── package.json
```

## Why no Google Cloud project / OAuth?

The app talks to a Google Apps Script Web App bound to your own spreadsheet,
authenticated with a shared-secret token instead of a Google sign-in flow.
That means zero Google Cloud setup, but it also means: keep your deployment
URL and token private (like a password), since anyone with both can write to
your sheet. See SETUP.md for the deploy steps and the security trade-off.

## License

The bundled exercise images come from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense /
public domain).
