// All persistence lives here.
//   tl:settings        — theme preference
//   tl:day:<date>      — per-date game state (daily + archive replays)
//   tl:stats           — lifetime stats (daily games only)

const KEY_SETTINGS = "tl:settings";
const KEY_STATS = "tl:stats";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — game still works, just won't persist */
  }
}

/* ---------------- settings ---------------- */

export function getSettings() {
  return read(KEY_SETTINGS, { theme: null });
}

export function saveSettings(settings) {
  write(KEY_SETTINGS, settings);
}

/* ---------------- per-date game state ---------------- */

export function getDayState(dateKey) {
  return read(`tl:day:${dateKey}`, null);
}

export function saveDayState(state) {
  write(`tl:day:${state.dateKey}`, state);
}

/* ---------------- lifetime stats (daily only) ---------------- */

const EMPTY_STATS = {
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastWinDate: null,
  lastPlayedDate: null,
  themesGuessed: 0,
  fastestWinMs: null,
  // distribution[n] = games where the player cleared exactly n rungs (0–5)
  distribution: [0, 0, 0, 0, 0, 0],
};

export function getStats() {
  return { ...EMPTY_STATS, ...read(KEY_STATS, {}) };
}

/**
 * Record a finished DAILY game. Archive replays and practice rounds don't
 * touch stats or streaks. A "win" = all 5 rungs cleared; streak = consecutive
 * calendar days with a win.
 */
export function recordResult(dateKey, rungsCleared, themeCorrect = false, timeMs = null) {
  const stats = getStats();
  if (stats.lastPlayedDate === dateKey) return stats; // already recorded

  stats.played += 1;
  stats.lastPlayedDate = dateKey;
  if (themeCorrect) stats.themesGuessed += 1;
  stats.distribution[Math.min(5, Math.max(0, rungsCleared))] += 1;

  const won = rungsCleared === 5;
  if (won) {
    stats.wins += 1;
    if (timeMs != null && (stats.fastestWinMs == null || timeMs < stats.fastestWinMs)) {
      stats.fastestWinMs = timeMs;
    }
    stats.currentStreak = isYesterday(stats.lastWinDate, dateKey)
      ? stats.currentStreak + 1
      : 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    stats.lastWinDate = dateKey;
  } else {
    stats.currentStreak = 0;
  }

  write(KEY_STATS, stats);
  return stats;
}

function isYesterday(prevKey, todayKey) {
  if (!prevKey) return false;
  const a = new Date(`${prevKey}T12:00:00Z`);
  const b = new Date(`${todayKey}T12:00:00Z`);
  return Math.round((b - a) / 86400000) === 1;
}
