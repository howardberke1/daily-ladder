// Forgiving answer matching for typed guesses.
//
// Philosophy: knowing the answer should count; typing should not be the test.
// Tolerance scales with length — long answers forgive several typos, while
// very short answers (≤4 letters) must be exact, since at that size one edit
// is usually a *different word* ("Mars"/"Mans"), not a typo.
// Handles case, punctuation, accents, leading articles, transpositions, and
// surname-only (including misspelled surname) guesses for two-word names.

export function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/π/g, "pi") // symbol answers should survive normalization
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripArticles(s) {
  return s.replace(/^(the|a|an) /, "");
}

export function levenshtein(a, b) {
  // Restricted Damerau-Levenshtein: adjacent transpositions ("fier"→"fire")
  // count as a single edit, since they're the most common typo.
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prevPrev = null;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (
        prevPrev && i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
      ) {
        cur[j] = Math.min(cur[j], prevPrev[j - 2] + 1);
      }
    }
    prevPrev = prev;
    prev = cur;
  }
  return prev[n];
}

/** How many typos an answer of this length forgives. */
function maxEdits(len) {
  if (len >= 12) return 3;
  if (len >= 8) return 2;
  if (len >= 5) return 1;
  return 0; // short answers: one edit is usually a different word, not a typo
}

/**
 * Smallest edit distance from the guess to any form of a candidate:
 * its full text, or (for two-word names) its surname alone.
 */
function bestDistance(g, raw) {
  const c = stripArticles(normalize(raw));
  if (!c) return Infinity;
  let d = levenshtein(g, c);
  const words = c.split(" ");
  if (words.length === 2 && words[1].length >= 4) {
    d = Math.min(d, levenshtein(g, words[1]));
  }
  return d;
}

/**
 * Does a typed guess match a question's answer (or an author-listed alias)?
 *
 * Fuzziness is comparative: a guess counts only if it is strictly closer to
 * the right answer than to any wrong option. This is what lets "vitamn c"
 * pass while "Vitamin A" — one edit from "Vitamin C" — stays wrong, and keeps
 * "Stalagmites" from sneaking into "Stalactites". Typing a distractor is a
 * wrong answer, not a typo.
 */
export function answerMatches(guess, answer, accept = [], wrongOptions = []) {
  const g = stripArticles(normalize(guess));
  if (!g) return false;

  // exactly a wrong option → wrong, no matter how close the right answer is
  for (const w of wrongOptions) {
    if (g === stripArticles(normalize(w))) return false;
  }

  let dRight = Infinity;
  for (const raw of [answer, ...accept]) {
    const c = stripArticles(normalize(raw));
    if (!c) continue;
    if (g === c) return true; // exact (or exact alias) always counts
    dRight = Math.min(dRight, bestDistance(g, raw));
  }

  const budget = maxEdits(g.length);
  if (!budget || dRight > budget) return false;

  let dWrong = Infinity;
  for (const w of wrongOptions) dWrong = Math.min(dWrong, bestDistance(g, w));

  return dRight < dWrong;
}

/** Does a typed guess match the hidden theme (or an alias)? Looser on purpose. */
export function themeMatches(guess, theme, aliases = []) {
  const g = stripArticles(normalize(guess));
  if (!g) return false;

  for (const raw of [theme, ...aliases]) {
    const c = stripArticles(normalize(raw));
    if (!c) continue;
    if (g === c) return true; // exact always counts, even short ("7")
    if (g.length < 3) continue; // fuzzy rules need some substance
    if (Math.min(g.length, c.length) >= 4 && levenshtein(g, c) <= 1) return true;
    // containment either way for phrases: "blue" ⊆ "color blue"
    if (g.length >= 4 && (c.includes(g) || g.includes(c))) return true;
  }
  return false;
}
