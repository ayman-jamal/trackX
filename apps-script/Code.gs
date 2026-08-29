/**
 * Recomp Tracker — Apps Script backend
 * ------------------------------------
 * Bind this script to your workout Google Sheet (Extensions > Apps Script),
 * paste this file in, set SHARED_SECRET below, then deploy as a Web App.
 * Full instructions are in SETUP.md.
 *
 * This script never needs any Google Cloud project, OAuth client, or API key —
 * it runs as an extension of your own spreadsheet and acts with your own
 * Google account's permissions. The only thing protecting it from strangers
 * is the shared-secret token below, so keep the deployment URL private and
 * change the secret from the default.
 */
// ---------------------------------------------------------------------------
// CONFIG — change this before deploying.
// ---------------------------------------------------------------------------
var SHARED_SECRET = "change-me-to-a-long-random-string";

var LIBRARY_SHEET_NAME = "_ExerciseLibrary";
var DAY_TITLE_PATTERN = /^\s*Day-\s*\d+\s*:/i;

// Header text -> logical field name. Matching is case-insensitive substring,
// checked in this order, so put more specific patterns first.
var HEADER_MAP = [
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

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doGet(e) {
  return handle_(e);
}

function doPost(e) {
  return handle_(e);
}

function handle_(e) {
  var out;
  try {
    var params = parseParams_(e);
    if (params.token !== SHARED_SECRET) {
      out = { ok: false, error: "unauthorized" };
    } else {
      var action = params.action;
      if (action === "ping") out = { ok: true, result: ping_() };
      else if (action === "getSpreadsheetInfo") out = { ok: true, result: getSpreadsheetInfo_(params) };
      else if (action === "getStructure") out = { ok: true, result: getStructure_(params) };
      else if (action === "logSet") out = { ok: true, result: logSet_(params) };
      else if (action === "addExercise") out = { ok: true, result: addExercise_(params) };
      else if (action === "updateExerciseImage") out = { ok: true, result: updateExerciseImage_(params) };
      else out = { ok: false, error: "unknown action: " + action };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function parseParams_(e) {
  if (e && e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch (err) { /* fall through */ }
  }
  return (e && e.parameter) || {};
}

// ---------------------------------------------------------------------------
// Spreadsheet resolution — each request names the sheet it wants via
// sheetId, so one deployment can serve any number of the user's own
// monthly spreadsheets instead of being bound to a single one.
// ---------------------------------------------------------------------------

function getSpreadsheet_(rawId) {
  if (!rawId) throw new Error("Missing sheetId");
  var id = extractSheetId_(String(rawId));
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error("Can't open that spreadsheet — check the link and make sure this script's Google account has access to it.");
  }
}

// Accepts either a bare spreadsheet ID or a full share URL. Canonical
// extraction happens client-side (Settings); this is a defensive fallback.
function extractSheetId_(raw) {
  var m = raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : raw.trim();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function ping_() {
  return { time: new Date().toISOString() };
}

function getSpreadsheetInfo_(p) {
  var ss = getSpreadsheet_(p.sheetId);
  var weekSheets = ss.getSheets().filter(function (s) { return s.getName() !== LIBRARY_SHEET_NAME; });
  var dayBlockCounts = {};
  weekSheets.forEach(function (s) { dayBlockCounts[s.getName()] = readDayBlocks_(s).length; });
  return {
    spreadsheetName: ss.getName(),
    sheetNames: weekSheets.map(function (s) { return s.getName(); }),
    dayBlockCounts: dayBlockCounts
  };
}

function getStructure_(p) {
  var ss = getSpreadsheet_(p.sheetId);
  var weekSheets = ss.getSheets().filter(function (s) { return s.getName() !== LIBRARY_SHEET_NAME; });

  var weeks = [];
  var days = {};
  var allExerciseNames = {};

  weekSheets.forEach(function (sheet) {
    var weekName = sheet.getName();
    weeks.push(weekName);
    var blocks = readDayBlocks_(sheet);
    days[weekName] = blocks;
    blocks.forEach(function (block) {
      block.exercises.forEach(function (ex) {
        if (ex.exercise) allExerciseNames[ex.exercise] = true;
      });
    });
  });

  var library = readLibrary_(ss);
  // Make sure every exercise seen in the week sheets has a library entry
  // (blank image) so the app always has something to show/edit against.
  var libraryChanged = false;
  Object.keys(allExerciseNames).forEach(function (name) {
    if (!library[name]) {
      library[name] = { imageUrl: "", source: "" };
      libraryChanged = true;
    }
  });
  if (libraryChanged) writeLibrary_(ss, library);

  return { weeks: weeks, days: days, exerciseLibrary: library };
}

/** Finds each "Day-N: ..." block in a sheet and reads its exercise rows. */
function readDayBlocks_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 10);
  if (lastRow < 1) return [];

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var blocks = [];

  for (var r = 0; r < values.length; r++) {
    var rowVals = values[r];
    var titleCell = findFirstNonEmpty_(rowVals);
    if (titleCell && DAY_TITLE_PATTERN.test(String(titleCell))) {
      var titleRow = r + 1; // 1-indexed
      var title = String(titleCell).trim();
      var muscleLine = "";
      if (r + 1 < values.length) {
        var mCell = findFirstNonEmpty_(values[r + 1]);
        if (mCell) muscleLine = String(mCell).trim();
      }

      var headerRow = titleRow + 3;
      if (headerRow > values.length) continue;
      var headerVals = values[headerRow - 1];
      var columns = mapColumns_(headerVals);
      if (!columns.exercise) continue; // couldn't find an Exercise column, skip

      var exercises = [];
      var row = headerRow + 1;
      while (row <= values.length) {
        var rv = values[row - 1];
        var exVal = columns.exercise ? rv[columns.exercise - 1] : null;
        if (exVal === "" || exVal === null || exVal === undefined) break;
        var bpVal = columns.bodyPart ? rv[columns.bodyPart - 1] : "";
        if (DAY_TITLE_PATTERN.test(String(exVal))) break; // safety: hit next block

        exercises.push({
          row: row,
          num: columns.num ? rv[columns.num - 1] : null,
          bodyPart: bpVal ? String(bpVal) : "",
          exercise: String(exVal).trim(),
          sets: columns.sets ? rv[columns.sets - 1] : "",
          targetReps: formatMaybeDate_(columns.targetReps ? rv[columns.targetReps - 1] : ""),
          rest: columns.rest ? String(rv[columns.rest - 1] || "") : "",
          actualReps: columns.actualReps ? rv[columns.actualReps - 1] : "",
          kg: columns.kg ? rv[columns.kg - 1] : ""
        });
        row++;
      }

      blocks.push({
        title: title,
        muscleLine: muscleLine,
        titleRow: titleRow,
        headerRow: headerRow,
        columns: columns,
        lastExerciseRow: row - 1,
        exercises: exercises
      });
    }
  }
  return blocks;
}

function findFirstNonEmpty_(rowVals) {
  for (var i = 0; i < rowVals.length; i++) {
    if (rowVals[i] !== "" && rowVals[i] !== null && rowVals[i] !== undefined) return rowVals[i];
  }
  return null;
}

function mapColumns_(headerVals) {
  var cols = {};
  for (var i = 0; i < headerVals.length; i++) {
    var text = String(headerVals[i] || "").toLowerCase().trim();
    if (!text) continue;
    for (var m = 0; m < HEADER_MAP.length; m++) {
      if (text.indexOf(HEADER_MAP[m][0]) !== -1 && !cols[HEADER_MAP[m][1]]) {
        cols[HEADER_MAP[m][1]] = i + 1; // 1-indexed column
        break;
      }
    }
  }
  return cols;
}

/**
 * Google Sheets loves to silently convert things like "8-10" typed into a
 * cell into an actual date (Aug 10). We can't undo that at the data level,
 * but we CAN detect it and format it back to the "8-10" shape the user
 * originally meant, using month-day.
 */
function formatMaybeDate_(val) {
  if (Object.prototype.toString.call(val) === "[object Date]") {
    var m = val.getMonth() + 1;
    var d = val.getDate();
    return m + "-" + d;
  }
  return val === null || val === undefined ? "" : val;
}

function logSet_(p) {
  var ss = getSpreadsheet_(p.sheetId);
  var sheet = ss.getSheetByName(p.week);
  if (!sheet) throw new Error("Unknown week sheet: " + p.week);
  var row = Number(p.row);
  if (!row) throw new Error("Missing/invalid row");

  if (p.actualRepsCol) sheet.getRange(row, Number(p.actualRepsCol)).setValue(p.actualReps === "" ? "" : p.actualReps);
  if (p.kgCol) sheet.getRange(row, Number(p.kgCol)).setValue(p.kg === "" ? "" : p.kg);

  return { saved: true };
}

/**
 * Adds a new exercise row to the matching day-block (matched by exact title
 * text) in every week sheet that has that block — keeping the program
 * consistent across weeks. Sheets without a matching block are skipped.
 */
function addExercise_(p) {
  var ss = getSpreadsheet_(p.sheetId);
  var weekSheets = ss.getSheets().filter(function (s) { return s.getName() !== LIBRARY_SHEET_NAME; });
  var updatedWeeks = [];

  weekSheets.forEach(function (sheet) {
    var blocks = readDayBlocks_(sheet);
    var block = blocks.filter(function (b) { return b.title === p.dayTitle; })[0];
    if (!block) return;

    var insertAt = block.lastExerciseRow + 1;
    sheet.insertRowBefore(insertAt);

    var cols = block.columns;
    var nextNum = block.exercises.length
      ? (Number(block.exercises[block.exercises.length - 1].num) || block.exercises.length) + 1
      : 1;

    if (cols.num) sheet.getRange(insertAt, cols.num).setValue(nextNum);
    if (cols.bodyPart) sheet.getRange(insertAt, cols.bodyPart).setValue(p.bodyPart || "");
    if (cols.exercise) sheet.getRange(insertAt, cols.exercise).setValue(p.exercise || "");
    if (cols.sets) sheet.getRange(insertAt, cols.sets).setValue(p.sets || "");
    if (cols.targetReps) sheet.getRange(insertAt, cols.targetReps).setNumberFormat("@").setValue(p.targetReps || "");
    if (cols.rest) sheet.getRange(insertAt, cols.rest).setValue(p.rest || "");

    updatedWeeks.push(sheet.getName());
  });

  if (p.exercise) {
    var library = readLibrary_(ss);
    if (!library[p.exercise]) {
      library[p.exercise] = { imageUrl: p.imageUrl || "", source: p.imageUrl ? (p.imageSource || "manual") : "" };
      writeLibrary_(ss, library);
    }
  }

  return { updatedWeeks: updatedWeeks };
}

// ---------------------------------------------------------------------------
// Exercise image library (its own sheet, one row per unique exercise name)
// ---------------------------------------------------------------------------

function getLibrarySheet_(ss) {
  var sheet = ss.getSheetByName(LIBRARY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LIBRARY_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([["Exercise", "Image URL", "Source", "Updated At"]]);
    sheet.hideSheet();
  }
  return sheet;
}

function readLibrary_(ss) {
  var sheet = getLibrarySheet_(ss);
  var lastRow = sheet.getLastRow();
  var library = {};
  if (lastRow < 2) return library;
  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  values.forEach(function (row) {
    var name = row[0];
    if (!name) return;
    library[String(name)] = { imageUrl: row[1] || "", source: row[2] || "" };
  });
  return library;
}

function writeLibrary_(ss, library) {
  var sheet = getLibrarySheet_(ss);
  var names = Object.keys(library);
  var rows = names.map(function (name) {
    var entry = library[name];
    return [name, entry.imageUrl || "", entry.source || "", new Date()];
  });
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, 4).setValues(rows);
}

function updateExerciseImage_(p) {
  if (!p.exercise) throw new Error("Missing exercise name");
  var ss = getSpreadsheet_(p.sheetId);
  var library = readLibrary_(ss);
  library[p.exercise] = { imageUrl: p.imageUrl || "", source: p.source || "manual" };
  writeLibrary_(ss, library);
  return { saved: true };
}
