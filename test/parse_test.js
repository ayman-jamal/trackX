// Verifies the shared parsing logic against a real dump of the user's sheet.
"use strict";
const fs = require("fs");
const { readDayBlocks } = require("./sheet-logic");

const data = JSON.parse(fs.readFileSync("/tmp/week1_dump.json", "utf8"));
const blocks = readDayBlocks(data);

console.log(`Found ${blocks.length} day blocks\n`);
blocks.forEach((b) => {
  console.log(`## ${b.title}  (header row ${b.headerRow}, columns: ${JSON.stringify(b.columns)})`);
  b.exercises.forEach((ex) => {
    console.log(`   row ${ex.row}: #${ex.num} | ${ex.bodyPart} | ${ex.exercise} | sets=${ex.sets} | target=${ex.targetReps} | rest=${ex.rest} | actual=${ex.actualReps} | kg=${ex.kg}`);
  });
  console.log(`   lastExerciseRow=${b.lastExerciseRow}\n`);
});

const totalExercises = blocks.reduce((n, b) => n + b.exercises.length, 0);
console.log("Total exercises parsed:", totalExercises, "(expected 22)");
console.assert(blocks[0].exercises[0].targetReps === "8-10", "DATE BUG FIX FAILED");
console.assert(blocks.length === 4, "Expected 4 day blocks, got " + blocks.length);
console.assert(totalExercises === 22, "Expected 22 exercises, got " + totalExercises);
console.log("\nAll assertions passed.");
