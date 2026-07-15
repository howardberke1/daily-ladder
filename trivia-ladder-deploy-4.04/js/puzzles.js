// Loads puzzle data and picks puzzles by date.
// Daily = the player's local calendar date. Archive = any earlier dated
// puzzle. Practice = a random ladder assembled from the practice bank plus
// questions from already-published days (never future days, no spoilers).

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(fromKey, toKey) {
  const a = new Date(`${fromKey}T12:00:00Z`);
  const b = new Date(`${toKey}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export async function loadPuzzles() {
  const res = await fetch("data/puzzles.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load puzzles.json (${res.status})`);
  return res.json();
}

export async function loadPractice() {
  try {
    const res = await fetch("data/practice.json", { cache: "no-cache" });
    if (!res.ok) return { questions: [] };
    return res.json();
  } catch {
    return { questions: [] };
  }
}

/** Ladder number shown in shares: #1 = startDate. */
export function numberFor(data, dateKey) {
  const origin = data.startDate ?? data.puzzles?.[0]?.date;
  return Math.max(1, daysBetween(origin, dateKey) + 1);
}

/** Returns { puzzle, number, dateKey } or null if the pool is empty. */
export function selectDaily(data, dateKey = todayKey()) {
  const puzzles = data?.puzzles ?? [];
  if (!puzzles.length) return null;

  const number = numberFor(data, dateKey);
  const exact = puzzles.find((p) => p.date === dateKey);
  if (exact) return { puzzle: exact, number, dateKey };

  // Fallback: deterministic rotation keeps the game playable on any date.
  const idx = ((number - 1) % puzzles.length + puzzles.length) % puzzles.length;
  return { puzzle: puzzles[idx], number, dateKey, fallback: true };
}

/** Dated puzzle for a specific archive date, or null. */
export function selectByDate(data, dateKey) {
  const p = (data?.puzzles ?? []).find((x) => x.date === dateKey);
  return p ? { puzzle: p, number: numberFor(data, dateKey), dateKey } : null;
}

/** Past days (strictly before today), newest first. */
export function listArchive(data, today = todayKey()) {
  return (data?.puzzles ?? [])
    .filter((p) => p.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({ date: p.date, number: numberFor(data, p.date), puzzle: p }));
}

/**
 * Random practice ladder: one question per difficulty 1–5, drawn from the
 * practice bank + all questions from puzzles dated today or earlier.
 */
export function buildPractice(data, practice, today = todayKey()) {
  const pool = [
    ...(practice?.questions ?? []),
    ...(data?.puzzles ?? [])
      .filter((p) => p.date <= today)
      .flatMap((p) => p.questions),
  ];
  const questions = [];
  for (let d = 1; d <= 5; d++) {
    const candidates = pool.filter((q) => q.difficulty === d);
    const from = candidates.length ? candidates : pool;
    if (!from.length) return null;
    const pick = from[Math.floor(Math.random() * from.length)];
    questions.push(pick);
  }
  return { theme: null, themeAnswers: [], themeBlurb: "", questions };
}

export function msUntilMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next - now;
}

export function prettyDate(dateKey) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
