// Game state machine + DOM rendering.
//
// Modes:
//   daily    — today's puzzle; saved per-date; counts toward stats & streaks
//   archive  — a past dated puzzle; saved per-date; does NOT touch stats
//   practice — random questions, no theme, nothing saved or counted
//
// Scoring: every rung starts worth 3 points. Wrong guess (typed or clicked)
// −1; revealing the 4 choices −1 (floor 1). Reach 0 → rung missed.
// Daily/archive: bonus rung = one typed theme guess for +3 (max 18).

import { getDayState, saveDayState, recordResult } from "./storage.js";
import { buildShareText, share } from "./share.js";
import { msUntilMidnight, prettyDate } from "./puzzles.js";
import { answerMatches, themeMatches } from "./match.js";
import { track, scoreBand } from "./analytics.js";
import { worldFor, randomWorld, renderWorld } from "./worlds.js";

const START_POINTS = 3;
const THEME_BONUS = 3;
// How far you actually climb for a given rung score. This is the heart of the
// "meaningful climb": a typed answer surges you two full segments, a lucky
// guess from the choices barely gets you moving, and a miss means you slip and
// scrabble back to almost where you started. Five perfect rungs = the summit.
const ALT_GAIN = { 3: 2.0, 2: 1.4, 1: 0.9, 0: 0.4 };
const SUMMIT_UNITS = 5 * ALT_GAIN[3];   // 10 — only a flawless climb tops out
const METERS_PER_UNIT = 200;            // perfect climb = 2000 m
const BONUS_UNITS = 1.2;                // the theme rung nudges you over the lip

/**
 * Special recurring days. A puzzle opts in with `"tag": "brainrot"` in
 * puzzles.json — the badge, styling and help copy follow automatically, so
 * adding a new themed day later is a data change plus one entry here.
 */
const TAGS = {
  brainrot: {
    label: "Brain Rot Friday",
    blurb: "Internet culture, meme lore, and the slang your nephew won't explain.",
  },
};

const $ = (id) => document.getElementById(id);

export class Game {
  constructor({ puzzle, number, dateKey, mode = "daily" }) {
    this.puzzle = puzzle;
    this.number = number;
    this.dateKey = dateKey;
    this.mode = mode;
    this.persistent = mode !== "practice";

    const saved = this.persistent ? getDayState(dateKey) : null;
    this.state = saved ?? {
      dateKey,
      number,
      stage: "play",            // "play" → "bonus" → "done"
      current: 0,
      typedDone: false,         // used (and missed) the typed guess
      skipped: false,           // skipped typing straight to choices
      choicesShown: false,
      results: [],              // "green" | "yellow" | "gray"
      scores: [],               // 0–3
      theme: { guessed: false, correct: false, guess: "" },
      startedAt: Date.now(),
      timeMs: null,
      recorded: false,
    };

    this.locked = false;
    this.world = mode === "practice" ? randomWorld() : worldFor(number);
  }

  /* ---------------- lifecycle ---------------- */

  start() {
    this.renderModeBanner();

    // Only count a start once per climb, and never for an already-finished day
    // (revisiting your results shouldn't inflate the funnel).
    if (this.state.stage !== "done" && !this._startTracked) {
      this._startTracked = true;
      track("climb_start", {
        mode: this.mode,
        world: this.world.id,
        tag: this.puzzle.tag ?? "standard",
        resumed: this.state.current > 0 ? "yes" : "no",
      });
    }

    if (this.state.stage === "done") {
      this.showResults({ animateReveal: false });
    } else if (this.state.stage === "bonus") {
      this.showBonus();
    } else {
      this.setScreen("screen-play");
      this.setPhase("play");
      this.renderQuestion();
    }
  }

  setPhase(phase) {
    const stage = document.getElementById("climb-stage");
    if (stage) {
      stage.dataset.phase = phase;
      stage.dataset.world = this.world.id;
    }
    const qp = document.getElementById("q-panel");
    const bp = document.getElementById("bonus-panel");
    if (qp) qp.classList.toggle("hidden", phase !== "play");
    if (bp) bp.classList.toggle("hidden", phase !== "bonus");
  }

  destroy() {
    clearInterval(this._countdown);
    clearInterval(this._weather);
    clearInterval(this._altTween);
  }

  save() {
    if (this.persistent) saveDayState(this.state);
  }

