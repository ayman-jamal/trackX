// Stands in for the real Apps Script Web App so the Capacitor web app can be
// exercised end-to-end with Playwright before anything touches a real
// Google Sheet. Implements the exact same JSON action contract as Code.gs.
"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const { readDayBlocks } = require("./sheet-logic");

const TOKEN = "test-token";
const PORT = 4455;

function loadDump() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "all_weeks_dump.json"), "utf8"));
}

// In-memory "spreadsheets", keyed by mock sheetId (what Code.gs would treat
// as a Google Sheets file ID). Each has its own tabs + exercise library, so
// tests can exercise cross-sheet aggregation and catch write-leakage bugs.
function freshSpreadsheets() {
  return {
    "mock-sheet-1": { name: "Mock Workout Split — Month 1", sheets: loadDump(), library: {} },
    "mock-sheet-2": { name: "Mock Workout Split — Month 2", sheets: loadDump(), library: {} }
  };
}

let spreadsheets = freshSpreadsheets();

const app = express();
app.use(express.text({ type: "*/*", limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "www"))); // serve the real app + its bundled data

function getSheetOrThrow(sheetId) {
  const ss = spreadsheets[sheetId];
  if (!ss) throw new Error("Can't open that spreadsheet — check the link and make sure this script's Google account has access to it.");
  return ss;
}

function getStructure(ss) {
  const weeks = Object.keys(ss.sheets);
  const days = {};
  const allNames = new Set();
  weeks.forEach((w) => {
    const blocks = readDayBlocks(ss.sheets[w]);
    days[w] = blocks;
    blocks.forEach((b) => b.exercises.forEach((ex) => allNames.add(ex.exercise)));
  });
  allNames.forEach((n) => { if (!ss.library[n]) ss.library[n] = { imageUrl: "", source: "" }; });
  return { weeks, days, exerciseLibrary: ss.library };
}

function cell(ss, sheetName, row) {
  const grid = ss.sheets[sheetName];
  if (!grid[row - 1]) grid[row - 1] = [];
  return grid[row - 1];
}

app.post("/exec", (req, res) => {
  let body;
  try { body = JSON.parse(req.body); } catch (e) { return res.json({ ok: false, error: "bad_json" }); }

  if (body.token !== TOKEN) return res.json({ ok: false, error: "unauthorized" });

  try {
    if (body.action === "ping") {
      return res.json({ ok: true, result: { time: new Date().toISOString() } });
    }
    if (body.action === "getSpreadsheetInfo") {
      const ss = getSheetOrThrow(body.sheetId);
      const sheetNames = Object.keys(ss.sheets);
      const dayBlockCounts = {};
      sheetNames.forEach((w) => { dayBlockCounts[w] = readDayBlocks(ss.sheets[w]).length; });
      return res.json({ ok: true, result: { spreadsheetName: ss.name, sheetNames, dayBlockCounts } });
    }
    if (body.action === "getStructure") {
      const ss = getSheetOrThrow(body.sheetId);
      return res.json({ ok: true, result: getStructure(ss) });
    }
    if (body.action === "logSet") {
      const ss = getSheetOrThrow(body.sheetId);
      const row = cell(ss, body.week, body.row);
      if (body.actualRepsCol) row[body.actualRepsCol - 1] = body.actualReps === "" ? "" : body.actualReps;
      if (body.kgCol) row[body.kgCol - 1] = body.kg === "" ? "" : body.kg;
      return res.json({ ok: true, result: { saved: true } });
    }
    if (body.action === "addExercise") {
      const ss = getSheetOrThrow(body.sheetId);
      const updatedWeeks = [];
      Object.keys(ss.sheets).forEach((weekName) => {
        const blocks = readDayBlocks(ss.sheets[weekName]);
        const block = blocks.find((b) => b.title === body.dayTitle);
        if (!block) return;
        const insertAt = block.lastExerciseRow; // 0-indexed insert position == lastExerciseRow (1-indexed row becomes index)
        const grid = ss.sheets[weekName];
        const newRow = [];
        const cols = block.columns;
        const nextNum = block.exercises.length ? (Number(block.exercises[block.exercises.length - 1].num) || block.exercises.length) + 1 : 1;
        if (cols.num) newRow[cols.num - 1] = nextNum;
        if (cols.bodyPart) newRow[cols.bodyPart - 1] = body.bodyPart || "";
        if (cols.exercise) newRow[cols.exercise - 1] = body.exercise || "";
        if (cols.sets) newRow[cols.sets - 1] = body.sets || "";
        if (cols.targetReps) newRow[cols.targetReps - 1] = body.targetReps || "";
        if (cols.rest) newRow[cols.rest - 1] = body.rest || "";
        grid.splice(insertAt, 0, newRow); // insert before trailing rows, after last exercise row
        updatedWeeks.push(weekName);
      });
      if (body.exercise && !ss.library[body.exercise]) ss.library[body.exercise] = { imageUrl: "", source: "" };
      return res.json({ ok: true, result: { updatedWeeks } });
    }
    if (body.action === "updateExerciseImage") {
      const ss = getSheetOrThrow(body.sheetId);
      ss.library[body.exercise] = { imageUrl: body.imageUrl || "", source: body.source || "manual" };
      return res.json({ ok: true, result: { saved: true } });
    }
    return res.json({ ok: false, error: "unknown action: " + body.action });
  } catch (err) {
    return res.json({ ok: false, error: String(err.message || err) });
  }
});

// simple endpoints to help tests inspect/reset server state
app.get("/__state", (req, res) => res.json(spreadsheets));
app.post("/__reset", (req, res) => {
  spreadsheets = freshSpreadsheets();
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Mock Apps Script server on http://localhost:${PORT}  (POST /exec, token=${TOKEN})`));
