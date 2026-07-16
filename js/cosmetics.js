// Cosmetics: local-first, no account required.
//
// Deliberately has no Supabase dependency — the climber must render even if the
// account layer never loads. account-ui.js imports from here to sync to a
// profile when someone's signed in; that's a one-way, optional enhancement.

import { renderClimber, normalize, DEFAULTS, randomCosmetics } from "./climber.js";

const KEY = "tl:climber";

let cache = null;
const listeners = new Set();

export function getCosmetics() {
  if (cache) return cache;
  try {
    cache = normalize(JSON.parse(localStorage.getItem(KEY)) ?? {});
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveCosmetics(patch) {
  cache = normalize({ ...getCosmetics(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode — still applies for this session */
  }
  mountClimber();
  for (const fn of listeners) fn(cache);
  return cache;
}

/** Replace everything at once (e.g. hydrating from a signed-in profile). */
export function setCosmetics(next) {
  cache = normalize(next ?? {});
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  mountClimber();
  for (const fn of listeners) fn(cache);
  return cache;
}

export function randomize() {
  return saveCosmetics(randomCosmetics());
}

export function resetCosmetics() {
  return setCosmetics({ ...DEFAULTS });
}

export function onCosmeticsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Renders the climber into the stage, replacing whatever's there. Keeps the
 * #climber id and .climber class so game.js's animation hooks keep working.
 * Preserves any transient state classes mid-animation.
 */
export function mountClimber() {
  const existing = document.getElementById("climber");
  if (!existing) return;

  const keep = ["climbing", "slip", "celebrating", "moving"]
    .filter((c) => existing.classList?.contains(c));

  const markup = renderClimber(getCosmetics(), {
    id: "climber",
    className: ["climber", ...keep].join(" "),
  });

  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  const next = tpl.content.firstElementChild;
  if (next) existing.replaceWith(next);
}
