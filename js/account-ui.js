// Account, friends, cosmetics, and leaderboard UI. Loaded lazily by main.js —
// if the Supabase CDN is unreachable, the game still runs fully offline and
// the account/trophy buttons simply hide themselves.

import { initAuth, onAuthChange, sendMagicLink, signOut, claimUsername, updateCosmetics, getProfile, getUser } from "./auth.js";
import {
  findProfileByUsername, sendFriendRequest, respondToRequest, removeFriend,
  getMyFriendData, getGlobalLeaderboard, getFriendsLeaderboard, getAlltimeLeaderboard,
  syncResult,
} from "./social.js";
import { todayKey } from "./puzzles.js";
import { toast, formatTime } from "./game.js";
import { track } from "./analytics.js";

const $ = (id) => document.getElementById(id);

import { CATALOG } from "./climber.js";
import {
  getCosmetics, saveCosmetics, setCosmetics, randomize, resetCosmetics, mountClimber,
} from "./cosmetics.js";
import { renderClimber } from "./climber.js";

/* ---------------- customizer ---------------- */

export { mountClimber };

/** Kept for main.js's call site; the rig now handles itself. */
export function applyCosmetics() {
  mountClimber();
}

function renderPreview() {
  const host = $("cos-preview");
  if (!host) return;
  host.innerHTML = renderClimber(getCosmetics(), { className: "climber preview-climber" });
}

/**
 * Builds the whole customizer from CATALOG — this function has no hardcoded
 * knowledge of the character, so adding a new part or color is a catalog edit.
 */
function renderParts() {
  const host = $("cos-parts");
  if (!host) return;
  const cos = getCosmetics();
  host.innerHTML = "";

  for (const part of CATALOG) {
    const row = document.createElement("div");
    row.className = "cos-row";

    const label = document.createElement("p");
    label.className = "cos-label";
    label.textContent = part.label;
    row.appendChild(label);

    const opts = document.createElement("div");
    opts.className = part.kind === "color" ? "swatches" : "chips";

    if (part.kind === "color") {
      part.colors.forEach((color) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "swatch" + (cos[part.id] === color ? " picked" : "");
        b.style.background = color;
        b.setAttribute("aria-label", `${part.label} ${color}`);
        b.addEventListener("click", () => choose(part.id, color));
        opts.appendChild(b);
      });
    } else {
      part.options.forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (cos[part.id] === opt.id ? " picked" : "");
        b.textContent = opt.label;
        b.addEventListener("click", () => choose(part.id, opt.id));
        opts.appendChild(b);
      });
    }

    row.appendChild(opts);
    host.appendChild(row);
  }
}

function choose(partId, value) {
  track("cosmetic_change", { part: partId });
  saveCosmetics({ [partId]: value });
  renderPreview();
  renderParts();
  syncCosmetics();
}

/** Pushes the current look to the signed-in profile. Silent no-op if signed out. */
async function syncCosmetics() {
  if (!getProfile()) return;
  const res = await updateCosmetics(getCosmetics());
  // Optional feature: if the cosmetics column isn't migrated yet, the look
  // still works locally. Log it, don't nag, and never block anything else.
  if (res?.error) console.warn("Cosmetics not synced (run migration-002):", res.error);
}

/* ---------------- account modal ---------------- */

function show(el, visible) { el?.classList.toggle("hidden", !visible); }

function renderAccountModal({ user, profile }) {
  show($("acct-signedout"), !user);
  show($("acct-username"), !!user && !profile);
  show($("acct-signedin"), !!user && !!profile);
  if (profile) $("acct-name").textContent = "@" + profile.username;
  renderPreview();
  renderParts();
  if (user && profile) refreshFriends();
}

