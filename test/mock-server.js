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

// in-memory "spreadsheet": { sheetName: 2D array }, seeded from the real dump
let sheets = JSON.parse(fs.readFileSync(path.join(__dirname, "all_weeks_dump.json"), "utf8"));
let library = {}; // exercise name -> {imageUrl, source}

const app = express();
app.use(express.text({ type: "*/*", limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "www"))); // serve the real app + its bundled data

function getStructure() {
  const weeks = Object.keys(sheets);
  const days = {};
  const allNames = new Set();
  weeks.forEach((w) => {
    const blocks = readDayBlocks(sheets[w]);
    days[w] = blocks;
    blocks.forEach((b) => b.exercises.forEach((ex) => allNames.add(ex.exercise)));
  });
  allNames.forEach((n) => { if (!library[n]) library[n] = { imageUrl: "", source: "" }; });
  return { weeks, days, exerciseLibrary: library };
}

function cell(sheetName, row, col) {
  const grid = sheets[sheetName];
  if (!grid[row - 1]) grid[row - 1] = [];
  return grid[row - 1];
}

app.post("/exec", (req, res) => {
  let body;
  try { body = JSON.parse(req.body); } catch (e) { return res.json({ ok: false, error: "bad_json" }); }

  if (body.token !== TOKEN) return res.json({ ok: false, error: "unauthorized" });

  try {
    if (body.action === "ping") {
      return res.json({ ok: true, result: { spreadsheetName: "Mock Workout Split", sheetNames: Object.keys(sheets), time: new Date().toISOString() } });
    }
    if (body.action === "getStructure") {
      return res.json({ ok: true, result: getStructure() });
    }
    if (body.action === "logSet") {
      const row = cell(body.week, body.row);
      if (body.actualRepsCol) row[body.actualRepsCol - 1] = body.actualReps === "" ? "" : body.actualReps;
      if (body.kgCol) row[body.kgCol - 1] = body.kg === "" ? "" : body.kg;
      return res.json({ ok: true, result: { saved: true } });
    }
    if (body.action === "addExercise") {
      const updatedWeeks = [];
      Object.keys(sheets).forEach((weekName) => {
        const blocks = readDayBlocks(sheets[weekName]);
        const block = blocks.find((b) => b.title === body.dayTitle);
        if (!block) return;
        const insertAt = block.lastExerciseRow; // 0-indexed insert position == lastExerciseRow (1-indexed row becomes index)
        const grid = sheets[weekName];
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
      if (body.exercise && !library[body.exercise]) library[body.exercise] = { imageUrl: "", source: "" };
      return res.json({ ok: true, result: { updatedWeeks } });
    }
    if (body.action === "updateExerciseImage") {
      library[body.exercise] = { imageUrl: body.imageUrl || "", source: body.source || "manual" };
      return res.json({ ok: true, result: { saved: true } });
    }
    return res.json({ ok: false, error: "unknown action: " + body.action });
  } catch (err) {
    return res.json({ ok: false, error: String(err.message || err) });
  }
});

// simple endpoints to help tests inspect/reset server state
app.get("/__state", (req, res) => res.json({ sheets, library }));
app.post("/__reset", (req, res) => {
  sheets = JSON.parse(fs.readFileSync(path.join(__dirname, "all_weeks_dump.json"), "utf8"));
  library = {};
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Mock Apps Script server on http://localhost:${PORT}  (POST /exec, token=${TOKEN})`));