  setScreen(id) {
    ["screen-loading", "screen-play", "screen-results", "screen-empty"]
      .forEach((s) => $(s).classList.toggle("hidden", s !== id));
  }

  showResults({ animateReveal }) {
    clearInterval(this._weather);
    this.setScreen("screen-results");
    this.renderResults(animateReveal);
  }

  renderModeBanner() {
    const el = $("mode-banner");
    const tag = this.mode === "practice" ? null : TAGS[this.puzzle.tag];

    // The tag badge sits above the mode banner and outranks it — on a themed
    // day that's the headline, whether you're playing it live or from archive.
    const badge = $("tag-badge");
    if (badge) {
      badge.classList.toggle("hidden", !tag);
      if (tag) {
        badge.textContent = tag.label;
        badge.dataset.tag = this.puzzle.tag;
      }
    }
    const stage = document.getElementById("climb-stage");
    if (stage) {
      if (tag) stage.dataset.tag = this.puzzle.tag;
      else delete stage.dataset.tag;
    }

    if (this.mode === "archive") {
      el.textContent = `Archive · #${this.number} · ${prettyDate(this.dateKey)} — doesn't affect streaks`;
      el.classList.remove("hidden");
    } else if (this.mode === "practice") {
      el.textContent = "Practice — random questions, nothing counts";
      el.classList.remove("hidden");
    } else if (tag) {
      el.textContent = tag.blurb;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }

  /* ---------------- play rendering ---------------- */

  renderQuestion() {
    const q = this.puzzle.questions[this.state.current];

    $("q-category").textContent = q.category;
    $("q-text").textContent = q.question;
    $("q-feedback").textContent = "";
    $("q-feedback").className = "q-feedback";
    $("btn-next").classList.add("hidden");

    const input = $("q-input");
    input.value = "";
    input.disabled = false;
    $("btn-guess").disabled = false;
    $("answer-box").classList.toggle("hidden", this.state.choicesShown);

    $("btn-choices").classList.toggle("hidden", this.state.choicesShown);
    $("q-options").classList.toggle("hidden", !this.state.choicesShown);
    if (this.state.choicesShown) this.renderOptions(q);

    this.renderPoints();
    this.renderLadder();

    // Refresh-proofing: rung already completed but not advanced.
    if (this.state.results[this.state.current]) {
      this.lockRung();
      $("q-feedback").textContent = "Rung complete.";
      $("q-feedback").classList.add("good");
      this.offerNext();
    } else {
      this.locked = false;
      input.focus({ preventScroll: true });
    }
  }

  renderOptions(q) {
    const wrap = $("q-options");
    wrap.innerHTML = "";
    q.options.forEach((text, i) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.type = "button";
      btn.textContent = text;
      btn.dataset.index = i;
      btn.addEventListener("click", () => this.guessOption(i, btn));
      wrap.appendChild(btn);
    });
  }

  renderPoints() {
    const wrap = $("q-points");
    wrap.innerHTML = "";
    const typedSpent = this.state.typedDone || this.state.skipped;
    [typedSpent, false].forEach((spent) => {
      const dot = document.createElement("span");
      dot.className = "guess-dot" + (spent ? " spent" : "");
      wrap.appendChild(dot);
    });
    const pts = this.potential();
    $("q-worth").textContent = `worth ${pts} pt${pts === 1 ? "" : "s"}`;
  }

    /* ---------------- the climb ---------------- */

  /** Altitude in segments after rung `i` (inclusive). Undone rungs count 0. */
  unitsAfter(i) {
    let u = 0;
    for (let k = 0; k <= i; k++) {
      const score = this.state.scores[k];
      if (score == null) break;
      u += ALT_GAIN[score] ?? 0;
    }
    return u;
  }

  /** Where the climber currently is, in segments. */
  currentUnits() {
    const answered = this.state.results.filter(Boolean).length;
    let u = this.unitsAfter(answered - 1);
    if (this.state.stage !== "play" && this.state.theme.correct) u += BONUS_UNITS;
    return u;
  }

  /** 0–1. Falls as you miss rungs; drives weather and the grip meter. */
  gripLevel() {
    const answered = this.state.results.filter(Boolean).length;
    if (!answered) return 1;
    const earned = this.state.scores.slice(0, answered).reduce((a, b) => a + (b ?? 0), 0);
    return Math.max(0.12, earned / (answered * 3));
  }

