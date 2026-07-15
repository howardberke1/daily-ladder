// Forgiving answer matching for typed guesses.
// Handles case, punctuation, accents, leading articles, small typos
// (Levenshtein ≤ 1), and surname-only guesses for two-word names.

export function normalize(s) {
  return String(s)
    .toLowerCase()
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

/** Does a typed guess match a question's answer (or an author-listed alias)? */
export function answerMatches(guess, answer, accept = []) {
  const g = stripArticles(normalize(guess));
  if (!g) return false;

  for (const raw of [answer, ...accept]) {
    const c = stripArticles(normalize(raw));
    if (!c) continue;
    if (g === c) return true;
    // typo tolerance on reasonably long answers
    if (Math.max(g.length, c.length) >= 5 && levenshtein(g, c) <= 1) return true;
    // surname-only for two-word names: "armstrong" → "Neil Armstrong"
    const words = c.split(" ");
    if (words.length === 2 && words[1].length >= 4 && g === words[1]) return true;
  }
  return false;
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