async function refreshFriends() {
  const { data, error } = await getMyFriendData();
  const host = $("friends-area");
  if (!host) return;
  if (error) { host.innerHTML = `<p class="muted">Couldn't load friends right now.</p>`; return; }

  host.innerHTML = "";
  const section = (title, items, render) => {
    if (!items.length) return;
    const h = document.createElement("p");
    h.className = "friends-heading";
    h.textContent = title;
    host.appendChild(h);
    items.forEach((item) => host.appendChild(render(item)));
  };

  section("Requests for you", data.incoming, ({ friendshipId, profile }) => {
    const row = document.createElement("div");
    row.className = "friend-row";
    row.innerHTML = `<span>@${profile.username}</span>`;
    const yes = btn("Accept", async () => { await respondToRequest(friendshipId, true); refreshFriends(); });
    const no = btn("Decline", async () => { await respondToRequest(friendshipId, false); refreshFriends(); });
    no.classList.add("quiet");
    row.append(yes, no);
    return row;
  });

  section("Sent — waiting", data.outgoing, ({ friendshipId, profile }) => {
    const row = document.createElement("div");
    row.className = "friend-row";
    row.innerHTML = `<span>@${profile.username}</span><span class="muted pending-note">pending</span>`;
    const cancel = btn("Cancel", async () => { await removeFriend(friendshipId); refreshFriends(); });
    cancel.classList.add("quiet");
    row.append(cancel);
    return row;
  });

  section("Friends", data.friends, ({ friendshipId, profile }) => {
    const row = document.createElement("div");
    row.className = "friend-row";
    row.innerHTML = `<span>@${profile.username}</span>`;
    const rm = btn("Remove", async () => { await removeFriend(friendshipId); refreshFriends(); });
    rm.classList.add("quiet");
    row.append(rm);
    return row;
  });

  if (!data.incoming.length && !data.outgoing.length && !data.friends.length) {
    host.innerHTML = `<p class="muted">No friends yet — search a username above to send a request.</p>`;
  }
}

function btn(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-mini";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/* ---------------- leaderboard modal ---------------- */

let lbTab = "global";

async function renderLeaderboard() {
  document.querySelectorAll(".lb-tab").forEach((t) =>
    t.classList.toggle("on", t.dataset.tab === lbTab)
  );
  const host = $("lb-list");
  host.innerHTML = `<p class="muted lb-loading">Loading…</p>`;

  let rows = [];
  let error = null;
  let mode = lbTab;
  if (lbTab === "global") ({ data: rows, error } = await getGlobalLeaderboard(todayKey()));
  else if (lbTab === "friends") ({ data: rows, error } = await getFriendsLeaderboard(todayKey()));
  else ({ data: rows, error } = await getAlltimeLeaderboard());

  if (error) {
    console.error("Leaderboard load failed:", error);
    host.innerHTML =
      `<p class="muted">Couldn't load the leaderboard.</p>` +
      `<p class="lb-err">${String(error).slice(0, 160)}</p>`;
    return;
  }

  host.innerHTML = "";
  if (!rows?.length) {
    host.innerHTML = mode === "friends" && !getUser()
      ? `<p class="muted">Sign in and add friends to see this board.</p>`
      : `<p class="muted">No climbs on this board yet — be the first.</p>`;
    return;
  }

  const myId = getUser()?.id;
  rows.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "lb-row" + (r.user_id === myId ? " me" : "");
    const name = r.profiles?.username ? "@" + r.profiles.username : "anonymous";
    const right = mode === "alltime"
      ? `${r.total_score} pts · ${r.games_played} climbs${r.perfect_climbs ? ` · ${r.perfect_climbs}×18` : ""}`
      : `${r.score}/18${r.theme_correct ? " 🟪" : ""}${r.time_ms != null ? ` · ${formatTime(r.time_ms)}` : ""}`;
    row.innerHTML = `<span class="lb-rank">${i + 1}</span><span class="lb-name">${name}</span><span class="lb-score">${right}</span>`;
    host.appendChild(row);
  });

  if (!getUser()) {
    const note = document.createElement("p");
    note.className = "muted lb-note";
    note.textContent = "Sign in to put your climbs on the board.";
    host.appendChild(note);
  }
}

/* ---------------- daily result sync ---------------- */