  /** Paint the world: sky gradient + four parallax scenery layers. */
  mountScenery() {
    const skyHost = $("w-sky");
    const sceneHost = $("w-scenery");
    if (!skyHost || !sceneHost) return;
    if (sceneHost.dataset.world === this.world.id) return; // already painted

    const seed = this.mode === "practice" ? Date.now() % 9973 : this.number;
    const { sky, layers } = renderWorld(this.world, seed);

    skyHost.innerHTML = sky;
    sceneHost.innerHTML = layers
      .map((l, i) => `<div class="w-layer w-layer-${i + 1}" style="--depth:${l.depth}">${l.svg}</div>`)
      .join("");
    sceneHost.dataset.world = this.world.id;
  }

  renderLadder() {
    const stage = document.getElementById("climb-stage");
    const world = document.getElementById("world");

    const completed = this.state.results.filter(Boolean).length;
    const done = this.state.stage === "done";
    const atSummit = done || this.state.stage === "bonus";
    const progress = atSummit ? 6 : completed;

    if (stage) {
      stage.dataset.world = this.world.id;
      stage.dataset.progress = String(Math.min(6, progress));
    }
    this.mountScenery();

    // Camera + geometry. The camera tracks *altitude*, not question count —
    // climb badly and the summit stays stubbornly out of reach.
    if (stage && world && typeof stage.getBoundingClientRect === "function") {
      const h = stage.getBoundingClientRect().height || 600;
      const seg = Math.max(150, Math.min(h * 0.4, 380));
      const gh = Math.round(h * 0.31);
      stage.style.setProperty("--seg", `${seg}px`);
      stage.style.setProperty("--gh", `${gh}px`);
      stage.style.setProperty("--summit-units", String(SUMMIT_UNITS));

      const cam = this.currentUnits() * seg;
      world.style.setProperty("--cam", `${cam}px`);
      stage.style.setProperty("--shift", `${cam}px`);
    }

    // Rungs sit at the altitude you actually reached, so the ladder itself
    // records the run: tight cluster = a slog, big gaps = a strong climb.
    document.querySelectorAll(".w-rung").forEach((el) => {
      const idx = Number(el.dataset.rung) - 1;
      el.classList.remove("green", "yellow", "gray", "active", "cracked");
      const result = this.state.results[idx];
      const units = result ? this.unitsAfter(idx) : this.unitsAfter(idx - 1) + ALT_GAIN[3];
      el.style.setProperty("--rung-units", String(units));
      if (result) {
        el.classList.add(result);
        if (result === "gray") el.classList.add("cracked"); // splintered where you fell
      } else if (idx === this.state.current && this.state.stage === "play") {
        el.classList.add("active");
      }
      el.classList.toggle("pending", !result);
    });

    const cap = document.querySelector(".rung-cap");
    if (cap) {
      cap.classList.toggle("hidden", this.mode === "practice");
      cap.classList.remove("purple", "gray", "active");
      if (this.state.stage === "bonus") cap.classList.add("active");
      else if (done && this.mode !== "practice") {
        if (this.state.theme.correct) cap.classList.add("purple");
        else if (this.state.theme.guessed) cap.classList.add("gray");
      }
    }

    this.animateAltitude(Math.round(this.currentUnits() * METERS_PER_UNIT));
    this.updateWeather(progress);
    this.renderGrip();
    this.animateClimb();
  }

  renderGrip() {
    const fill = $("grip-fill");
    const wrap = $("grip");
    if (!fill || !wrap) return;
    const g = this.gripLevel();
    fill.style.height = `${Math.round(g * 100)}%`;
    wrap.classList.toggle("hidden", this.state.stage === "done" || this.mode === "practice");
    wrap.dataset.level = g > 0.7 ? "strong" : g > 0.4 ? "slipping" : "failing";
  }

  /** Kept as the public "relayout" hook (main.js calls it on resize). */
  positionClimber() {
    this.renderLadder();
  }

  animateClimb() {
    const climber = document.getElementById("climber");
    if (!climber || !climber.classList) return;
    climber.classList.remove("moving");
    if (typeof climber.offsetWidth === "number") void climber.offsetWidth;
    climber.classList.add("moving");
    if (climber.addEventListener) {
      climber.addEventListener("animationend", () => climber.classList.remove("moving"), { once: true });
    }
  }

