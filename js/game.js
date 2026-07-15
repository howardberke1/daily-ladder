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

const START_POINTS = 3;
const THEME_BONUS = 3;
const METERS_PER_RUNG = 400;

// Rotating daily worlds. Same world for everyone on a given day.
const WORLDS = [
  { id: "summit",   particle: "snow" },
  { id: "skyreach", particle: "cloud" },
  { id: "neon",     particle: "rain" },
  { id: "dunes",    particle: "sand" },
  { id: "forest",   particle: "firefly" },
  { id: "ember",    particle: "ember" },
];

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
    this.world = mode === "practice"
      ? WORLDS[Math.floor(Math.random() * WORLDS.length)]
      : WORLDS[((number - 1) % WORLDS.length + WORLDS.length) % WORLDS.length];
  }

  /* ---------------- lifecycle ---------------- */

  start() {
    this.renderModeBanner();
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
    if (this.mode === "archive") {
      el.textContent = `Archive · #${this.number} · ${prettyDate(this.dateKey)} — doesn't affect streaks`;
      el.classList.remove("hidden");
    } else if (this.mode === "practice") {
      el.textContent = "Practice — random questions, nothing counts";
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

    renderLadder() {
    const stage = document.getElementById("climb-stage");
    const world = document.getElementById("world");

    const completed = this.state.results.filter(Boolean).length;
    const done = this.state.stage === "done";
    const atSummit = done || this.state.stage === "bonus";
    const progress = done && this.state.theme.correct ? 6 : atSummit ? 6 : completed;

    if (stage) {
      stage.dataset.world = this.world.id;
      stage.dataset.progress = String(Math.min(6, progress));
    }

    // camera + layout geometry
    if (stage && world && typeof stage.getBoundingClientRect === "function") {
      const h = stage.getBoundingClientRect().height || 600;
      const seg = Math.max(160, Math.min(h * 0.44, 420));
      const gh = Math.round(h * 0.31);
      stage.style.setProperty("--seg", `${seg}px`);
      stage.style.setProperty("--gh", `${gh}px`);
      const camPos = atSummit ? 6 : completed;
      const cam = camPos * seg;
      world.style.setProperty("--cam", `${cam}px`);
      stage.style.setProperty("--shift", `${cam}px`);
    }

    // rung states
    document.querySelectorAll(".w-rung").forEach((el) => {
      const idx = Number(el.dataset.rung) - 1;
      el.classList.remove("green", "yellow", "gray", "active");
      const result = this.state.results[idx];
      if (result) el.classList.add(result);
      else if (idx === this.state.current && this.state.stage === "play") el.classList.add("active");
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

    this.animateAltitude(progress * METERS_PER_RUNG);
    this.updateWeather(progress);
    this.animateClimb();
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

  updateWeather(progress) {
    clearInterval(this._weather);
    const host = document.getElementById("w-particles");
    if (!host || !host.appendChild) return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (this.state.stage === "done") progress = Math.min(progress, 3); // calm on results

    const type = this.world.particle;
    const density = 1 + Math.floor(progress / 2); // conditions build as you climb
    const spawn = () => {
      if ((host.children?.length ?? 0) > 70) return;
      for (let i = 0; i < density; i++) {
        const p = document.createElement("div");
        p.className = `particle p-${type}`;
        p.style.left = `${Math.random() * 100}%`;
        if (type === "cloud" || type === "sand") p.style.top = `${10 + Math.random() * 60}%`;
        if (type === "firefly") p.style.top = `${40 + Math.random() * 50}%`;
        const dur = type === "rain" ? 0.9 + Math.random() * 0.6
                  : type === "cloud" ? 16 + Math.random() * 14
                  : type === "ember" ? 3.5 + Math.random() * 3
                  : 4 + Math.random() * 4;
        p.style.animationDuration = `${dur}s`;
        if (type === "cloud") p.classList.add(Math.random() < 0.4 ? "wispy" : Math.random() < 0.3 ? "heavy" : "mid");
        host.appendChild(p);
        if (p.addEventListener) p.addEventListener("animationend", () => p.remove(), { once: true });
        setTimeout(() => p.remove?.(), (dur + 1) * 1000);
      }
    };
    spawn();
    this._weather = setInterval(() => {
      spawn();
      // #11: occasional birds crossing the open sky
      if (this.world.id === "skyreach" && Math.random() < 0.12 && host.appendChild) {
        const b = document.createElement("div");
        b.className = "particle p-bird";
        b.style.top = `${8 + Math.random() * 40}%`;
        b.style.animationDuration = `${9 + Math.random() * 6}s`;
        host.appendChild(b);
        setTimeout(() => b.remove?.(), 16000);
      }
    }, 700);
  }

    /* ---------------- guessing ---------------- */

  /** Points this rung is still worth: 3 typed, 2 after a skip, 1 after a miss. */
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
    if (this.state.current < this.puzzle.questions.length - 1) {
      this.state.current += 1;
      this.state.typedDone = false;
      this.state.skipped = false;
      this.state.choicesShown = false;
      this.save();
      this.renderQuestion();
      this.triggerClimb();
    } else if (this.mode === "practice") {
      this.finish();
    } else {
      this.state.stage = "bonus";
      this.save();
      this.showBonus();
      this.triggerClimb();
    }
  }

  /** #6: hand-over-hand cycles while the camera pans up. */
  triggerClimb() {
    const climber = document.getElementById("climber");
    if (!climber?.classList) return;
    climber.classList.remove("climbing");
    if (typeof climber.offsetWidth === "number") void climber.offsetWidth;
    climber.classList.add("climbing");
    setTimeout(() => climber.classList.remove("climbing"), 1000);

    // "+400 m" floats up beside the climber
    const stage = document.getElementById("climb-stage");
    if (stage?.appendChild) {
      const f = document.createElement("div");
      f.className = "alt-float";
      f.textContent = `+${METERS_PER_RUNG} m`;
      stage.appendChild(f);
      setTimeout(() => f.remove?.(), 1500);
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
    this.finish();
  }

  skipTheme() {
    this.state.theme = { guessed: false, correct: false, guess: "" };
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
    if (firstFinish && this.mode === "daily") {
      // hook for the account layer (leaderboard sync); no-op offline
      this.onFinish?.(this.syncPayload());
    }
    this.showResults({ animateReveal: true });
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
