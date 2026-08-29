// Builds a small bundled exercise-image index from the free-exercise-db
// dataset (public domain / Unlicense) and fuzzy-matches it against the
// exercise names already in the user's sheet, so the app ships with real
// images out of the box for their current 22 exercises, plus a full index
// for matching anything they add later.
"use strict";
const fs = require("fs");

const RAW = JSON.parse(fs.readFileSync("/tmp/free-exercise-db.json", "utf8"));
const IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop parenthetical notes
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["the", "a", "an", "of", "or", "and", "with", "on"]);

function tokens(name) {
  return normalize(name)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

const INDEX = RAW.filter((ex) => ex.images && ex.images.length).map((ex) => ({
  id: ex.id,
  name: ex.name,
  tokens: tokens(ex.name),
  imageUrl: IMAGE_BASE + ex.images[0]
}));

function bestMatch(queryName) {
  const qTokens = tokens(queryName);
  const qSet = new Set(qTokens);
  let best = null;
  let bestScore = 0;

  for (const entry of INDEX) {
    const eSet = new Set(entry.tokens);
    let overlap = 0;
    qSet.forEach((t) => { if (eSet.has(t)) overlap++; });
    const union = new Set([...qSet, ...eSet]).size;
    const jaccard = union ? overlap / union : 0;

    // Bonus if the whole normalized query is a substring of the entry (or v.v.)
    const nq = normalize(queryName);
    const ne = normalize(entry.name);
    const substrBonus = ne.includes(nq) || nq.includes(ne) ? 0.25 : 0;

    const score = jaccard + substrBonus;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return { match: best, score: bestScore };
}

// ---- Test against the user's real 22 exercises ----
const USER_EXERCISES = [
  "Dumbbell Flat Bench Press",
  "Lat Pulldowns (Wide Grip)",
  "Seated Dumbbell Overhead Press",
  "Seated Cable Row (Neutral Grip",
  "Tricep Rope Pushdowns",
  "Dumbbell Bicep Curls",
  "Leg Press (or Dumbbell Goblet Squat)",
  "Dumbbell Walking Lunges",
  "Lying Leg Curls",
  "Standing Calf Raises",
  "Plank Hold",
  "Incline Dumbbell Bench Press",
  "Chest-Supported Machine Row",
  "Dumbbell Lateral Raises",
  "Cable Face Pulls",
  "Hammer Curls (Dumbbell)",
  "Overhead Cable Tricep Extension",
  "45-Degree Back Extension",
  "Leg Extension Machine",
  "Seated Leg Curls",
  "Seated Calf Raises",
  "Hanging Knee Raises"
];

const curated = {};
const reviewNeeded = [];
USER_EXERCISES.forEach((name) => {
  const { match, score } = bestMatch(name);
  const accepted = score >= 0.45;
  console.log(
    `${accepted ? "OK  " : "WEAK"}  score=${score.toFixed(2)}  "${name}"  ->  ${match ? match.name : "(none)"}`
  );
  if (accepted && match) {
    curated[name] = { imageUrl: match.imageUrl, matchedName: match.name, score: Number(score.toFixed(2)) };
  } else {
    reviewNeeded.push(name);
  }
});

console.log("\nNeeds manual review (no confident match):", reviewNeeded.length);
reviewNeeded.forEach((n) => console.log("  -", n));

// Slim index for bundling (id, name, tokens joined, imageUrl) — used for
// on-device fuzzy matching when the user adds a brand-new exercise later.
const slimIndex = INDEX.map((e) => ({ name: e.name, imageUrl: e.imageUrl }));

fs.writeFileSync(
  "/home/claude/recomp-tracker-app/www/data/exercise-index.json",
  JSON.stringify(slimIndex)
);
fs.writeFileSync(
  "/home/claude/recomp-tracker-app/www/data/curated-matches.json",
  JSON.stringify(curated, null, 2)
);

console.log(`\nWrote exercise-index.json (${slimIndex.length} entries) and curated-matches.json (${Object.keys(curated).length} entries)`);