  animateAltitude(target) {
    const el = document.getElementById("altitude-num");
    if (!el) return;
    clearInterval(this._altTween);
    const from = parseInt(el.textContent?.replace(/\D/g, "") || "0", 10) || 0;
    if (from === target) { el.textContent = String(target); return; }
    const steps = 24;
    let i = 0;
    this._altTween = setInterval(() => {
      i++;
      const v = Math.round(from + (target - from) * (i / steps));
      el.textContent = String(v);
      if (i >= steps) clearInterval(this._altTween);
    }, 34);
  }

  /**
   * Weather answers to performance. Climb clean and the sky settles; keep
   * missing and it closes in on you. Height still thickens it, but a strong
   * climber gets a kinder mountain.
   */
  updateWeather(progress) {
    const host = $("w-particles");
    if (!host || !host.appendChild) return;
    clearInterval(this._weather);
    host.innerHTML = "";

    const grip = this.gripLevel();
    const struggle = 1 - grip;                       // 0 = flawless, 1 = falling apart
    const height = Math.min(1, progress / 6);
    const intensity = Math.min(1, height * 0.5 + struggle * 0.9);
    const stage = document.getElementById("climb-stage");
    if (stage) stage.dataset.weather = intensity > 0.66 ? "heavy" : intensity > 0.33 ? "medium" : "calm";

    const type = this.world.particle;
    const spawn = () => {
      const p = document.createElement("div");
      p.className = `particle p-${type}`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.top = `${Math.random() * 100}%`;
      const dur = (type === "cloud" ? 26 : type === "rain" ? 1.1 : 6) * (1 - intensity * 0.4) + 1;
      p.style.animationDuration = `${dur}s`;
      p.style.opacity = String(0.3 + intensity * 0.7);
      if (type === "cloud") p.classList.add(Math.random() < 0.4 ? "wispy" : Math.random() < 0.3 ? "heavy" : "mid");
      host.appendChild(p);
      setTimeout(() => p.remove?.(), dur * 1000 + 400);
    };

    // a struggling climber gets up to ~3× the particles of a clean one
    const gap = Math.max(90, 700 - intensity * 560);
    for (let i = 0; i < Math.round(2 + intensity * 6); i++) spawn();
    this._weather = setInterval(() => {
      spawn();
      if (this.world.id === "skyreach" && Math.random() < 0.12) {
        const b = document.createElement("div");
        b.className = "particle p-bird";
        b.style.top = `${8 + Math.random() * 40}%`;
        b.style.animationDuration = `${9 + Math.random() * 6}s`;
        host.appendChild(b);
        setTimeout(() => b.remove?.(), 16000);
      }
    }, gap);
  }


  potential() {
    if (!this.state.choicesShown) return 3;
    return this.state.skipped ? 2 : 1;
  }

  guessTyped() {
    if (this.locked || this.state.choicesShown) return;
    const q = this.puzzle.questions[this.state.current];
    const raw = $("q-input").value;
    if (!raw.trim()) return;

    if (answerMatches(raw, q.options[q.correct], q.accept)) {
      this.succeed(3, "green", `Typed it — full 3 points.`);
    } else {
      this.state.typedDone = true;
      this.reactToMiss();
      this.openChoices(`“${raw.trim()}” isn't it. One pick from the choices — worth 1 pt.`);
    }
  }

  skipToChoices() {
    if (this.locked || this.state.choicesShown) return;
    this.state.skipped = true;
    this.openChoices("Pick from the choices — worth 2 pts.");
  }

  openChoices(message) {
    const q = this.puzzle.questions[this.state.current];
    this.state.choicesShown = true;
    this.save();
    $("answer-box").classList.add("hidden");
    $("btn-choices").classList.add("hidden");
    $("q-options").classList.remove("hidden");
    this.renderOptions(q);
    this.renderPoints();
    const fb = $("q-feedback");
    fb.textContent = message;
    fb.className = "q-feedback " + (this.state.typedDone ? "bad" : "");
  }

  guessOption(optionIndex, btn) {
    if (this.locked) return;
    const q = this.puzzle.questions[this.state.current];

    if (optionIndex === q.correct) {
      btn.classList.add("correct");
      const pts = this.potential();
      this.succeed(pts, "yellow", `Got it — ${pts} point${pts === 1 ? "" : "s"}.`);
    } else {
      btn.classList.add("eliminated", "shake");
      btn.disabled = true;
      this.reactToMiss();
      this.completeRung("gray", 0);
      this.lockRung();
      const fb = $("q-feedback");
      fb.textContent = "Not that one — rung missed. Keep climbing.";
      fb.className = "q-feedback miss";
      this.popRung("gray");
      this.offerNext();
    }
  }

