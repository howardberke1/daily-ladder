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
- Each rung offers **one typed guess and one multiple-choice pick**. Typed correct = 3 pts (🟩). Skip typing → the 4 choices appear worth 2 pts (🟨). Miss the typed guess → choices appear worth 1 pt (🟨). Wrong pick = rung missed (⬜/⬛). Typed answers are fuzzy-matched (case, punctuation, small typos, surnames, leading articles forgiven).
- Missed rungs never reveal the correct answer mid-game — answers appear only on the results screen, where the theme reveal ties them together. The game never ends early.
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

## Backend (accounts, friends, leaderboards)

Optional layer powered by Supabase. The game runs fully without it — if the
Supabase CDN or project is unreachable, the account/trophy buttons hide and
everything else works offline from localStorage.

One-time setup:
1. In the Supabase dashboard → SQL Editor → New query, paste all of
   `supabase/schema.sql` and Run. This creates `profiles`, `friendships`,
   `results`, the all-time leaderboard view, and the Row Level Security rules.
2. Authentication → URL Configuration: set the Site URL to
   `https://dailyladder.app` and add it to Redirect URLs (magic links need
   this to land back on the game).
3. **Custom SMTP is mandatory, not optional.** Supabase's built-in email
   sender only delivers to addresses on your Supabase org team — everyone
   else silently fails with "Email address not authorized" — and it caps at
   2 emails/hour. Set up Resend (free, 3k/month):
   - Resend → Domains → add `dailyladder.app`, region us-east-1, add the
     SPF/DKIM records to Cloudflare DNS, wait for Verified.
   - Resend → API Keys → create one.
   - Supabase → Authentication → Emails → SMTP Settings → enable Custom SMTP:
     host `smtp.resend.com`, port `465`, username `resend`, password = the API
     key, sender `noreply@dailyladder.app`.
   - Supabase → Authentication → Rate Limits → raise the email limit from its
     default of 2/hour to 100+. Custom SMTP does *not* raise this for you.
   - Leave click tracking OFF in Resend — link rewriting breaks Supabase's
     single-use magic links.
3. `js/supabaseClient.js` holds the project URL and the *publishable* key —
   safe in frontend code by design. Never put the secret key anywhere in
   this repo.

How it flows: players sign in via emailed magic link, claim a username, and
finished **daily** games upsert into `results` (archive/practice never sync).
Leaderboards: Today (global), Friends, All-time — ranked by score, fastest
time breaks ties. Cosmetics (helmet/pack colors) work signed-out via
localStorage and sync to the profile when signed in.



## Versioning

`js/version.js` is the single source of truth. The version shows in the help
modal footer, so you can always confirm what's actually live on the site versus
what you have locally — useful when a deploy silently doesn't land.

Bump the minor version for features, patch for fixes. **1.0.0 is reserved for
the first real public launch** (art direction settled, ready to promote rather
than just share with friends).

```bash
bash scripts/package.sh     # validates, then writes daily-ladder-v0.8.0.zip
```

## The worlds

`js/worlds.js` builds scenery as authored SVG, not CSS shapes. Six worlds, each
using a **different silhouette generator** so the geometry itself differs —
`jagged` (alpine peaks), `mesa` (flat-topped plateaus with vertical cliffs),
`city` (rectilinear towers with lit window grids and beacons), `canopy`
(conifer cones), `volcanic` (fractured shards with lava fissures), `shelves`
(cloud banks). Recolor any of them and they'd still read as different places.

Depth comes from atmospheric perspective: four layers, each lighter, hazier and
lower-contrast as it recedes, with haze bands between them and parallax depth
per layer (distant barely moves, foreground races). That — not palette — is
what makes it read as a place.

Scenery is deterministic per puzzle number (seeded mulberry32), so everyone
climbing today sees the same mountain and it's stable across reloads.

## The climb

Altitude tracks **score, not question count** — the fix for "the climber goes
up no matter what":

| Rung result | Climb gained |
|---|---|
| Typed it (3 pts) | 2.0 segments — a confident surge |
| Skipped to choices (2 pts) | 1.4 — a steady haul |
| Salvaged after a miss (1 pt) | 0.9 — a labored haul |
| Missed (0 pts) | 0.4 — you slip, dangle, and scrabble back |

