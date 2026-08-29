// Fuzzy-matches an exercise name against the bundled free-exercise-db index
// (www/data/exercise-index.json) so new exercises the user adds can get a
// suggested guide image without any network call.
window.RT = window.RT || {};

(function () {
  "use strict";

  const STOPWORDS = new Set(["the", "a", "an", "of", "or", "and", "with", "on"]);
  let indexPromise = null;

  function normalize(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(name) {
    return normalize(name).split(" ").filter((t) => t && !STOPWORDS.has(t));
  }

  async function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch("data/exercise-index.json")
        .then((r) => r.json())
        .then((list) => list.map((e) => ({ name: e.name, imageUrl: e.imageUrl, tokens: tokens(e.name) })))
        .catch(() => []);
    }
    return indexPromise;
  }

  async function suggest(name, minScore) {
    const index = await loadIndex();
    const qTokens = tokens(name);
    const qSet = new Set(qTokens);
    const nq = normalize(name);
    let best = null;
    let bestScore = 0;

    for (const entry of index) {
      const eSet = new Set(entry.tokens);
      let overlap = 0;
      qSet.forEach((t) => { if (eSet.has(t)) overlap++; });
      const union = new Set([...qSet, ...eSet]).size;
      const jaccard = union ? overlap / union : 0;
      const ne = normalize(entry.name);
      const substrBonus = ne.includes(nq) || nq.includes(ne) ? 0.25 : 0;
      const score = jaccard + substrBonus;
      if (score > bestScore) { bestScore = score; best = entry; }
    }

    if (best && bestScore >= (minScore === undefined ? 0.45 : minScore)) {
      return { imageUrl: best.imageUrl, matchedName: best.name, score: bestScore };
    }
    return null;
  }

  window.RT.match = { suggest };
})();
