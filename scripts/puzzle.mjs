#!/usr/bin/env node
// Puzzle authoring helper for Trivia Ladder.
//
//   node scripts/puzzle.mjs new [YYYY-MM-DD]   → append a blank puzzle template
//   node scripts/puzzle.mjs validate           → check the whole data file
//
// "new" defaults to the day after the latest puzzle in the file, so you can
// just run it repeatedly to queue up future days, then fill in the blanks.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "puzzles.json");

const [, , cmd, arg] = process.argv;

if (cmd === "new") makeNew(arg);
else if (cmd === "validate") validate();
else {
  console.log("Usage:\n  node scripts/puzzle.mjs new [YYYY-MM-DD]\n  node scripts/puzzle.mjs validate");
  process.exit(1);
}

/* ---------------- new ---------------- */

function makeNew(dateArg) {
  const data = load();
  const date = dateArg ?? nextDate(data);

  if (data.puzzles.some((p) => p.date === date)) {
    fail(`A puzzle for ${date} already exists.`);
  }
  if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    fail(`Date must be YYYY-MM-DD, got "${dateArg}".`);
  }

  const categories = ["History", "Science", "Geography", "Movies", "Sports"];
  data.puzzles.push({
    date,
    theme: "TODO — the hidden theme",
    themeAnswers: ["TODO — accepted guesses, e.g. the theme and common phrasings"],
    themeBlurb: "TODO — one sentence shown under the reveal.",
    questions: categories.map((category, i) => ({
      category,
      difficulty: i + 1,
      question: `TODO — difficulty ${i + 1} question`,
      options: ["TODO A", "TODO B", "TODO C", "TODO D"],
      correct: 0,
      connection: "TODO — how this answer ties to the theme",
    })),
  });

  data.puzzles.sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
  console.log(`✔ Added template for ${date}. Open data/puzzles.json and fill in the TODOs, then run:\n    node scripts/puzzle.mjs validate`);
}

function nextDate(data) {
  const latest = data.puzzles.map((p) => p.date).sort().at(-1) ?? data.startDate;
  const d = new Date(`${latest}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------- validate ---------------- */

function validate() {
  const data = load();
  const errors = [];
  const seen = new Set();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.startDate ?? "")) {
    errors.push(`startDate must be YYYY-MM-DD (got "${data.startDate}")`);
  }

  for (const p of data.puzzles) {
    const at = `[${p.date ?? "no date"}]`;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? "")) errors.push(`${at} date must be YYYY-MM-DD`);
    if (seen.has(p.date)) errors.push(`${at} duplicate date`);
    seen.add(p.date);

    if (!p.theme || p.theme.includes("TODO")) errors.push(`${at} theme is missing or still a TODO`);
    if (!Array.isArray(p.themeAnswers) || !p.themeAnswers.length) {
      errors.push(`${at} themeAnswers must be a non-empty array of accepted theme guesses`);
    } else if (p.themeAnswers.some((a) => String(a).includes("TODO"))) {
      errors.push(`${at} themeAnswers still has TODOs`);
    }
    if (!Array.isArray(p.questions) || p.questions.length !== 5) {
      errors.push(`${at} must have exactly 5 questions`);
      continue;
    }

    const cats = new Set();
    p.questions.forEach((q, i) => {
      const qa = `${at} Q${i + 1}`;
      if (!q.category) errors.push(`${qa} missing category`);
      cats.add(q.category);
      if (q.difficulty !== i + 1) errors.push(`${qa} difficulty should be ${i + 1} (got ${q.difficulty})`);
      if (!q.question || q.question.includes("TODO")) errors.push(`${qa} question is missing or still a TODO`);
      if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`${qa} must have exactly 4 options`);
      if (q.options?.some((o) => String(o).includes("TODO"))) errors.push(`${qa} has TODO options`);
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) {
        errors.push(`${qa} correct must be an integer 0–3 (got ${q.correct})`);
      }
      if (new Set(q.options?.map((o) => String(o).toLowerCase())).size !== q.options?.length) {
        errors.push(`${qa} has duplicate options`);
      }
      if (!q.connection || q.connection.includes("TODO")) errors.push(`${qa} connection is missing or still a TODO`);
      if (q.accept !== undefined && !Array.isArray(q.accept)) errors.push(`${qa} accept must be an array of alternate answers`);
    });
    if (cats.size !== 5) errors.push(`${at} all 5 questions should use different categories (found ${cats.size})`);
  }

  if (errors.length) {
    console.error(`✖ ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n` + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`✔ ${data.puzzles.length} puzzles valid (${[...seen].sort().at(0)} → ${[...seen].sort().at(-1)})`);
}

/* ---------------- shared ---------------- */

function load() {
  try {
    return JSON.parse(readFileSync(DATA, "utf8"));
  } catch (e) {
    fail(`Couldn't read/parse ${DATA}: ${e.message}`);
  }
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
