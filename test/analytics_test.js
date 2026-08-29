// Verifies the pure aggregation helpers behind the Analytics screen against
// a small hand-built fixture (mirrors the shape getStructure_() returns).
"use strict";
const { numeric, parseRepRangeMidpoint, listExerciseNames, buildExerciseSeries } = require("../www/js/analytics-core");

console.assert(numeric("60") === 60, "numeric('60') should be 60");
console.assert(numeric("60kg") === 60, "numeric('60kg') should tolerate trailing units");
console.assert(numeric("") === null, "numeric('') should be null");
console.assert(numeric("bodyweight") === null, "numeric('bodyweight') should be null");
console.assert(numeric(null) === null, "numeric(null) should be null");

console.assert(parseRepRangeMidpoint("8-10") === 9, "parseRepRangeMidpoint('8-10') should be 9");
console.assert(parseRepRangeMidpoint("10") === 10, "parseRepRangeMidpoint('10') should pass through");
console.assert(parseRepRangeMidpoint("") === null, "parseRepRangeMidpoint('') should be null");

const structA = {
  weeks: ["Week 1"],
  days: { "Week 1": [{ title: "Day-1: Push", exercises: [
    { row: 5, exercise: "Bench Press", sets: "3", actualReps: "8-10", kg: "60" },
    { row: 6, exercise: "Overhead Press", sets: "3", actualReps: "10", kg: "" }
  ] }] },
  exerciseLibrary: {}
};
const structB = {
  weeks: ["Week 1"],
  days: { "Week 1": [{ title: "Day-1: Push", exercises: [
    { row: 5, exercise: "Bench Press", sets: "3", actualReps: "10", kg: "65" }
  ] }] },
  exerciseLibrary: {}
};

const sheets = [
  { id: "b", label: "Feb 2026", monthKey: "2026-02" },
  { id: "a", label: "Jan 2026", monthKey: "2026-01" } // deliberately out of order — sort must fix this
];
const structuresById = { a: structA, b: structB };

const names = listExerciseNames([structA, structB]);
console.assert(JSON.stringify(names) === JSON.stringify(["Bench Press", "Overhead Press"]), "listExerciseNames should be sorted+deduped, got " + JSON.stringify(names));

const series = buildExerciseSeries("Bench Press", sheets, structuresById);
console.assert(series.length === 2, "expected 2 points for Bench Press, got " + series.length);
console.assert(series[0].sheetId === "a" && series[1].sheetId === "b", "series should be ordered by monthKey (Jan before Feb)");
console.assert(series[0].topWeightKg === 60, "point 1 topWeightKg should be 60, got " + series[0].topWeightKg);
console.assert(series[0].estVolume === 1620, "point 1 estVolume should be 3*9*60=1620, got " + series[0].estVolume);
console.assert(series[1].topWeightKg === 65, "point 2 topWeightKg should be 65, got " + series[1].topWeightKg);
console.assert(series[1].estVolume === 1950, "point 2 estVolume should be 3*10*65=1950, got " + series[1].estVolume);

const missingKgSeries = buildExerciseSeries("Overhead Press", sheets, structuresById);
console.assert(missingKgSeries.length === 1, "expected 1 point for Overhead Press");
console.assert(missingKgSeries[0].estVolume === null, "estVolume should be null when kg is missing, got " + missingKgSeries[0].estVolume);

console.log("All analytics-core assertions passed.");
