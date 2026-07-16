// Account state: magic-link sign-in (no passwords), session tracking, and
// the one-time username setup that creates a profiles row.

import { supabase } from "./supabaseClient.js";

let currentUser = null;
let currentProfile = null;
const listeners = new Set();

/** Subscribe to auth/profile changes. Returns an unsubscribe function. */
export function onAuthChange(fn) {
  listeners.add(fn);
  fn({ user: currentUser, profile: currentProfile });
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn({ user: currentUser, profile: currentProfile });
}

export function getUser() {
  return currentUser;
}

export function getProfile() {
  return currentProfile;
}

/** Turns Supabase's raw auth errors into something a player can act on. */
function humanizeAuthError(message = "") {
  const m = message.toLowerCase();
  if (m.includes("not authorized")) {
    return "Sign-in email couldn't be delivered — the site's email isn't fully set up yet. Ward, this means custom SMTP isn't configured in Supabase.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many sign-in attempts right now. Give it a few minutes and try again.";
  }
  if (m.includes("invalid") && m.includes("email")) {
    return "That email address doesn't look right — double-check the spelling.";
  }
  return message || "Something went wrong sending the link. Try again in a moment.";
}

/** Send a magic sign-in link to an email address. */
export async function sendMagicLink(email) {
  const clean = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { error: "That doesn't look like a valid email." };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) {
    console.error("Magic link failed:", error);
    return { error: humanizeAuthError(error.message) };
  }
  return { ok: true };
}

export async function signOut() {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  notify();
}

/** Claim a username for the signed-in user, creating their profile row. */
export async function claimUsername(username) {
  const clean = String(username).trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(clean)) {
    return { error: "3–20 characters: letters, numbers, and underscores only." };
  }
  if (!currentUser) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("profiles")
    .insert({ id: currentUser.id, username: clean })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return { error: "That username is taken." };
    return { error: error.message };
  }
  currentProfile = data;
  notify();
  return { ok: true, profile: data };
}

/** Saves the whole climber as one jsonb blob — new parts need no migration. */
export async function updateCosmetics(cosmetics) {
  if (!currentUser || !currentProfile) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ cosmetics })
    .eq("id", currentUser.id)
    .select()
    .single();

  if (error) {
    console.error("Cosmetics sync failed:", error);
    return { error: error.message };
  }
  currentProfile = data;
  notify();
  return { ok: true, profile: data };
}

async function loadProfile(userId) {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  currentProfile = data ?? null;
}

/** Call once at boot. Restores any existing session and starts listening. */
export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;
  if (currentUser) await loadProfile(currentUser.id);
  notify();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user ?? null;
    currentProfile = null;
    if (currentUser) await loadProfile(currentUser.id);
    notify();
  });
}
