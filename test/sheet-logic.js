// Shared parsing logic — a plain-JS mirror of apps-script/Code.gs, used by
// both parse_test.js (verification against the real sheet dump) and
// mock-server.js (a stand-in Apps Script backend for testing the app).
"use strict";

const DAY_TITLE_PATTERN = /^\s*Day-\s*\d+\s*:/i;
const HEADER_MAP = [
  ["actual reps", "actualReps"],
  ["targeted reps", "targetReps"],
  ["target reps", "targetReps"],
  ["#", "num"],
  ["body part", "bodyPart"],
  ["exercise", "exercise"],
  ["sets", "sets"],
  ["rest", "rest"],
  ["kg", "kg"],
  ["weight", "kg"]
];

function findFirstNonEmpty(rowVals) {
  for (let i = 0; i < rowVals.length; i++) {
    if (rowVals[i] !== "" && rowVals[i] !== null && rowVals[i] !== undefined) return rowVals[i];
  }
  return null;
}

function mapColumns(headerVals) {
  const cols = {};
  for (let i = 0; i < headerVals.length; i++) {
    const text = String(headerVals[i] || "").toLowerCase().trim();
    if (!text) continue;
    for (const [needle, key] of HEADER_MAP) {
      if (text.indexOf(needle) !== -1 && !cols[key]) {
        cols[key] = i + 1;
        break;
      }
    }
  }
  return cols;
}

function formatMaybeDate(val) {
  if (val && typeof val === "object" && val.__date__) {
    const d = new Date(val.__date__);
    return (d.getUTCMonth() + 1) + "-" + d.getUTCDate();
  }
  return val === null || val === undefined ? "" : val;
}

function readDayBlocks(values) {
  const blocks = [];
  for (let r = 0; r < values.length; r++) {
    const rowVals = values[r];
    const titleCell = findFirstNonEmpty(rowVals);
    if (titleCell && typeof titleCell === "string" && DAY_TITLE_PATTERN.test(titleCell)) {
      const titleRow = r + 1;
      const title = titleCell.trim();
      let muscleLine = "";
      if (r + 1 < values.length) {
        const mCell = findFirstNonEmpty(values[r + 1]);
        if (mCell) muscleLine = String(mCell).trim();
      }

      const headerRow = titleRow + 3;
      if (headerRow > values.length) continue;
      const headerVals = values[headerRow - 1];
      const columns = mapColumns(headerVals);
      if (!columns.exercise) continue;

      const exercises = [];
      let row = headerRow + 1;
      while (row <= values.length) {
        const rv = values[row - 1];
        const exVal = columns.exercise ? rv[columns.exercise - 1] : null;
        if (exVal === "" || exVal === null || exVal === undefined) break;
        if (typeof exVal === "string" && DAY_TITLE_PATTERN.test(exVal)) break;

        exercises.push({
          row,
          num: columns.num ? rv[columns.num - 1] : null,
          bodyPart: columns.bodyPart ? String(rv[columns.bodyPart - 1] || "") : "",
          exercise: String(exVal).trim(),
          sets: columns.sets ? rv[columns.sets - 1] : "",
          targetReps: formatMaybeDate(columns.targetReps ? rv[columns.targetReps - 1] : ""),
          rest: columns.rest ? String(rv[columns.rest - 1] || "") : "",
          actualReps: columns.actualReps ? rv[columns.actualReps - 1] : "",
          kg: columns.kg ? rv[columns.kg - 1] : ""
        });
        row++;
      }

      blocks.push({ title, muscleLine, titleRow, headerRow, columns, lastExerciseRow: row - 1, exercises });
    }
  }
  return blocks;
}

module.exports = { readDayBlocks, mapColumns, formatMaybeDate, DAY_TITLE_PATTERN };
