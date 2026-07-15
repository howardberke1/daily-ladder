// App bootstrap: theme, header, modals, stats, mode routing (daily /
// archive / practice), and deep links (?d=YYYY-MM-DD plays an archive day).

import {
  loadPuzzles, loadPractice, selectDaily, selectByDate,
  listArchive, buildPractice, todayKey, prettyDate,
} from "./puzzles.js";
import { getSettings, saveSettings, getStats, getDayState } from "./storage.js";
import { Game, toast, formatTime } from "./game.js";

const $ = (id) => document.getElementById(id);

let data = null;
let practiceBank = null;
let game = null;

/* ---------------- theme ---------------- */

function initTheme() {
  const settings = getSettings();
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = settings.theme ?? (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;

  $("btn-theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    saveSettings({ ...getSettings(), theme: next });
  });
}

/* ---------------- mode routing ---------------- */

function startGame(config) {
  game?.destroy();
  game = new Game(config);
  game.start();
}

function startDaily() {
  const daily = selectDaily(data, todayKey());
  if (!daily) {
    $("screen-loading").classList.add("hidden");
    $("screen-empty").classList.remove("hidden");
    return;
  }
  startGame({ ...daily, mode: "daily" });
}

function startArchive(dateKey) {
  const sel = selectByDate(data, dateKey);
  if (!sel) return toast("No puzzle for that date");
  startGame({ ...sel, mode: "archive" });
}

function startPractice() {
  const puzzle = buildPractice(data, practiceBank, todayKey());
  if (!puzzle) return toast("No practice questions available yet");
  startGame({ puzzle, number: 0, dateKey: `practice-${Date.now()}`, mode: "practice" });
}

/* ---------------- modals ---------------- */

function initModals() {
  $("btn-help").addEventListener("click", () => $("modal-help").showModal());
  $("btn-stats").addEventListener("click", () => { renderStats(); $("modal-stats").showModal(); });
  $("btn-see-stats").addEventListener("click", () => { renderStats(); $("modal-stats").showModal(); });
  $("btn-archive").addEventListener("click", () => { renderArchive(); $("modal-archive").showModal(); });

  document.querySelectorAll(".modal").forEach((dialog) => {
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
  });
}

function renderArchive() {
  const list = $("archive-list");
  list.innerHTML = "";
  const entries = listArchive(data, todayKey());

  if (!entries.length) {
    list.innerHTML = `<p class="muted archive-empty">No past ladders yet — today is day one. Come back tomorrow!</p>`;
    return;
  }

  entries.forEach(({ date, number }) => {
    const state = getDayState(date);
    const done = state?.stage === "done";

    const btn = document.createElement("button");
    btn.className = "archive-item";
    btn.type = "button";

    const left = document.createElement("span");
    left.className = "archive-left";
    left.innerHTML = `<strong>#${number}</strong><span class="archive-date">${prettyDate(date)}</span>`;

    const right = document.createElement("span");
    right.className = "archive-right";
    if (done) {
      const score = (state.scores ?? []).reduce((a, b) => a + (b || 0), 0) + (state.theme?.correct ? 3 : 0);
      right.innerHTML = miniGrid(state) + `<span class="archive-score">${score}/18</span>`;
    } else if (state) {
      right.innerHTML = `<span class="archive-cta">Resume</span>`;
    } else {
      right.innerHTML = `<span class="archive-cta">Play</span>`;
    }

    btn.append(left, right);
    btn.addEventListener("click", () => {
      $("modal-archive").close();
      startArchive(date);
    });
    list.appendChild(btn);
  });
}

function miniGrid(state) {
  const cells = (state.results ?? [])
    .map((r) => `<span class="mini-sq sq-${r}"></span>`)
    .join("");
  const theme = state.theme?.correct
    ? `<span class="mini-sq sq-purple"></span>`
    : `<span class="mini-sq sq-empty"></span>`;
  return `<span class="mini-grid">${cells}${theme}</span>`;
}

function renderStats() {
  const s = getStats();
  $("s-played").textContent = s.played;
  $("s-winrate").textContent = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  $("s-streak").textContent = s.currentStreak;
  $("s-maxstreak").textContent = s.maxStreak;

  $("s-fastest").textContent = s.fastestWinMs != null
    ? `Fastest full clear: ${formatTime(s.fastestWinMs)}`
    : "Fastest full clear: —";

  $("s-themes").textContent = s.played
    ? `Themes cracked: ${s.themesGuessed} of ${s.played} (${Math.round((s.themesGuessed / s.played) * 100)}%)`
    : "Themes cracked: —";

  const dist = $("s-dist");
  dist.innerHTML = "";
  const max = Math.max(1, ...s.distribution);
  s.distribution.forEach((count, rungs) => {
    const row = document.createElement("div");
    row.className = "dist-row";
    const label = document.createElement("span");
    label.textContent = rungs;
    const bar = document.createElement("div");
    bar.className = "dist-bar" + (rungs === 5 ? " hit" : "");
    bar.style.width = `${Math.max(9, (count / max) * 100)}%`;
    bar.textContent = count;
    row.append(label, bar);
    dist.appendChild(row);
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  initTheme();
  initModals();

  // header mode buttons
  $("btn-practice").addEventListener("click", () => startPractice());

  // in-game inputs (bound once; delegate to the current game)
  $("btn-guess").addEventListener("click", () => game?.guessTyped());
  $("q-input").addEventListener("keydown", (e) => { if (e.key === "Enter") game?.guessTyped(); });
  $("btn-choices").addEventListener("click", () => game?.skipToChoices());
  $("btn-b-guess").addEventListener("click", () => game?.guessTheme());
  $("b-input").addEventListener("keydown", (e) => { if (e.key === "Enter") game?.guessTheme(); });
  $("btn-b-skip").addEventListener("click", () => game?.skipTheme());

  window.addEventListener("resize", () => game?.positionClimber?.());

  // results actions
  $("btn-again").addEventListener("click", () => startPractice());
  $("btn-today").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    startDaily();
  });

  try {
    [data, practiceBank] = await Promise.all([loadPuzzles(), loadPractice()]);

    // deep link: ?d=YYYY-MM-DD opens that day's ladder
    const param = new URLSearchParams(location.search).get("d");
    if (param && /^\d{4}-\d{2}-\d{2}$/.test(param) && param <= todayKey() && selectByDate(data, param)) {
      param === todayKey() ? startDaily() : startArchive(param);
    } else {
      startDaily();
    }

    if (!localStorage.getItem("tl:seen-help") && game && game.state.stage !== "done") {
      localStorage.setItem("tl:seen-help", "1");
      $("modal-help").showModal();
    }
  } catch (err) {
    console.error(err);
    $("screen-loading").innerHTML =
      `<p class="muted">Couldn't load today's puzzle. If you opened this file directly, run a local server instead (see README) — browsers block <code>fetch()</code> from <code>file://</code> pages.</p>`;
  }
}

boot();