  succeed(points, result, message) {
    this.completeRung(result, points);
    this.lockRung();
    const fb = $("q-feedback");
    fb.textContent = message;
    fb.className = "q-feedback good";
    this.popRung(result);
    this.offerNext();
  }

  /** Stage shake + climber slip. No answer reveal — the summit keeps its secrets. */
  reactToMiss() {
    const stage = document.getElementById("climb-stage");
    const climber = document.getElementById("climber");
    if (stage?.classList) {
      stage.classList.remove("shake");
      if (typeof stage.offsetWidth === "number") void stage.offsetWidth;
      stage.classList.add("shake");
    }
    if (climber?.classList) {
      climber.classList.remove("slip");
      if (typeof climber.offsetWidth === "number") void climber.offsetWidth;
      climber.classList.add("slip");
      climber.addEventListener?.("animationend", () => climber.classList.remove("slip"), { once: true });
    }
  }

  completeRung(result, points) {
    this.state.results[this.state.current] = result;
    this.state.scores[this.state.current] = points;
    this.save();
    this.renderLadder();

    track("rung_result", {
      mode: this.mode,
      rung: this.state.current + 1,
      category: this.puzzle.questions[this.state.current]?.category ?? "unknown",
      result,
      // how they got there: typed it, skipped to choices, or missed the type first
      method: !this.state.choicesShown ? "typed"
            : this.state.skipped ? "skipped"
            : "after_miss",
    });

    if (result !== "gray") {
      const rails = document.querySelector(".w-rails");
      if (rails?.classList) {
        rails.classList.remove("pulse");
        if (typeof rails.offsetWidth === "number") void rails.offsetWidth;
        rails.classList.add("pulse");
        rails.addEventListener?.("animationend", () => rails.classList.remove("pulse"), { once: true });
      }
    }
  }

  lockRung() {
    this.locked = true;
    $("q-input").disabled = true;
    $("btn-guess").disabled = true;
    $("btn-choices").classList.add("hidden");
    document.querySelectorAll(".option").forEach((b) => (b.disabled = true));
  }

  popRung(result) {
    const rung = document.querySelector(`.w-rung[data-rung="${this.state.current + 1}"]`);
    if (rung) {
      rung.classList.add(result, "pop");
      rung.addEventListener("animationend", () => rung.classList.remove("pop"), { once: true });
    }
  }

  offerNext() {
    const isLast = this.state.current === this.puzzle.questions.length - 1;
    const btn = $("btn-next");
    btn.textContent = isLast
      ? (this.mode === "practice" ? "See results" : "Bonus rung ↑")
      : "Next rung ↑";
    btn.classList.remove("hidden");
    btn.onclick = () => this.advance();
  }

  advance() {
    this.locked = false;
    const justClimbed = this.state.current;
    if (this.state.current < this.puzzle.questions.length - 1) {
      this.state.current += 1;
      this.state.typedDone = false;
      this.state.skipped = false;
      this.state.choicesShown = false;
      this.save();
      this.renderQuestion();
      this.renderLadder();
      this.triggerClimb(justClimbed);
    } else if (this.mode === "practice") {
      this.finish();
    } else {
      this.state.stage = "bonus";
      this.save();
      this.showBonus();
      this.renderLadder();
      this.triggerClimb(justClimbed);
    }
  }

  /**
   * The climb, styled by performance. A typed answer is a confident surge; a
   * salvaged guess is a labored haul; a miss is a slip that costs you ground
   * before you scrabble back. Same rule (you never fail out) — but the motion
   * finally tells the truth about how it went.
   */
  triggerClimb(fromIndex) {
    const climber = document.getElementById("climber");
    const score = this.state.scores[fromIndex] ?? 0;
    const style = score === 3 ? "surge" : score === 0 ? "slip" : "haul";
    const gained = ALT_GAIN[score] ?? 0;

    if (climber?.classList) {
      climber.classList.remove("surge", "haul", "slipping");
      if (typeof climber.offsetWidth === "number") void climber.offsetWidth;
      climber.classList.add(style === "slip" ? "slipping" : style);
      setTimeout(() => climber.classList.remove("surge", "haul", "slipping"), 1400);
    }

    const stage = document.getElementById("climb-stage");
    if (stage?.appendChild) {
      const f = document.createElement("div");
      f.className = `alt-float alt-${style}`;
      const meters = Math.round(gained * METERS_PER_UNIT);
      f.textContent = style === "slip" ? `slipped — only +${meters} m` : `+${meters} m`;
      stage.appendChild(f);
      setTimeout(() => f.remove?.(), 1600);
    }
  }

