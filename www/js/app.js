window.RT = window.RT || {};

(function () {
  "use strict";

  const storage = RT.storage;
  const api = RT.api;

  const PENDING_KEY = "rt-pending-logs";
  const LOCAL_IMAGES_KEY = "rt-local-images"; // device-only photos, never synced
  const SHEETS_KEY = "rt-sheets"; // [{id, label, monthKey, url, addedAt}]
  const ACTIVE_SHEET_KEY = "rt-active-sheet-id";
  function cacheKeyFor(sheetId) { return "rt-structure-cache:" + sheetId; }

  let state = {
    screen: "loading",
    structure: null,
    activeWeek: null,
    session: null, // {dayIndex, exIndex, entries: [{actualReps, kg}]}
    imageSheetFor: null, // exercise name currently showing the image-options sheet
    addExerciseFor: null, // dayTitle currently showing the add-exercise sheet
    connection: "unknown",
    sheets: [], // saved monthly sheets — see SHEETS_KEY
    activeSheetId: null, // which sheet home/session/finish read & write
    forceReconnect: false, // true when there's no active sheet yet and Settings must not be left
    analyticsData: {}, // sheetId -> structure, populated by loadAnalyticsData()
    analyticsExercise: null,
    analyticsMetric: "topWeightKg", // or "estVolume"
    analyticsChart: null, // live Chart.js instance
    analyticsRefreshed: null // {ok, total} — background-refresh status note
  };

  let localImages = {};

  const app = document.getElementById("app");

  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ============ Boot ============ */

  async function boot() {
    RT.config = await storage.getJSON("rt-config", null);
    localImages = await storage.getJSON(LOCAL_IMAGES_KEY, {});
    state.sheets = await storage.getJSON(SHEETS_KEY, []);
    state.activeSheetId = await storage.get(ACTIVE_SHEET_KEY);

    if (!RT.config || !RT.config.url || !RT.config.token) {
      state.screen = "settings";
      render();
      return;
    }

    if (!state.sheets.length || !state.activeSheetId) {
      // Upgrading from the old single-sheet model (or a fresh install with a
      // deployment already configured) — there's no spreadsheet ID to
      // recover automatically, so ask once, same as adding any sheet.
      state.forceReconnect = true;
      state.screen = "settings";
      render();
      return;
    }

    const cached = await storage.getJSON(cacheKeyFor(state.activeSheetId), null);
    if (cached) {
      state.structure = cached;
      state.activeWeek = cached.weeks[0];
    }

    state.screen = "home";
    render();
    syncNow(true);
  }

  async function syncNow(silent) {
    try {
      const structure = await api.getStructure(state.activeSheetId);
      state.structure = structure;
      if (!state.activeWeek || structure.weeks.indexOf(state.activeWeek) === -1) {
        state.activeWeek = structure.weeks[0];
      }
      await storage.setJSON(cacheKeyFor(state.activeSheetId), structure);
      state.connection = "online";
      await flushPending();
      await applyCuratedDefaults();
    } catch (e) {
      state.connection = e.code === "not_configured" ? "unconfigured" : "offline";
      if (!silent) showToast("Couldn't reach your sheet — " + describeError(e));
    }
    if (state.screen === "home" || state.screen === "settings") render();
  }

  let curatedDefaultsPromise = null;
  function loadCurated() {
    if (!curatedDefaultsPromise) {
      curatedDefaultsPromise = fetch("data/curated-matches.json").then((r) => r.json()).catch(() => ({}));
    }
    return curatedDefaultsPromise;
  }

  // On first sync, exercises that already exist in the bundled free-exercise-db
  // curated list (the user's original 22, matched by hand — see
  // scripts/curate-matches.js) get their guide image filled in automatically,
  // since "auto-match" was the chosen behavior. Anything already set (by the
  // user or a previous run) is left alone.
  async function applyCuratedDefaults() {
    if (!state.structure) return;
    const curated = await loadCurated();
    const lib = state.structure.exerciseLibrary || (state.structure.exerciseLibrary = {});
    const toApply = Object.keys(lib).filter((name) => !lib[name].imageUrl && curated[name]);
    if (!toApply.length) return;

    for (const name of toApply) {
      const c = curated[name];
      lib[name] = { imageUrl: c.imageUrl, source: "auto" };
      try { await api.updateExerciseImage({ sheetId: state.activeSheetId, exercise: name, imageUrl: c.imageUrl, source: "auto" }); } catch (e) { /* will retry next sync */ }
    }
    await storage.setJSON(cacheKeyFor(state.activeSheetId), state.structure);
  }

  function describeError(e) {
    if (e.code === "unauthorized") return "check your token in Settings";
    if (e.code === "not_configured") return "not configured yet";
    return "check your connection";
  }

  /* ============ Pending write queue (offline safety net) ============ */

  async function loadPending() { return storage.getJSON(PENDING_KEY, []); }
  async function savePending(list) { return storage.setJSON(PENDING_KEY, list); }

  async function queueLogSet(entry) {
    const pending = await loadPending();
    pending.push(entry);
    await savePending(pending);
  }

  async function flushPending() {
    let pending = await loadPending();
    if (!pending.length) return;
    const remaining = [];
    for (const entry of pending) {
      entry.sheetId = entry.sheetId || state.activeSheetId;
      try { await api.logSet(entry); } catch (e) { remaining.push(entry); }
    }
    await savePending(remaining);
  }

  /* ============ Rendering shell ============ */

  function render() {
    if (state.screen === "loading") return renderLoading();
    if (state.screen === "settings") return renderSettings();
    if (state.screen === "home") return renderHome();
    if (state.screen === "session") return renderSession();
    if (state.screen === "finish") return renderFinish();
    if (state.screen === "analytics") return renderAnalytics();
  }

  function renderLoading() {
    app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80vh;color:var(--text-tertiary);"><span class="spinner"></span>&nbsp; Loading…</div>';
  }

  function topbar(opts) {
    opts = opts || {};
    let html = '<div class="topbar">';
    if (opts.back) {
      html += `<button class="icon-btn" id="btn-back-top">← ${opts.back}</button>`;
    } else {
      html += '<div class="brand"><span class="mark">Recomp<span class="dot">.</span>Tracker</span></div>';
    }
    html += '<div class="topbar-actions">';
    if (opts.showAnalytics !== false) html += '<button class="icon-btn" id="btn-analytics">📈</button>';
    if (opts.showSettings !== false) html += '<button class="icon-btn" id="btn-settings">⚙</button>';
    html += '</div></div>';
    return html;
  }

  function wireTopbar(onBack) {
    const back = document.getElementById("btn-back-top");
    if (back && onBack) back.onclick = onBack;
    const settingsBtn = document.getElementById("btn-settings");
    if (settingsBtn) settingsBtn.onclick = () => { state.screen = "settings"; render(); };
    const analyticsBtn = document.getElementById("btn-analytics");
    if (analyticsBtn) analyticsBtn.onclick = () => { state.screen = "analytics"; render(); loadAnalyticsData(); };
  }

  /* ============ Settings ============ */

  function renderSettings() {
    const cfg = RT.config || { url: "", token: "" };
    const canLeave = !state.forceReconnect && state.structure;
    let html = topbar({ back: canLeave ? "Home" : null, showSettings: false, showAnalytics: false });

    if (state.forceReconnect) {
      html += '<div class="home-lead"><h1>Reconnect your sheet</h1><p>This app now supports one sheet per month. Paste your current sheet\'s share link below once to keep syncing — nothing on the sheet itself changes.</p></div>';
    } else {
      html += '<div class="home-lead"><h1>Settings</h1><p>Connect to your Apps Script deployment, then manage which monthly sheets it can read and write.</p></div>';
    }

    html += '<div class="settings-section"><h2>Backend connection</h2>';
    html += '<div class="form-field"><label>Web App URL</label><input type="url" id="cfg-url" placeholder="https://script.google.com/macros/s/.../exec" value="' + escapeAttr(cfg.url) + '"></div>';
    html += '<div class="form-field"><label>Shared token</label><input type="text" id="cfg-token" placeholder="the SHARED_SECRET from Code.gs" value="' + escapeAttr(cfg.token) + '"></div>';
    html += '<button class="btn btn-primary btn-block" id="btn-test">Test &amp; save</button>';
    html += '<div id="settings-status" style="margin-top:0.9rem;"></div>';
    html += '</div>';

    html += '<div class="settings-section"><h2>Your sheets</h2>';
    if (!state.sheets.length) {
      html += '<div class="empty-state">No sheets added yet — add your first one below.</div>';
    } else {
      html += '<div class="sheet-list">';
      state.sheets.forEach((s) => {
        const isActive = s.id === state.activeSheetId;
        html += `<div class="sheet-row ${isActive ? "active" : ""}">
          <div class="sheet-row-main">
            <div class="sheet-row-label">${escapeHtml(s.label)}</div>
            <div class="sheet-row-hint">${escapeHtml(s.monthKey || "")}</div>
          </div>
          ${isActive
            ? '<span class="status-pill ok"><span class="dot"></span> Active</span>'
            : `<button class="btn btn-small btn-secondary" data-set-active="${escapeAttr(s.id)}">Make active</button>`}
          <button class="icon-btn" data-remove-sheet="${escapeAttr(s.id)}">✕</button>
        </div>`;
      });
      html += '</div>';
    }
    html += '<button class="btn btn-ghost btn-block" id="btn-add-sheet" style="margin-top:0.8rem;">+ Add a sheet</button>';
    html += '</div>';

    app.innerHTML = html;
    wireTopbar(canLeave ? () => { state.screen = "home"; render(); } : null);

    document.getElementById("btn-test").onclick = async () => {
      const url = document.getElementById("cfg-url").value.trim();
      const token = document.getElementById("cfg-token").value.trim();
      const statusEl = document.getElementById("settings-status");
      statusEl.innerHTML = '<span class="status-pill"><span class="spinner"></span> Testing…</span>';

      RT.config = { url, token };
      try {
        await api.ping();
        await storage.setJSON("rt-config", RT.config);
        statusEl.innerHTML = '<span class="status-pill ok"><span class="dot"></span> Deployment reachable</span>';
        showToast("Saved");
      } catch (e) {
        statusEl.innerHTML = `<span class="status-pill bad"><span class="dot"></span> ${escapeHtml(describeError(e))}</span>`;
      }
    };

    app.querySelectorAll("[data-set-active]").forEach((el) => {
      el.onclick = async () => { await setActiveSheet(el.getAttribute("data-set-active")); render(); showToast("Active sheet changed"); };
    });
    app.querySelectorAll("[data-remove-sheet]").forEach((el) => {
      el.onclick = () => removeSheet(el.getAttribute("data-remove-sheet"));
    });
    document.getElementById("btn-add-sheet").onclick = openAddSheetSheet;
  }

  async function setActiveSheet(id) {
    state.activeSheetId = id;
    await storage.set(ACTIVE_SHEET_KEY, id);
    const cached = await storage.getJSON(cacheKeyFor(id), null);
    state.structure = cached || null;
    state.activeWeek = cached ? cached.weeks[0] : null;
    state.forceReconnect = false;
    await syncNow(true);
  }

  async function removeSheet(id) {
    if (!confirm("Remove this sheet from the app? Your Google Sheet itself is untouched — this only stops tracking it here.")) return;
    state.sheets = state.sheets.filter((s) => s.id !== id);
    await storage.setJSON(SHEETS_KEY, state.sheets);
    await storage.set(cacheKeyFor(id), "");
    if (state.activeSheetId === id) {
      if (state.sheets.length) {
        await setActiveSheet(state.sheets[0].id);
      } else {
        state.activeSheetId = null;
        await storage.set(ACTIVE_SHEET_KEY, "");
        state.structure = null;
        state.forceReconnect = true;
      }
    }
    render();
  }

  function extractSheetId(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
  }

  function openAddSheetSheet() {
    closeSheet();
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.id = "sheet-backdrop";
    const defaultMonth = new Date().toISOString().slice(0, 7);
    wrap.innerHTML = `<div class="sheet">
      <h2>Add a sheet</h2>
      <div class="form-field"><label>Share link</label><input type="url" id="new-sheet-link" placeholder="https://docs.google.com/spreadsheets/d/.../edit"></div>
      <div class="form-field"><label>Label</label><input type="text" id="new-sheet-label" placeholder="e.g. March 2026"></div>
      <div class="form-field"><label>Month</label><input type="month" id="new-sheet-month" value="${defaultMonth}"></div>
      <div id="add-sheet-status" style="margin-bottom:0.8rem;"></div>
      <button class="btn btn-primary btn-block" id="opt-validate-sheet">Verify &amp; add</button>
      <button class="btn btn-ghost btn-block sheet-close" id="opt-close-sheet">Cancel</button>
    </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeSheet(); });
    document.getElementById("opt-close-sheet").onclick = closeSheet;

    document.getElementById("opt-validate-sheet").onclick = async () => {
      const link = document.getElementById("new-sheet-link").value.trim();
      const label = document.getElementById("new-sheet-label").value.trim();
      const monthKey = document.getElementById("new-sheet-month").value;
      const statusEl = document.getElementById("add-sheet-status");
      const id = extractSheetId(link);
      if (!id) { statusEl.innerHTML = '<span class="status-pill bad"><span class="dot"></span> Couldn\'t find a spreadsheet ID in that link</span>'; return; }

      const btn = document.getElementById("opt-validate-sheet");
      btn.innerHTML = '<span class="spinner"></span> Verifying…';
      try {
        const info = await api.getSpreadsheetInfo(id);
        const totalBlocks = Object.keys(info.dayBlockCounts || {}).reduce((sum, w) => sum + info.dayBlockCounts[w], 0);
        if (totalBlocks === 0) {
          statusEl.innerHTML = '<span class="status-pill bad"><span class="dot"></span> No "Day-N:" blocks found — added anyway, double check the sheet layout</span>';
        }
        state.sheets.push({ id, label: label || info.spreadsheetName, monthKey, url: link, addedAt: new Date().toISOString() });
        await storage.setJSON(SHEETS_KEY, state.sheets);
        if (state.sheets.length === 1 || !state.activeSheetId) await setActiveSheet(id);
        closeSheet();
        showToast("Sheet added");
        render();
      } catch (e) {
        btn.innerHTML = "Verify &amp; add";
        statusEl.innerHTML = `<span class="status-pill bad"><span class="dot"></span> ${escapeHtml(describeError(e))}</span>`;
      }
    };
  }

  /* ============ Home ============ */

  function renderHome() {
    let html = topbar({});

    if (state.connection === "offline") {
      html += '<div class="conn-banner"><span>Can’t reach your sheet — showing cached data.</span><button id="btn-retry">Retry</button></div>';
    }

    const activeSheet = state.sheets.find((s) => s.id === state.activeSheetId);
    html += '<div class="home-lead"><h1>What are you training today?</h1><p>Pick a week, then a day, to start logging.</p>';
    if (activeSheet) html += `<p class="settings-hint">Logging to: <b>${escapeHtml(activeSheet.label)}</b></p>`;
    html += '</div>';

    if (!state.structure) {
      html += '<div class="empty-state">Not synced yet. Pull to retry or check Settings.</div>';
      app.innerHTML = html;
      wireTopbar();
      const retry = document.getElementById("btn-retry");
      if (retry) retry.onclick = () => syncNow(false);
      return;
    }

    html += '<div class="week-tabs">';
    state.structure.weeks.forEach((w) => {
      html += `<button class="week-tab ${w === state.activeWeek ? "active" : ""}" data-week="${escapeAttr(w)}">${escapeHtml(w)}</button>`;
    });
    html += '</div>';

    const blocks = (state.structure.days[state.activeWeek] || []);
    html += '<div class="day-list">';
    if (!blocks.length) {
      html += '<div class="empty-state">No day blocks found on this sheet tab.</div>';
    }
    blocks.forEach((b, idx) => {
      html += `<button class="day-card" data-day-idx="${idx}">
        <div class="dc-main">
          <div class="dc-title">${escapeHtml(b.title)}</div>
          <div class="dc-muscles">${escapeHtml(b.muscleLine)}</div>
        </div>
        <span class="dc-count">${b.exercises.length} ex</span>
      </button>`;
    });
    html += '</div>';

    html += '<button class="btn btn-secondary btn-block" id="btn-sync">' + (state.connection === "online" ? "Synced ✓ — refresh" : "Sync now") + '</button>';

    app.innerHTML = html;
    wireTopbar();

    app.querySelectorAll(".week-tab").forEach((el) => {
      el.onclick = () => { state.activeWeek = el.getAttribute("data-week"); render(); };
    });
    app.querySelectorAll(".day-card").forEach((el) => {
      el.onclick = () => startSession(Number(el.getAttribute("data-day-idx")));
    });
    const syncBtn = document.getElementById("btn-sync");
    if (syncBtn) syncBtn.onclick = async () => { syncBtn.innerHTML = '<span class="spinner"></span> Syncing…'; await syncNow(false); render(); showToast("Synced"); };
    const retry = document.getElementById("btn-retry");
    if (retry) retry.onclick = () => syncNow(false);
  }

  /* ============ Session (exercise-by-exercise entry) ============ */

  function startSession(dayIndex) {
    const block = state.structure.days[state.activeWeek][dayIndex];
    state.session = {
      dayIndex,
      exIndex: 0,
      entries: block.exercises.map((ex) => ({
        actualReps: ex.actualReps === null || ex.actualReps === undefined ? "" : String(ex.actualReps),
        kg: ex.kg === null || ex.kg === undefined ? "" : String(ex.kg)
      }))
    };
    state.screen = "session";
    render();
  }

  function currentBlock() { return state.structure.days[state.activeWeek][state.session.dayIndex]; }

  function imageFor(exerciseName) {
    if (localImages[exerciseName]) return { url: localImages[exerciseName], local: true };
    const lib = state.structure.exerciseLibrary || {};
    if (lib[exerciseName] && lib[exerciseName].imageUrl) return { url: lib[exerciseName].imageUrl, local: false };
    return null;
  }

  function renderSession() {
    const block = currentBlock();
    const i = state.session.exIndex;
    const ex = block.exercises[i];
    const entry = state.session.entries[i];
    const isLast = i === block.exercises.length - 1;
    const img = imageFor(ex.exercise);

    let html = topbar({ back: block.title });

    html += '<div class="progress-track">';
    block.exercises.forEach((_, idx) => {
      const cls = idx < i ? "done" : (idx === i ? "current" : "");
      html += `<div class="seg ${cls}"></div>`;
    });
    html += '</div>';

    html += `<div class="session-meta"><span class="day-tag">${escapeHtml(block.title)}</span><span class="count">${i + 1} / ${block.exercises.length}</span></div>`;

    html += '<div class="exercise-card">';
    html += '<div class="ex-image-wrap" id="ex-image-wrap">';
    if (img) {
      html += `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(ex.exercise)}">`;
    } else {
      html += '<div class="ex-image-placeholder"><span class="icon">🏋️</span><span>No guide image yet</span></div>';
    }
    html += '<button class="ex-image-edit-btn" id="btn-edit-image">🖼 ' + (img ? "Change" : "Add image") + '</button>';
    html += '</div>';

    html += '<div class="ex-body">';
    html += `<h1>${escapeHtml(ex.exercise)}</h1>`;
    if (ex.bodyPart) html += `<div class="body-part">${escapeHtml(ex.bodyPart)}</div>`;
    html += `<div class="prescribed">Prescribed: ${escapeHtml(String(ex.sets || "—"))} sets × ${escapeHtml(String(ex.targetReps || "—"))} · rest ${escapeHtml(String(ex.rest || "—"))}</div>`;

    html += '<div class="field-grid">';
    html += field("actualReps", "Actual Reps", entry.actualReps, "numeric");
    html += field("kg", "Kg", entry.kg, "text");
    html += '</div>';
    html += '<div class="field-hint">Leave a field blank to skip it — it won’t overwrite what’s already in the sheet.</div>';
    html += '</div></div>';

    html += '<div class="session-nav">';
    html += `<button class="btn btn-ghost" id="btn-prev" ${i === 0 ? "disabled" : ""}>Back</button>`;
    html += `<button class="btn btn-primary" id="btn-next">${isLast ? "Finish workout" : "Next exercise →"}</button>`;
    html += '</div>';

    html += '<button class="btn btn-ghost btn-block" id="btn-add-exercise" style="margin-top:0.9rem;">+ Add another exercise to this day</button>';

    app.innerHTML = html;

    document.getElementById("btn-settings").onclick = () => { state.screen = "settings"; render(); };
    document.getElementById("btn-analytics").onclick = () => { state.screen = "analytics"; render(); loadAnalyticsData(); };
    document.getElementById("btn-back-top").onclick = () => confirmLeave();

    ["actualReps", "kg"].forEach((key) => {
      const input = document.getElementById("input-" + key);
      input.addEventListener("input", () => { state.session.entries[i][key] = input.value; });
    });

    document.getElementById("btn-edit-image").onclick = () => openImageSheet(ex.exercise);
    document.getElementById("btn-add-exercise").onclick = () => openAddExerciseSheet(block.title);

    document.getElementById("btn-prev").onclick = () => { if (i > 0) { state.session.exIndex = i - 1; render(); } };
    document.getElementById("btn-next").onclick = () => { if (isLast) finishWorkout(); else { state.session.exIndex = i + 1; render(); } };
  }

  function confirmLeave() {
    if (confirm("Leave this workout? Anything not saved yet will be lost.")) { state.session = null; state.screen = "home"; render(); }
  }

  function field(key, label, value, mode) {
    return `<div class="field"><label>${label}</label><div class="stepper">
      <button type="button" data-adj="-1" data-key="${key}">−</button>
      <input type="text" inputmode="${mode}" id="input-${key}" value="${escapeAttr(value)}" placeholder="—">
      <button type="button" data-adj="1" data-key="${key}">+</button>
      </div></div>`;
  }

  // Delegate stepper +/- clicks once (buttons are re-rendered each time, so
  // re-bind is cheap and avoids leaking listeners).
  app.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-adj]");
    if (!btn) return;
    const key = btn.getAttribute("data-key");
    const input = document.getElementById("input-" + key);
    if (!input) return;
    const cur = parseFloat(input.value) || 0;
    const next = Math.round((cur + Number(btn.getAttribute("data-adj"))) * 100) / 100;
    input.value = next < 0 ? 0 : next;
    input.dispatchEvent(new Event("input"));
  });

  async function finishWorkout() {
    const block = currentBlock();
    const weekName = state.activeWeek;
    const results = block.exercises.map((ex, idx) => ({
      exercise: ex.exercise,
      actualReps: state.session.entries[idx].actualReps,
      kg: state.session.entries[idx].kg,
      row: ex.row
    }));

    state.screen = "finish";
    state.finishSummary = { dayTitle: block.title, results };
    state.finishSaving = true;
    render();

    const cols = block.columns;
    let allOk = true;
    for (const r of results) {
      const hasReps = r.actualReps !== "" && r.actualReps !== null && r.actualReps !== undefined;
      const hasKg = r.kg !== "" && r.kg !== null && r.kg !== undefined;
      if (!hasReps && !hasKg) continue; // nothing entered for this exercise — skip
      const payload = {
        sheetId: state.activeSheetId,
        week: weekName, row: r.row,
        actualRepsCol: cols.actualReps, kgCol: cols.kg,
        actualReps: hasReps ? r.actualReps : "", kg: hasKg ? r.kg : ""
      };
      try {
        await api.logSet(payload);
      } catch (e) {
        allOk = false;
        await queueLogSet(payload);
      }
    }

    // reflect what we just wrote into the cached structure so Home shows it
    // immediately, even before the next full sync
    results.forEach((r) => {
      const ex = block.exercises.find((e) => e.row === r.row);
      if (ex) {
        if (r.actualReps !== "") ex.actualReps = r.actualReps;
        if (r.kg !== "") ex.kg = r.kg;
      }
    });
    await storage.setJSON(cacheKeyFor(state.activeSheetId), state.structure);

    state.finishSaving = false;
    state.finishOk = allOk;
    render();
  }

  function renderFinish() {
    const s = state.finishSummary;
    let html = topbar({});
    html += '<div class="finish-badge">✓</div>';
    html += `<h1 style="font-size:1.5rem;">${escapeHtml(s.dayTitle)} logged</h1>`;

    if (state.finishSaving) {
      html += '<p class="save-note"><span class="spinner"></span> Saving to your sheet…</p>';
    } else if (state.finishOk) {
      html += '<p class="save-note">Saved to your sheet.</p>';
    } else {
      html += '<p class="save-note warn">Sheet unreachable for some entries — queued, will sync automatically.</p>';
    }

    html += '<table class="summary-table"><thead><tr><th>Exercise</th><th>Reps</th><th>Kg</th></tr></thead><tbody>';
    s.results.forEach((r) => {
      html += `<tr><td>${escapeHtml(r.exercise)}</td><td class="num">${escapeHtml(r.actualReps || "—")}</td><td class="num">${escapeHtml(r.kg || "—")}</td></tr>`;
    });
    html += '</tbody></table>';

    html += '<button class="btn btn-primary btn-block" id="btn-home">Back to home</button>';

    app.innerHTML = html;
    document.getElementById("btn-settings").onclick = () => { state.screen = "settings"; render(); };
    document.getElementById("btn-analytics").onclick = () => { state.screen = "analytics"; render(); loadAnalyticsData(); };
    document.getElementById("btn-home").onclick = () => { state.session = null; state.screen = "home"; render(); };
  }

  /* ============ Analytics ============ */

  async function loadAnalyticsData() {
    for (const s of state.sheets) {
      const cached = await storage.getJSON(cacheKeyFor(s.id), null);
      if (cached) state.analyticsData[s.id] = cached;
    }
    if (state.screen === "analytics") render();

    const results = await Promise.allSettled(state.sheets.map((s) => api.getStructure(s.id)));
    let ok = 0;
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        ok++;
        const s = state.sheets[idx];
        state.analyticsData[s.id] = r.value;
        storage.setJSON(cacheKeyFor(s.id), r.value);
      }
    });
    state.analyticsRefreshed = { ok: ok, total: state.sheets.length };
    if (state.screen === "analytics") render();
  }

  function renderAnalytics() {
    let html = topbar({ back: "Home", showAnalytics: false });
    html += '<div class="home-lead"><h1>Analytics</h1><p>Track an exercise\'s trend across your saved sheets.</p></div>';

    if (!state.sheets.length) {
      html += '<div class="empty-state">Add a sheet in Settings to see analytics.</div>';
      app.innerHTML = html;
      wireTopbar(() => { state.screen = "home"; render(); });
      return;
    }

    const structures = state.sheets.map((s) => state.analyticsData[s.id]).filter(Boolean);
    const names = RT.analyticsCore.listExerciseNames(structures);

    if (!names.length) {
      html += '<div class="empty-state">No exercise data cached yet — this fills in as your sheets sync.</div>';
      app.innerHTML = html;
      wireTopbar(() => { state.screen = "home"; render(); });
      return;
    }

    if (!state.analyticsExercise || names.indexOf(state.analyticsExercise) === -1) state.analyticsExercise = names[0];

    html += '<div class="form-field"><label>Exercise</label><select id="analytics-exercise">';
    names.forEach((n) => { html += `<option value="${escapeAttr(n)}" ${n === state.analyticsExercise ? "selected" : ""}>${escapeHtml(n)}</option>`; });
    html += '</select></div>';

    html += '<div class="week-tabs">';
    html += `<button class="week-tab ${state.analyticsMetric === "topWeightKg" ? "active" : ""}" data-metric="topWeightKg">Top weight</button>`;
    html += `<button class="week-tab ${state.analyticsMetric === "estVolume" ? "active" : ""}" data-metric="estVolume">Est. volume</button>`;
    html += '</div>';

    const series = RT.analyticsCore.buildExerciseSeries(state.analyticsExercise, state.sheets, state.analyticsData);

    if (!series.length) {
      html += '<div class="empty-state">No logged data for this exercise yet.</div>';
    } else {
      html += '<div class="chart-wrap"><canvas id="analytics-chart"></canvas></div>';
      html += '<table class="summary-table"><thead><tr><th>When</th><th>Top weight</th><th>Volume</th><th>Sets</th></tr></thead><tbody>';
      series.forEach((p) => {
        html += `<tr><td>${escapeHtml(p.label)}</td><td class="num">${p.topWeightKg === null ? "—" : p.topWeightKg}</td><td class="num">${p.estVolume === null ? "—" : Math.round(p.estVolume)}</td><td class="num">${p.setsLogged === null ? "—" : p.setsLogged}</td></tr>`;
      });
      html += '</tbody></table>';
    }

    if (state.analyticsRefreshed && state.analyticsRefreshed.ok < state.analyticsRefreshed.total) {
      html += `<p class="settings-hint">${state.analyticsRefreshed.ok} of ${state.analyticsRefreshed.total} sheets refreshed — showing cached data for the rest.</p>`;
    }

    app.innerHTML = html;
    wireTopbar(() => { state.screen = "home"; render(); });

    document.getElementById("analytics-exercise").onchange = (e) => { state.analyticsExercise = e.target.value; render(); };
    app.querySelectorAll("[data-metric]").forEach((el) => {
      el.onclick = () => { state.analyticsMetric = el.getAttribute("data-metric"); render(); };
    });

    if (series.length) drawAnalyticsChart(series);
  }

  function drawAnalyticsChart(series) {
    const canvas = document.getElementById("analytics-chart");
    if (!canvas || typeof Chart === "undefined") return;
    if (state.analyticsChart) { state.analyticsChart.destroy(); state.analyticsChart = null; }
    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue("--text-secondary").trim();
    const gridColor = styles.getPropertyValue("--border").trim();
    const accent = styles.getPropertyValue("--accent").trim();
    const data = RT.analyticsCore.chartDataFor(series, state.analyticsMetric);
    state.analyticsChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [{
          label: data.datasets[0].label, data: data.datasets[0].data,
          borderColor: accent, backgroundColor: accent, tension: 0.25, spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: textColor }, grid: { color: gridColor } },
          y: { ticks: { color: textColor }, grid: { color: gridColor } }
        }
      }
    });
  }

  /* ============ Image picker sheet ============ */

  function openImageSheet(exerciseName) {
    state.imageSheetFor = exerciseName;
    renderImageSheet();
  }

  function closeSheet() {
    const backdrop = document.getElementById("sheet-backdrop");
    if (backdrop) backdrop.remove();
  }

  async function renderImageSheet() {
    closeSheet();
    const name = state.imageSheetFor;
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.id = "sheet-backdrop";
    wrap.innerHTML = `<div class="sheet">
      <h2>Guide image — ${escapeHtml(name)}</h2>
      <button class="sheet-option" id="opt-suggest"><span class="icon">✨</span> Suggest a match</button>
      <button class="sheet-option" id="opt-camera"><span class="icon">📷</span> Take a photo (this phone only)</button>
      <button class="sheet-option" id="opt-gallery"><span class="icon">🖼</span> Choose from gallery (this phone only)</button>
      <button class="sheet-option" id="opt-url"><span class="icon">🔗</span> Paste an image link (syncs to sheet)</button>
      <button class="btn btn-ghost btn-block sheet-close" id="opt-close">Cancel</button>
    </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeSheet(); });

    document.getElementById("opt-close").onclick = closeSheet;

    document.getElementById("opt-suggest").onclick = async () => {
      showToast("Searching…");
      const match = await RT.match.suggest(name);
      closeSheet();
      if (match) {
        if (confirm(`Use this match?\n\n"${match.matchedName}" (confidence ${(match.score * 100).toFixed(0)}%)`)) {
          await saveExerciseImage(name, match.imageUrl, "auto");
        }
      } else {
        showToast("No confident match found — try a photo or a link instead");
      }
    };

    document.getElementById("opt-url").onclick = async () => {
      closeSheet();
      const url = prompt("Paste an image or GIF URL:");
      if (url && url.trim()) await saveExerciseImage(name, url.trim(), "manual");
    };

    document.getElementById("opt-camera").onclick = () => pickFromDevice(name, "camera");
    document.getElementById("opt-gallery").onclick = () => pickFromDevice(name, "gallery");
  }

  async function pickFromDevice(exerciseName, source) {
    closeSheet();
    const Camera = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
    if (!Camera) { showToast("Camera isn't available here"); return; }
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        resultType: "dataUrl",
        source: source === "camera" ? "CAMERA" : "PHOTOS"
      });
      localImages[exerciseName] = photo.dataUrl;
      await storage.setJSON(LOCAL_IMAGES_KEY, localImages);
      showToast("Saved on this phone");
      if (state.screen === "session") render();
    } catch (e) {
      // user cancelled the picker — not an error worth surfacing
    }
  }

  async function saveExerciseImage(exerciseName, imageUrl, source) {
    // optimistic local update
    const lib = state.structure.exerciseLibrary || (state.structure.exerciseLibrary = {});
    lib[exerciseName] = { imageUrl, source };
    await storage.setJSON(cacheKeyFor(state.activeSheetId), state.structure);
    if (state.screen === "session") render();

    try {
      await api.updateExerciseImage({ sheetId: state.activeSheetId, exercise: exerciseName, imageUrl, source });
      showToast("Image saved to your sheet");
    } catch (e) {
      showToast("Saved here — will sync to the sheet later");
    }
  }

  /* ============ Add exercise sheet ============ */

  function openAddExerciseSheet(dayTitle) {
    closeSheet();
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.id = "sheet-backdrop";
    wrap.innerHTML = `<div class="sheet">
      <h2>Add exercise — ${escapeHtml(dayTitle)}</h2>
      <div class="form-field"><label>Exercise name</label><input type="text" id="new-ex-name" placeholder="e.g. Cable Chest Fly"></div>
      <div class="form-field"><label>Body part</label><input type="text" id="new-ex-bodypart" placeholder="e.g. Chest"></div>
      <div class="form-field"><label>Sets</label><input type="text" id="new-ex-sets" placeholder="3"></div>
      <div class="form-field"><label>Target reps</label><input type="text" id="new-ex-target" placeholder="e.g. 8-10"></div>
      <div class="form-field"><label>Rest</label><input type="text" id="new-ex-rest" placeholder="e.g. 90s"></div>
      <p class="settings-hint">This is added to <b>${escapeHtml(dayTitle)}</b> in every week sheet that has this day, so your program stays consistent.</p>
      <button class="btn btn-primary btn-block" id="opt-save-exercise">Add to sheet</button>
      <button class="btn btn-ghost btn-block sheet-close" id="opt-close-add">Cancel</button>
    </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeSheet(); });
    document.getElementById("opt-close-add").onclick = closeSheet;

    document.getElementById("opt-save-exercise").onclick = async () => {
      const name = document.getElementById("new-ex-name").value.trim();
      if (!name) { showToast("Give it a name first"); return; }
      const payload = {
        sheetId: state.activeSheetId,
        dayTitle,
        exercise: name,
        bodyPart: document.getElementById("new-ex-bodypart").value.trim(),
        sets: document.getElementById("new-ex-sets").value.trim(),
        targetReps: document.getElementById("new-ex-target").value.trim(),
        rest: document.getElementById("new-ex-rest").value.trim()
      };
      const btn = document.getElementById("opt-save-exercise");
      btn.innerHTML = '<span class="spinner"></span> Adding…';
      try {
        await api.addExercise(payload);
        closeSheet();
        showToast("Added — syncing…");
        await syncNow(true);
        // restart the session on this same day block with the fresh exercise list
        const idx = (state.structure.days[state.activeWeek] || []).findIndex((b) => b.title === dayTitle);
        if (idx !== -1) startSession(idx); else { state.screen = "home"; render(); }
      } catch (e) {
        btn.innerHTML = "Add to sheet";
        showToast("Couldn't save — " + describeError(e));
      }
    };
  }

  /* ============ Helpers ============ */

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

  document.addEventListener("DOMContentLoaded", boot);
})();
