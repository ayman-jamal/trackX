// Manually-vetted overrides on top of the automated fuzzy match — a few of
// the automated picks were wrong (e.g. matched the wrong body part) or
// missed a much better exact entry that a smarter human eye found by
// searching the raw dataset. This produces the final curated-matches.json
// that ships in the app for the user's current 22 exercises.
"use strict";
const fs = require("fs");

const RAW = JSON.parse(fs.readFileSync("/tmp/free-exercise-db.json", "utf8"));
const IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";
const byName = {};
RAW.forEach((e) => { byName[e.name] = e; });

function img(name) {
  const e = byName[name];
  if (!e) throw new Error("Not found in dataset: " + name);
  return IMAGE_BASE + e.images[0];
}

// sheet exercise name -> dataset exercise name (verified by hand against
// the actual free-exercise-db entries, not just token-overlap scoring)
const OVERRIDES = {
  "Dumbbell Flat Bench Press": "Dumbbell Bench Press",
  "Lat Pulldowns (Wide Grip)": "Wide-Grip Lat Pulldown",
  "Seated Dumbbell Overhead Press": "Seated Dumbbell Press",
  "Seated Cable Row (Neutral Grip": "Seated Cable Rows",
  "Tricep Rope Pushdowns": "Triceps Pushdown - Rope Attachment",
  "Dumbbell Bicep Curls": "Dumbbell Bicep Curl",
  "Leg Press (or Dumbbell Goblet Squat)": "Leg Press",
  "Dumbbell Walking Lunges": "Dumbbell Lunges",
  "Lying Leg Curls": "Lying Leg Curls",
  "Standing Calf Raises": "Standing Calf Raises",
  "Plank Hold": "Plank",
  "Incline Dumbbell Bench Press": "Incline Dumbbell Press",
  // "Chest-Supported Machine Row": no confident match in the dataset — left
  // out on purpose so the app prompts the user to add their own image.
  "Dumbbell Lateral Raises": "Side Lateral Raise",
  "Cable Face Pulls": "Face Pull",
  "Hammer Curls (Dumbbell)": "Hammer Curls",
  "Overhead Cable Tricep Extension": "Cable One Arm Tricep Extension",
  "45-Degree Back Extension": "Hyperextensions (Back Extensions)",
  "Leg Extension Machine": "Leg Extensions",
  "Seated Leg Curls": "Seated Leg Curl",
  "Seated Calf Raises": "Seated Calf Raise",
  "Hanging Knee Raises": "Hanging Leg Raise"
};

const curated = {};
Object.entries(OVERRIDES).forEach(([sheetName, datasetName]) => {
  curated[sheetName] = { imageUrl: img(datasetName), matchedName: datasetName, source: "auto" };
});

fs.writeFileSync(
  "/home/claude/recomp-tracker-app/www/data/curated-matches.json",
  JSON.stringify(curated, null, 2)
);
console.log(`Wrote ${Object.keys(curated).length} curated matches (of 22 sheet exercises).`);
console.log("Left for manual add in-app: Chest-Supported Machine Row");