    /* ---------------- bonus (theme) rung ---------------- */

  showBonus() {
    this.setScreen("screen-play");
    this.setPhase("bonus");
    this.renderLadder();
    const input = $("b-input");
    input.value = "";
    input.disabled = false;
    $("btn-b-guess").disabled = false;
    input.focus({ preventScroll: true });
  }

  guessTheme() {
    const raw = $("b-input").value;
    if (!raw.trim()) return;
    this.state.theme = {
      guessed: true,
      correct: themeMatches(raw, this.puzzle.theme, this.puzzle.themeAnswers),
      guess: raw.trim(),
    };
    track("theme_guess", {
      mode: this.mode,
      correct: this.state.theme.correct ? "yes" : "no",
    });
    this.finish();
  }

  skipTheme() {
    this.state.theme = { guessed: false, correct: false, guess: "" };
    track("theme_guess", { mode: this.mode, correct: "skipped" });
    this.finish();
  }

  /* ---------------- finishing ---------------- */

  finish() {
    const firstFinish = this.state.stage !== "done";
    this.state.stage = "done";
    if (this.state.timeMs == null && this.state.startedAt) {
      this.state.timeMs = Date.now() - this.state.startedAt;
    }
    if (this.mode === "daily" && !this.state.recorded) {
      const rungsCleared = this.state.results.filter((r) => r !== "gray").length;
      recordResult(this.dateKey, rungsCleared, this.state.theme.correct, this.state.timeMs);
      this.state.recorded = true;
    }
    this.save();
    if (firstFinish) {
      const cleared = this.state.results.filter((r) => r !== "gray").length;
      track("climb_complete", {
        mode: this.mode,
        world: this.world.id,
        tag: this.puzzle.tag ?? "standard",
        score: scoreBand(this.totalScore()),
        rungs_cleared: cleared,
        theme_correct: this.state.theme.correct ? "yes" : "no",
        // rough speed buckets — tells us if the game is too slow to be a daily habit
        duration: this.state.timeMs == null ? "unknown"
                : this.state.timeMs < 90000 ? "under 1.5m"
                : this.state.timeMs < 180000 ? "1.5-3m"
                : this.state.timeMs < 300000 ? "3-5m"
                : "over 5m",
      });
    }

    if (firstFinish && this.mode === "daily") {
      // hook for the account layer (leaderboard sync); no-op offline
      this.onFinish?.(this.syncPayload());
    }
    this.showResults({ animateReveal: true });
  }

  /** Coarse snapshot for abandon tracking. No personal data. */
  abandonState() {
    return {
      mode: this.mode,
      finished: this.state.stage === "done",
      rung: this.state.current + 1,
      answered: this.state.results.filter(Boolean).length,
    };
  }

  syncPayload() {
    return {
      dateKey: this.dateKey,
      puzzleNumber: this.number,
      score: this.totalScore(),
      timeMs: this.state.timeMs,
      themeCorrect: this.state.theme.correct,
      rungs: this.state.results,
    };
  }

  totalScore() {
    const base = this.state.scores.reduce((a, b) => a + (b || 0), 0);
    return base + (this.state.theme.correct ? THEME_BONUS : 0);
  }

  maxScore() {
    return this.mode === "practice" ? 15 : 18;
  }

