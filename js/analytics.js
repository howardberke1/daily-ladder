// Analytics wrapper. Everything routes through track() so the provider can be
// swapped (or removed) in exactly one place. If the script is blocked, absent,
// or the player uses an ad blocker, every call silently no-ops — analytics must
// never be able to break a game.
//
// Privacy: no personal data, ever. No emails, no usernames, no user ids, no
// answer text. Only coarse gameplay facts. That's what keeps this cookie-free
// and out of consent-banner territory.

// Read lazily and defensively: a module-level throw here would take the whole
// game down with it, which is exactly what analytics must never do.
const DEBUG = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").has("debug_analytics");
  } catch {
    return false;
  }
})();

/**
 * @param {string} event  snake_case event name (must match the goal name in Plausible)
 * @param {object} [props] flat map of primitives; keep cardinality low
 */
export function track(event, props) {
  try {
    if (DEBUG) console.log("[analytics]", event, props ?? "");
    const p = globalThis.window?.plausible;
    if (typeof p !== "function") return;
    p(event, props ? { props } : undefined);
  } catch {
    /* analytics must never throw into gameplay */
  }
}

/** Buckets a score so the dashboard shows a distribution, not 19 separate values. */
export function scoreBand(score) {
  if (score >= 18) return "18 (perfect)";
  if (score >= 15) return "15-17";
  if (score >= 12) return "12-14";
  if (score >= 9) return "9-11";
  if (score >= 5) return "5-8";
  return "0-4";
}

/**
 * Fires climb_abandon when someone leaves mid-climb. This is the single most
 * useful signal for "where do they quit" — pagehide is the reliable hook
 * (unload doesn't fire on mobile Safari; visibilitychange also covers tab
 * switches that never come back).
 */
export function watchAbandon(getState) {
  let sent = false;
  const maybeSend = () => {
    if (sent) return;
    const s = getState?.();
    if (!s || s.finished) return;
    sent = true;
    track("climb_abandon", {
      mode: s.mode,
      rung: s.rung,
      answered: s.answered,
    });
  };

  try {
    globalThis.addEventListener?.("pagehide", maybeSend);
    globalThis.addEventListener?.("visibilitychange", () => {
      if (globalThis.document?.visibilityState === "hidden") maybeSend();
    });
  } catch {
    /* non-browser context — nothing to watch */
  }

  // reset the latch when a new climb starts
  return () => { sent = false; };
}
