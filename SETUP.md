# Recomp Tracker — setup

This is an Android app that logs your workouts straight into your own Google
Sheet in real time. There's no backend server and no Google Cloud project to
create — the "backend" is a small script that lives inside your spreadsheet
(Google Apps Script), and the app just talks to it over HTTPS.

Three things need to happen, in this order:

1. Deploy the Apps Script inside your Google Sheet (5 minutes).
2. Push this project to GitHub and let GitHub Actions build the `.apk` (first
   run: ~5-10 minutes, hands-off).
3. Install the APK on your phone and paste in the script's URL.

## 1. Deploy the Apps Script

1. Open your workout Google Sheet (the one with the `Week-1`…`Week-4` tabs).
2. **Extensions → Apps Script.** A new tab opens with an empty script editor.
3. Delete whatever's in `Code.gs` there, and paste in the entire contents of
   this project's [`apps-script/Code.gs`](apps-script/Code.gs).
4. Near the top of the file, change this line to your own random string —
   this is the password the app uses to talk to your sheet, so make it long
   and don't reuse a real password:
   ```js
   var SHARED_SECRET = "change-me-to-a-long-random-string";
   ```
5. Save (Ctrl/Cmd+S), then **Deploy → New deployment**.
6. Click the gear icon next to "Select type" and choose **Web app**.
7. Set:
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone
     (this doesn't mean anyone can *use* it — every request still has to
     include the `SHARED_SECRET` from step 4, which only you have. It just
     means Google won't ask a caller to log in first, which a phone app
     can't do anyway.)
8. Click **Deploy**. The first time, Google will ask you to authorize the
   script — that's normal, it's your own script asking for permission to
   edit spreadsheets under your account (this app can open any sheet you
   point it at, not just the one it's pasted into, so it needs that broader
   permission — you may see an "unverified app" warning since it's your own
   personal script; click **Advanced → Go to (script name) (unsafe)** to
   continue, same as any script you deploy yourself).
9. Copy the **Web app URL** it gives you (looks like
   `https://script.google.com/macros/s/AKfycb.../exec`). You'll paste this
   into the app's Settings screen along with the secret from step 4.

**If you edit `Code.gs` later:** you need to **Deploy → Manage deployments →
edit (pencil) → New version → Deploy** for changes to take effect — saving
the file alone doesn't update the live web app. The web app URL stays the
same across versions, so nothing needs to change in the app when you do
this.

## 2. Build the APK with GitHub Actions

1. Create a new (private, recommended) GitHub repository and push this
   entire project to it:
   ```bash
   cd recomp-tracker-app
   git init
   git add .
   git commit -m "Recomp Tracker"
   git branch -M main
   git remote add origin https://github.com/<you>/recomp-tracker-app.git
   git push -u origin main
   ```
2. On GitHub, open the **Actions** tab. The `Build APK` workflow runs
   automatically on push — or click **Run workflow** to trigger it by hand.
3. When it finishes (green check), open the run, scroll to **Artifacts**,
   and download `recomp-tracker-debug-apk`. It's a `.zip` containing
   `app-debug.apk` — unzip it.

This is a **debug build**: unsigned for release, but installable exactly
like any other sideloaded app. Android will just label it "not from Play
Store" — expected for something you built yourself. See the bottom of this
file if you'd rather produce a signed release build.

## 3. Install it on your phone

1. Get `app-debug.apk` onto your phone (email it to yourself, AirDrop/Nearby
   Share, USB transfer, whatever's easiest, or download the Actions artifact
   directly from your phone's browser).
2. Tap the file. Android will prompt you to allow installs from that source
   the first time — approve it, then install.
3. Open **Recomp Tracker**. On first launch it asks for:
   - **Web App URL** — from step 1.9 above.
   - **Shared token** — the `SHARED_SECRET` you set in step 1.4.
4. Tap **Test & save**. It should show "Deployment reachable".
5. Under **Your sheets**, tap **+ Add a sheet** and paste your workout
   sheet's share link (Google Sheets → **Share → Copy link** is enough — the
   app only needs the file ID out of it, not edit access for whoever you
   share it with). Give it a label like "March 2026" and pick the month.
   Tap **Verify & add** — it becomes your active sheet and you're taken to
   the home screen with your weeks and days.

## How it works day to day

- **Home** shows your week tabs (`Week-1`…`Week-4`) and the day blocks on
  whichever week is selected. Tap a day to start.
- Each exercise gets its own screen — its name, prescribed sets/reps/rest
  from the sheet, a guide image, and two fields: **Actual Reps** and **Kg**.
  Back/Next move through the day; **Finish workout** writes everything to
  the matching row in that week's sheet tab.
- **Sync now** on the home screen re-reads the sheet — use it if you (or
  anyone else) edited exercises directly in Google Sheets, so the app picks
  up the changes.
- **Adding an exercise** (from the bottom of any exercise screen) inserts it
  into that same day block in *every* week tab that has it — so `Week-1`
  through `Week-4` stay in sync with each other, matching how your sheet is
  already structured.
- **Guide images**: tap the image on any exercise screen.
  - *Suggest a match* checks a bundled offline database of ~870 exercises
    (public-domain images from [free-exercise-db](https://github.com/yuhonas/free-exercise-db))
    and offers the closest name match — accept or skip it.
  - *Take a photo* / *choose from gallery* saves an image **on that phone
    only** — it won't appear on another device, since there's nowhere to
    upload it to.
  - *Paste an image link* is the one that syncs — it's saved to a hidden
    `_ExerciseLibrary` tab in your spreadsheet, so every device using this
    app sees it.
  - Your current 22 exercises already ship with a decent auto-matched image
    each (one, "Chest-Supported Machine Row", didn't have a confident match
    — you'll want to add that one yourself).
- **Offline**: if the app can't reach your sheet when you finish a workout,
  it saves the entries on your phone and syncs them automatically next time
  it can reach the internet — you'll see a banner while anything's pending.
- **Analytics** (the 📈 icon next to Settings) charts an exercise's top
  weight or estimated volume across every sheet you've added, in month
  order — pick an exercise from the dropdown to see its trend.

## Starting a new month (new spreadsheet)

Since your sheet defines a fixed 4-week block, when a cycle ends you make a
new spreadsheet for the next one from the same template. Unlike the old
one-deployment-per-sheet setup, this doesn't need touching `Code.gs` again —
just:

1. In Settings, tap **+ Add a sheet**.
2. Paste the new spreadsheet's share link, give it a label (e.g. "April
   2026") and pick its month.
3. Tap **Verify & add**. It becomes your active sheet for logging, and the
   old month's sheet stays in the list — Analytics keeps reading from all of
   them, so nothing is lost.

This only works because the deploying Google account has edit access to
every sheet you add (true automatically if you create them all yourself).
If you ever add a sheet made under a different Google account, share it with
edit access to the account that deployed `Code.gs` first.

## Testing changes without touching your real sheet

This repo includes a mock backend that behaves exactly like the real Apps
Script, seeded from your actual sheet's layout, so you can try the app (or
verify a change to `www/`) in a browser before it ever touches Google:

```bash
npm install
npm run mock
```

Then open `http://localhost:4455` in a browser, and in Settings use URL
`http://localhost:4455/exec` with token `test-token`. When adding a sheet,
paste `https://docs.google.com/spreadsheets/d/mock-sheet-1/edit` (or
`mock-sheet-2` for a second one) — the mock server seeds two fake
spreadsheets under those IDs so you can test switching sheets and Analytics
without touching Google at all.

`npm run test:parse` re-verifies the sheet-parsing logic (day-block
detection, column mapping, the "8-10 became a date" fix) against a real dump
of `Week-1` — worth re-running if you restructure your sheet's layout.

`npm run test:analytics` verifies the Analytics screen's aggregation math
(numeric coercion, rep-range midpoints, cross-sheet series building) against
a small hand-built fixture.

## Upgrading from an older single-sheet install

If you deployed this app before it supported multiple monthly sheets, two
one-time steps are needed:

1. **Redeploy `Code.gs`** — paste the latest version in, then **Deploy →
   Manage deployments → edit (pencil) → New version → Deploy**. You'll see
   Google's authorization screen again (see step 1.8 above) — that's
   expected, not a bug. The web app URL doesn't change.
2. **Reconnect in the app** — on next launch, the app will ask you to
   re-add your sheet (Settings opens automatically with a one-time banner).
   Paste the same sheet's share link you were already using; nothing on the
   sheet itself is touched, this just gives the app a durable pointer to it,
   which the old version never stored.

## Optional: a signed release build instead of debug

A debug APK is fine for personal use. If you'd rather have a properly signed
release build (e.g. to eventually publish it, or just because), you'd
generate a keystore, add it as GitHub secrets, and switch the workflow's
`assembleDebug` step to `assembleRelease` with a signing config in
`android/app/build.gradle`. That's a bigger step than most personal-use
cases need, so it's left out of the default workflow — ask if you want it
added.

## Changing the workout program itself

The app reads everything — exercises, sets, rep ranges, rest, body parts —
directly from your sheet, so most changes just need a **Sync now**. The
column headers it looks for (case-insensitive, anywhere in that block's
header row) are: `#`, `Body Part`, `Exercise`, `Sets`, a header containing
"targeted reps" or "target reps", `Rest`, `Actual Reps`, `Kg`. Keep those
recognizable and you can reorder or restyle the sheet freely.