export async function handleDailyFinish(payload) {
  if (!getUser() || !getProfile()) {
    toast("Sign in to post this climb to the leaderboard");
    return false;
  }
  const { error } = await syncResult({
    dateKey: payload.dateKey,
    puzzleNumber: payload.puzzleNumber,
    score: payload.score,
    timeMs: payload.timeMs,
    themeCorrect: payload.themeCorrect,
    rungs: payload.rungs,
  });
  if (error) {
    console.error("Leaderboard sync failed:", error);
    toast("Couldn't post to the leaderboard — " + error);
    return false;
  }
  toast("Climb posted to the leaderboard");
  return true;
}

/* ---------------- boot ---------------- */

export async function initAccountUI() {
  await initAuth();
  mountClimber();

  $("btn-cos-random").addEventListener("click", () => {
    track("cosmetic_change", { part: "randomize" });
    randomize();
    renderPreview();
    renderParts();
    syncCosmetics();
  });
  $("btn-cos-reset").addEventListener("click", () => {
    resetCosmetics();
    renderPreview();
    renderParts();
    syncCosmetics();
  });

  show($("btn-account"), true);
  show($("btn-leaderboard"), true);

  $("btn-account").addEventListener("click", () => {
    track("account_open", { state: getProfile() ? "signed_in" : getUser() ? "needs_username" : "signed_out" });
    renderAccountModal({ user: getUser(), profile: getProfile() });
    $("modal-account").showModal();
  });
  $("btn-leaderboard").addEventListener("click", () => {
    track("leaderboard_open", { tab: lbTab });
    $("modal-leaderboard").showModal();
    renderLeaderboard();
  });

  document.querySelectorAll(".lb-tab").forEach((t) =>
    t.addEventListener("click", () => { lbTab = t.dataset.tab; renderLeaderboard(); })
  );

  $("btn-magic").addEventListener("click", async () => {
    const btn = $("btn-magic");
    const msg = $("acct-msg");
    btn.disabled = true;
    btn.textContent = "Sending…";
    msg.textContent = "";
    msg.className = "muted acct-msg";

    track("signin_link_requested");
    const res = await sendMagicLink($("acct-email").value);

    btn.disabled = false;
    btn.textContent = "Send link";
    if (res.error) {
      msg.textContent = res.error;
      msg.className = "acct-msg is-error";
    } else {
      msg.textContent = "Link sent. Check your email (including spam) and open it on this device.";
      msg.className = "acct-msg is-ok";
    }
  });
  $("acct-email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-magic").click(); });

  $("btn-claim").addEventListener("click", async () => {
    const res = await claimUsername($("acct-user").value);
    if (res.error) $("acct-user-msg").textContent = res.error;
    else {
      track("username_claimed");
      $("acct-user-msg").textContent = "";
      renderAccountModal({ user: getUser(), profile: getProfile() });
      toast("Welcome to the ladder, @" + res.profile.username);
    }
  });

  $("btn-signout").addEventListener("click", async () => {
    await signOut();
    renderAccountModal({ user: null, profile: null });
  });

  $("btn-friend-search").addEventListener("click", async () => {
    const msg = $("friend-search-msg");
    const { data, error } = await findProfileByUsername($("friend-search").value);
    if (error) { msg.textContent = error; return; }
    if (!data) { msg.textContent = "No one by that name."; return; }
    const res = await sendFriendRequest(data.id);
    msg.textContent = res.error ?? `Request sent to @${data.username}.`;
    if (!res.error) refreshFriends();
  });

  onAuthChange((state) => {
    const authed = !!(state.user && state.profile);
    $("btn-account")?.classList.toggle("authed", authed);

    // A saved profile wins on sign-in, so your climber follows you across
    // devices. A signed-in player with no saved look yet keeps their local one
    // and pushes it up.
    if (state.profile) {
      const saved = state.profile.cosmetics; // undefined pre-migration — fine
      if (saved && Object.keys(saved).length) setCosmetics(saved);
      else syncCosmetics();
      renderPreview();
      renderParts();
    }
  });
}
