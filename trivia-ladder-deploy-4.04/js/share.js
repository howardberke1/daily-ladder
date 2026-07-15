// Builds the spoiler-free share text and hands it to the native share sheet
// (mobile) or the clipboard (desktop). Squares only — never the theme.
// Sixth square = the theme guess: 🟪 cracked it, ⬜/⬛ didn't.

const SQ = { green: "🟩", yellow: "🟨", gray: "⬜", purple: "🟪", empty: "⬜" };
const SQ_DARK = { green: "🟩", yellow: "🟨", gray: "⬛", purple: "🟪", empty: "⬛" };

export const MAX_SCORE = 18;

export function buildShareText({ number, score, results, themeCorrect, timeMs = null, dark }) {
  const s = dark ? SQ_DARK : SQ;
  const row = results.map((r) => s[r]).join("");
  const theme = themeCorrect ? s.purple : s.empty;
  const time = timeMs != null ? ` · ${fmtTime(timeMs)}` : "";
  return `Daily Ladder #${number} — ${score}/${MAX_SCORE}${time}\n${row} ${theme}\nhttps://dailyladder.app\n`;
}

function fmtTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export async function share(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
      // fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