Five perfect rungs = 10 segments = the summit (2000 m). A bad climb ends
visibly short of it. The rung markers sit at the altitude you actually reached,
so the ladder itself records the run — tight cluster means a slog, big gaps
mean a strong climb — and missed rungs render **cracked and splintered**
where you fell.

The game rules are unchanged: you still never fail out, scoring is identical.
Only the telling changed.

Weather answers to performance too (`gripLevel()`): climb clean and the sky
settles; keep missing and particles thicken and the vignette closes in. The
grip meter on the left drains as you miss — visible stakes, never a fail state.

## The climber

`js/climber.js` is a data-driven rig, not markup. `CATALOG` describes every
customizable part; `renderClimber(cosmetics)` builds the SVG. **Adding a new
part, style, or color is a catalog edit — never a markup edit**, and the
customizer UI rebuilds itself from the catalog automatically.

13 parts: skin, hair + hair color, headgear + color, top + color, pants,
boots, gloves, pack + color, accessory. ~5.3 billion combinations.

Rendered SVG always carries the class hooks the animation CSS depends on
(`.rig`, `.c-arm-l`, `.c-leg-r`, `.c-head`, …), so poses keep working no
matter what's worn. Some parts are conditional — e.g. `.c-lamp` and the light
cone only exist on the headlamp helmet, so the altitude-triggered headlamp
only fires if you're wearing one.

`js/cosmetics.js` handles storage and mounting, and deliberately has **no
Supabase dependency** — the climber renders even if the account layer never
loads. Signed in, the look syncs to `profiles.cosmetics` (a jsonb blob, so new
parts need no migration) and follows the player across devices.

**Run `supabase/migration-002-cosmetics.sql` once** to add the jsonb column and
drop the old fixed columns.

## Analytics

**Currently OFF.** The snippet in `index.html`'s `<head>` is commented out so the
site makes no third-party requests. Everything else is in place and dormant —
`js/analytics.js` plus `track()` calls throughout the game all no-op safely
without a provider. To turn it on: create the site at plausible.io, add the
goals below, uncomment the two lines in `<head>`. That's the whole switch.

Every event routes through `js/analytics.js` so the provider can be swapped in
exactly one place.

**Setup:** create the site at plausible.io with domain `dailyladder.app`, then
add each event below as a **custom event goal** in Site Settings → Goals
(events only appear on the dashboard once a matching goal exists).

| Event | Props | Answers |
|---|---|---|
| `climb_start` | mode, world, resumed | How many climbs begin? |
| `rung_result` | mode, rung, category, result, method | Where do people struggle? Do they type or skip? Which categories are too hard? |
| `theme_guess` | mode, correct | Is the bonus rung too hard? |
| `climb_complete` | mode, world, score, rungs_cleared, theme_correct, duration | Completion rate, score spread, is it a 3-minute game? |
| `climb_abandon` | mode, rung, answered | **Where do they quit?** |
| `share_click` | mode, outcome | Is anyone sharing? |
| `practice_start`, `archive_open`, `archive_play` | — | Does anyone use these modes? |
| `account_open`, `signin_link_requested`, `username_claimed` | state | Sign-up funnel drop-off |
| `leaderboard_open`, `stats_open`, `help_open` | tab | Feature usage |
| `cosmetic_change` | kind, choice | Does customization matter? |

The key funnel: `climb_start` → `climb_complete` is your completion rate;
`climb_abandon`'s `rung` prop tells you exactly which question loses people.

**Privacy:** no personal data is ever sent — no emails, usernames, user ids,
or answer text. Scores are bucketed into bands, durations into ranges. Verified
by an automated test that fails the build if a guess or answer leaks into props.

**Debugging:** append `?debug_analytics` to any URL to log events to the console
instead of guessing whether they fired.

**Cost note:** Plausible cloud is ~$9/mo after a 30-day trial. If you'd rather
stay free, Cloudflare Web Analytics (you're already on Cloudflare DNS) covers
pageviews for $0 — but it has no custom events, so you'd lose the funnel above,
which is the whole point. Swap providers by editing `js/analytics.js` only.

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
