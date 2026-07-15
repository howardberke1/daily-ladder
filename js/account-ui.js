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

const $ = (id) => document.getElementById(id);

const HELMETS = [
  { id: "default", label: "World", value: null },
  { id: "red", label: "Red", value: "#e05a3a" },
  { id: "blue", label: "Blue", value: "#4a90d9" },
  { id: "green", label: "Green", value: "#4fae62" },
  { id: "purple", label: "Purple", value: "#8458c9" },
  { id: "gold", label: "Gold", value: "#d8a02c" },
];
const PACKS = [
  { id: "default", label: "World", value: null },
  { id: "navy", label: "Navy", value: "#2c3e5e" },
  { id: "forest", label: "Forest", value: "#3a5a44" },
  { id: "rust", label: "Rust", value: "#8a4a30" },
  { id: "slate", label: "Slate", value: "#4a5568" },
  { id: "plum", label: "Plum", value: "#5e3a68" },
];

/* ---------------- cosmetics (local-first, syncs when signed in) ---------------- */

function getLocalCosmetics() {
  try { return JSON.parse(localStorage.getItem("tl:cosmetics")) ?? {}; }
  catch { return {}; }
}

function saveLocalCosmetics(c) {
  try { localStorage.setItem("tl:cosmetics", JSON.stringify(c)); } catch {}
}

export function applyCosmetics(c = getLocalCosmetics()) {
  const stage = $("climb-stage");
  if (!stage?.style?.setProperty) return;
  const helmet = HELMETS.find((h) => h.id === c.helmet)?.value;
  const pack = PACKS.find((p) => p.id === c.pack)?.value;
  if (helmet) stage.style.setProperty("--helmet", helmet);
  else stage.style.removeProperty("--helmet");
  if (pack) stage.style.setProperty("--pack", pack);
  else stage.style.removeProperty("--pack");
}

async function chooseCosmetic(kind, id) {
  const c = { ...getLocalCosmetics(), [kind]: id };
  saveLocalCosmetics(c);
  applyCosmetics(c);
  renderSwatches();
  if (getProfile()) {
    await updateCosmetics(kind === "helmet" ? { helmet_color: id } : { pack_color: id });
  }
}

function renderSwatches() {
  const c = getLocalCosmetics();
  const make = (hostId, list, kind) => {
    const host = $(hostId);
    if (!host) return;
    host.innerHTML = "";
    list.forEach((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + ((c[kind] ?? "default") === opt.id ? " picked" : "");
      b.title = opt.label;
      b.style.background = opt.value ?? "linear-gradient(135deg, #e05a3a, #4a90d9, #4fae62)";
      b.addEventListener("click", () => chooseCosmetic(kind, opt.id));
      host.appendChild(b);
    });
  };
  make("swatches-helmet", HELMETS, "helmet");
  make("swatches-pack", PACKS, "pack");
}

/* ---------------- account modal ---------------- */

function show(el, visible) { el?.classList.toggle("hidden", !visible); }

function renderAccountModal({ user, profile }) {
  show($("acct-signedout"), !user);
  show($("acct-username"), !!user && !profile);
  show($("acct-signedin"), !!user && !!profile);
  if (profile) $("acct-name").textContent = "@" + profile.username;
  renderSwatches();
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

  if (error) { host.innerHTML = `<p class="muted">Couldn't load the leaderboard right now.</p>`; return; }

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
  applyCosmetics();

  show($("btn-account"), true);
  show($("btn-leaderboard"), true);

  $("btn-account").addEventListener("click", () => {
    renderAccountModal({ user: getUser(), profile: getProfile() });
    $("modal-account").showModal();
  });
  $("btn-leaderboard").addEventListener("click", () => {
    $("modal-leaderboard").showModal();
    renderLeaderboard();
  });

  document.querySelectorAll(".lb-tab").forEach((t) =>
    t.addEventListener("click", () => { lbTab = t.dataset.tab; renderLeaderboard(); })
  );

  $("btn-magic").addEventListener("click", async () => {
    const res = await sendMagicLink($("acct-email").value);
    $("acct-msg").textContent = res.error ?? "Link sent — check your email and click it on this device.";
  });
  $("acct-email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-magic").click(); });

  $("btn-claim").addEventListener("click", async () => {
    const res = await claimUsername($("acct-user").value);
    if (res.error) $("acct-user-msg").textContent = res.error;
    else {
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
    // pull server cosmetics into local when a profile loads
    if (state.profile) {
      const c = getLocalCosmetics();
      const merged = {
        helmet: state.profile.helmet_color ?? c.helmet ?? "default",
        pack: state.profile.pack_color ?? c.pack ?? "default",
      };
      saveLocalCosmetics(merged);
      applyCosmetics(merged);
    }
  });
}