  renderResults(animateReveal) {
    const score = this.totalScore();
    const cleared = this.state.results.filter((r) => r !== "gray").length;
    const t = this.state.theme;
    const practice = this.mode === "practice";

    $("r-eyebrow").textContent =
      this.mode === "archive" ? `Archive · #${this.number} · ${prettyDate(this.dateKey)}`
      : practice ? "Practice round"
      : cleared === 5 ? "You cleared every rung"
      : `You cleared ${cleared} of 5 rungs`;

    $("r-score").textContent = score;
    $("r-score-max").textContent = `/${this.maxScore()}`;
    $("r-time").innerHTML = this.state.timeMs != null
      ? `Climbed in <strong>${formatTime(this.state.timeMs)}</strong>`
      : "";

    // theme card + connections hidden entirely in practice
    $("theme-reveal").classList.toggle("hidden", practice);
    $("r-connections").classList.toggle("hidden", practice);

    if (!practice) {
      const themeEl = $("r-theme");
      themeEl.textContent = this.puzzle.theme;
      $("r-blurb").textContent = this.puzzle.themeBlurb ?? "";

      const verdict = $("r-theme-verdict");
      if (t.correct) {
        verdict.textContent = `You called it — “${t.guess}” · +${THEME_BONUS} bonus`;
        verdict.className = "theme-verdict purple";
      } else if (t.guessed) {
        verdict.textContent = `Your guess: “${t.guess}”`;
        verdict.className = "theme-verdict";
      } else {
        verdict.textContent = "No theme guess this time";
        verdict.className = "theme-verdict";
      }

      themeEl.classList.remove("revealed");
      if (animateReveal) {
        requestAnimationFrame(() => themeEl.classList.add("revealed"));
      } else {
        themeEl.style.opacity = 1;
        themeEl.style.transform = "none";
        themeEl.style.filter = "none";
      }

      const list = $("r-connections");
      list.innerHTML = "";
      this.puzzle.questions.forEach((q, i) => {
        const li = document.createElement("li");
        const sq = document.createElement("span");
        sq.className = `sq sq-${this.state.results[i]}`;
        const text = document.createElement("span");
        const answer = q.options[q.correct];
        text.innerHTML = `<strong>${escapeHtml(answer)}</strong> — ${escapeHtml(q.connection ?? "")}`;
        li.append(sq, text);
        list.appendChild(li);
      });
    }

    // grid
    const grid = $("r-grid");
    grid.innerHTML = "";
    this.state.results.forEach((r) => {
      const cell = document.createElement("div");
      cell.className = `cell ${r}`;
      grid.appendChild(cell);
    });
    if (!practice) {
      const themeCell = document.createElement("div");
      themeCell.className = "cell theme-cell " + (t.correct ? "purple" : "empty");
      themeCell.title = "Theme guess";
      grid.appendChild(themeCell);
    }

    // contextual actions
    $("btn-share").classList.toggle("hidden", practice);
    $("btn-again").classList.toggle("hidden", !practice);
    $("btn-today").classList.toggle("hidden", this.mode === "daily");
    document.querySelector(".countdown").classList.toggle("hidden", this.mode !== "daily");

    const postBtn = $("btn-post-lb");
    if (postBtn) {
      const canPost = this.mode === "daily" && typeof this.onFinish === "function";
      postBtn.classList.toggle("hidden", !canPost);
      postBtn.disabled = false;
      postBtn.textContent = "Post to leaderboard";
      postBtn.onclick = async () => {
        postBtn.disabled = true;
        postBtn.textContent = "Posting…";
        const ok = await this.onFinish?.(this.syncPayload());
        postBtn.disabled = false;
        postBtn.textContent = ok ? "Posted ✓" : "Post to leaderboard";
      };
    }

    this.renderLadder();
    if (!practice) this.wireShare(score);
    if (this.mode === "daily") this.startCountdown();
    if (animateReveal && t.correct) this.celebrate();
  }

  celebrate() {
    const host = $("theme-reveal");
    if (!host || !host.appendChild) return;
    const colors = ["#4fae62", "#d8a02c", "#8458c9", "#6aa9e9"];
    for (let i = 0; i < 26; i++) {
      const bit = document.createElement("div");
      bit.className = "confetti";
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${Math.random() * 350}ms`;
      host.appendChild(bit);
      setTimeout(() => bit.remove(), 1800);
    }
  }

  wireShare(score) {
    $("btn-share").onclick = async () => {
      const dark = document.documentElement.dataset.theme === "dark";
      const text = buildShareText({
        number: this.number,
        score,
        results: this.state.results,
        themeCorrect: this.state.theme.correct,
        timeMs: this.state.timeMs,
        dark,
      });
      const outcome = await share(text);
      track("share_click", { mode: this.mode, outcome });
      if (outcome === "copied") toast("Result copied to clipboard");
      else if (outcome === "failed") toast("Couldn't copy — select and copy manually");
    };
  }

  startCountdown() {
    const el = $("r-countdown");
    clearInterval(this._countdown);
    const tick = () => {
      let ms = msUntilMidnight();
      const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
      const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
      const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
      el.textContent = `${h}:${m}:${s}`;
    };
    tick();
    this._countdown = setInterval(tick, 1000);
  }
}

/* ---------------- helpers ---------------- */

export function toast(message, ms = 2200) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
