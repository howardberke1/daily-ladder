# Daily Ladder

A daily trivia game inspired by Wordle. One ladder of 5 questions per day — easy at the bottom, hard at the top, every rung from a different category, and all five answers secretly connected by one hidden theme revealed only at the end.

Pure static site: no backend, no accounts, no build step. Puzzles live in a JSON file; streaks and stats live in each player's browser (localStorage).

## Project structure

```
trivia-ladder/
├── index.html          App shell (play screen, results, help & stats modals)
├── css/
│   └── styles.css      All styles: design tokens, light/dark themes, animations
├── js/
│   ├── main.js         Bootstrap: theme, modals, stats, game start
│   ├── game.js         Game state machine + play/results rendering
│   ├── puzzles.js      Loads puzzles.json, picks today's puzzle by date
│   ├── storage.js      localStorage: settings, daily progress, lifetime stats
│   └── share.js        Spoiler-free emoji share grid (🟩🟨⬜)
├── data/
│   └── puzzles.json    All daily puzzles, keyed by date
├── scripts/
│   └── puzzle.mjs      Authoring helper: scaffold a new day, validate the file
└── data/practice.json  Standalone question bank for practice mode
```

## Run locally

The site fetches `data/puzzles.json`, so it needs to be served over HTTP (browsers block `fetch()` on `file://` pages). Any static server works:

```bash
cd trivia-ladder
npx serve            # or: python3 -m http.server 8000
```

Then open the printed URL (e.g. http://localhost:3000).

## Modes

- **Daily** — one shared ladder per calendar day; the only mode that counts toward streaks and stats.
- **Archive** (calendar icon) — replay any past day. Progress saves per-date, results show in the archive list, but streaks/stats are untouched. Deep-linkable: `yoursite.com/?d=2026-07-12`.
- **Practice** (shuffle icon) — an endless random ladder: one question per difficulty, drawn from `data/practice.json` plus questions from already-published days (never future days, so no spoilers). No theme, no saving, no stats — just reps.

## Game rules (as implemented)

- 5 questions per day, difficulty 1 → 5, each from a different category.
- Every rung starts **worth 3 points**. Players type their answer (fuzzy-matched: case, punctuation, small typos, surnames, and leading articles are forgiven). A "Show 4 choices" button converts the rung to multiple choice for −1 point (floor 1), so stuck players always have an out.
- Every wrong guess (typed or clicked) costs 1 point. At 0 the rung is missed — the game never ends early.
- Rung colors: 🟩 solved at full 3 pts, 🟨 solved for 1–2, ⬜/⬛ missed.
- **Bonus rung:** after Q5, one typed guess at the hidden theme (fuzzy-matched against `theme` + `themeAnswers`). Correct = +3 points and a 🟪 in the share grid. Max score 18.
- A **win** = clearing all 5 rungs. Streak = consecutive days with a win. Theme-crack rate is tracked in stats.
- The share text contains only the ladder number, score, and colored squares — never the theme or answers.
- Refreshing mid-game restores progress; a finished day stays finished until midnight (local time).

## Adding new puzzles

### Option A — script (recommended)

```bash
node scripts/puzzle.mjs new              # appends a template for the next open date
node scripts/puzzle.mjs new 2026-08-01   # or a specific date
# …fill in the TODOs in data/puzzles.json…
node scripts/puzzle.mjs validate         # checks structure, dates, duplicates, TODOs
```

The validator enforces: unique dates, exactly 5 questions with difficulty 1–5 in order, 5 distinct categories, exactly 4 unique options each, `correct` in 0–3, and no leftover TODOs.

### Option B — by hand

Append an object to the `puzzles` array in `data/puzzles.json`:

```json
{
  "date": "2026-08-01",
  "theme": "The hidden theme",
  "themeAnswers": ["accepted theme guesses", "common alternate phrasings"],
  "themeBlurb": "One sentence shown under the reveal.",
  "questions": [
    {
      "category": "History",
      "difficulty": 1,
      "question": "The question text?",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "accept": ["optional alternate spellings or names for typed answers"],
      "connection": "How this answer ties to the theme (shown after the reveal)."
    }
  ]
}
```

(5 questions total, `difficulty` 1 through 5 in order.)

### Authoring tips

- Pick the theme first, then work backward: find five answers that connect to it across five different categories.
- The theme should be invisible while playing but obvious in hindsight — the "ohhh" is the whole payoff.
- Difficulty should live in the *question*, not obscure answer choices. Rung 1 should be gettable by almost everyone; rung 5 should make people feel smart.
- `connection` is shown on the results screen next to each answer — keep it to one short sentence.
- Be generous with `themeAnswers`: include the theme itself plus every reasonable phrasing ("blue", "the color blue", "blue things"). Getting robbed on a correct-in-spirit theme guess is the fastest way to lose a player.
- Use a question's optional `accept` array for legit alternate typed answers (nicknames, alternate spellings, "King Tut" for "Tutankhamun").

### Behavior when a date has no puzzle

If today's date isn't in the file, the game deterministically rotates through the existing pool (based on days since `startDate`) so the site never breaks. For a real launch, just keep a few weeks of dated puzzles queued up.

## Deploy

It's a plain static site — deploy the whole folder as-is.

**GitHub Pages**
1. Push this folder to a repo.
2. Settings → Pages → Deploy from branch → `main` / root.

**Netlify** — drag the folder onto https://app.netlify.com/drop, or connect the repo (no build command, publish directory = root).

**Vercel** — `npx vercel` in the folder, or import the repo (framework preset: "Other", no build step).

To publish new puzzles, edit `data/puzzles.json`, run the validator, and redeploy (or just `git push` if the host is connected to the repo). Since puzzles are keyed by date, you can queue up weeks of future days in one commit.

## Notes & easy extensions

- **Timezones:** "daily" means the player's local calendar day, matching Wordle's behavior. Players in different timezones roll over at their own midnight.
- **Hard mode idea:** score bonus for finishing under a time limit.
- **Archive idea:** since puzzles are keyed by date, an archive page could let players replay past days without affecting streaks.
