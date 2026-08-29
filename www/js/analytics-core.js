// Pure aggregation helpers for the Analytics screen — no DOM, no network.
// Runs in the browser (attached to window.RT.analyticsCore) and in plain
// Node for test/analytics_test.js.
(function (root) {
  "use strict";

  // Coerces a sheet cell value to a number, or null if it isn't one.
  // parseFloat tolerates trailing units ("60kg" -> 60); "bodyweight" -> null.
  function numeric(val) {
    if (val === null || val === undefined || val === "") return null;
    const n = parseFloat(val);
    return Number.isNaN(n) ? null : n;
  }

  // "8-10" -> 9 (midpoint); a plain number string just passes through.
  function parseRepRangeMidpoint(val) {
    const s = String(val === null || val === undefined ? "" : val).trim();
    const m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (m) return (parseFloat(m[1]) + parseFloat(m[2])) / 2;
    return numeric(val);
  }

  // Sorted, deduped, exact-match union of exercise names across all sheets.
  function listExerciseNames(structures) {
    const names = new Set();
    (structures || []).forEach((structure) => {
      if (!structure) return;
      Object.keys(structure.days || {}).forEach((week) => {
        (structure.days[week] || []).forEach((block) => {
          (block.exercises || []).forEach((ex) => { if (ex.exercise) names.add(ex.exercise); });
        });
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  // sheets: [{id, label, monthKey, ...}] sorted by monthKey ascending.
  // structuresById: { sheetId: structure }.
  function buildExerciseSeries(exerciseName, sheets, structuresById) {
    const ordered = (sheets || []).slice().sort((a, b) => String(a.monthKey || "").localeCompare(String(b.monthKey || "")));
    const points = [];

    ordered.forEach((sheet) => {
      const structure = structuresById[sheet.id];
      if (!structure) return;
      (structure.weeks || []).forEach((week) => {
        (structure.days[week] || []).forEach((block) => {
          (block.exercises || []).forEach((ex) => {
            if (ex.exercise !== exerciseName) return;
            const sets = numeric(ex.sets);
            const kg = numeric(ex.kg);
            const repsMid = parseRepRangeMidpoint(ex.actualReps);
            const estVolume = sets !== null && repsMid !== null && kg !== null ? sets * repsMid * kg : null;
            points.push({
              sheetId: sheet.id,
              sheetLabel: sheet.label,
              week: week,
              dayTitle: block.title,
              label: sheet.label + " · " + week,
              topWeightKg: kg,
              estVolume: estVolume,
              setsLogged: sets
            });
          });
        });
      });
    });

    return points;
  }

  function chartDataFor(series, metric) {
    return {
      labels: series.map((p) => p.label),
      datasets: [{
        label: metric === "estVolume" ? "Est. volume" : "Top weight (kg)",
        data: series.map((p) => p[metric])
      }]
    };
  }

  const api = { numeric, parseRepRangeMidpoint, listExerciseNames, buildExerciseSeries, chartDataFor };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RT = root.RT || {};
    root.RT.analyticsCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
