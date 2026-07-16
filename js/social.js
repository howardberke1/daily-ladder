// Friends (request/accept) and leaderboard queries. Every function returns
// { data, error } — never throws — so callers can render failures inline
// instead of needing try/catch everywhere.

import { supabase } from "./supabaseClient.js";
import { getUser } from "./auth.js";

function fail(error) {
  console.error(error);
  return { data: null, error: error?.message ?? "Something went wrong." };
}

/* ---------------- friends ---------------- */

export async function findProfileByUsername(username) {
  const clean = String(username).trim();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .ilike("username", clean)
    .maybeSingle();
  if (error) return fail(error);
  return { data, error: null };
}

export async function sendFriendRequest(addresseeId) {
  const me = getUser();
  if (!me) return fail({ message: "Sign in first." });
  if (addresseeId === me.id) return fail({ message: "That's you." });

  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: me.id, addressee_id: addresseeId });
  if (error) {
    if (error.code === "23505") return fail({ message: "Already sent, or already friends." });
    return fail(error);
  }
  return { data: true, error: null };
}

export async function respondToRequest(friendshipId, accept) {
  if (!accept) {
    const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
    if (error) return fail(error);
    return { data: true, error: null };
  }
  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", friendshipId);
  if (error) return fail(error);
  return { data: true, error: null };
}

export async function removeFriend(friendshipId) {
  const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (error) return fail(error);
  return { data: true, error: null };
}

/** Everything involving me: incoming requests, outgoing requests, accepted friends. */
export async function getMyFriendData() {
  const me = getUser();
  if (!me) return { data: { incoming: [], outgoing: [], friends: [] }, error: null };

  const { data, error } = await supabase
    .from("friendships")
    .select(`
      id, status, requester_id, addressee_id,
      requester:requester_id ( id, username ),
      addressee:addressee_id ( id, username )
    `)
    .or(`requester_id.eq.${me.id},addressee_id.eq.${me.id}`);

  if (error) return fail(error);

  const incoming = [];
  const outgoing = [];
  const friends = [];
  for (const row of data) {
    const iAmRequester = row.requester_id === me.id;
    const other = iAmRequester ? row.addressee : row.requester;
    if (row.status === "accepted") {
      friends.push({ friendshipId: row.id, profile: other });
    } else if (iAmRequester) {
      outgoing.push({ friendshipId: row.id, profile: other });
    } else {
      incoming.push({ friendshipId: row.id, profile: other });
    }
  }
  return { data: { incoming, outgoing, friends }, error: null };
}

/* ---------------- leaderboards ---------------- */

// Only what the board actually renders. Do NOT speculatively add columns here:
// PostgREST rejects the whole query if one is missing, so an unused field can
// take the entire leaderboard down until a migration runs. That exact bug shipped
// in 0.9.0 with `cosmetics`, which nothing on the board even displayed.
const PROFILE_FIELDS = "username";

export async function getGlobalLeaderboard(dateKey, limit = 20) {
  const { data, error } = await supabase
    .from("results")
    .select(`score, time_ms, theme_correct, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .eq("date_key", dateKey)
    .order("score", { ascending: false })
    .order("time_ms", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) return fail(error);
  return { data, error: null };
}

export async function getFriendsLeaderboard(dateKey) {
  const me = getUser();
  if (!me) return { data: [], error: null };

  const { data: friendData, error: fErr } = await getMyFriendData();
  if (fErr) return fail({ message: fErr });

  const ids = [me.id, ...friendData.friends.map((f) => f.profile.id)];
  const { data, error } = await supabase
    .from("results")
    .select(`score, time_ms, theme_correct, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .eq("date_key", dateKey)
    .in("user_id", ids)
    .order("score", { ascending: false })
    .order("time_ms", { ascending: true, nullsFirst: false });
  if (error) return fail(error);
  return { data, error: null };
}

export async function getAlltimeLeaderboard(limit = 20) {
  const { data, error } = await supabase
    .from("leaderboard_alltime")
    .select(`total_score, games_played, perfect_climbs, fastest_perfect_ms, user_id, profiles ( ${PROFILE_FIELDS} )`)
    .order("total_score", { ascending: false })
    .limit(limit);
  if (error) return fail(error);
  return { data, error: null };
}

/* ---------------- syncing a finished daily game ---------------- */

/**
 * Upserts today's result for the signed-in player. Called from game.js on
 * finish() for daily mode only — archive/practice never sync. Best-effort:
 * failures are logged, never shown to the player or allowed to block the
 * results screen.
 */
export async function syncResult({ dateKey, puzzleNumber, score, timeMs, themeCorrect, rungs }) {
  const me = getUser();
  if (!me) return { data: null, error: "not signed in" };

  const { error } = await supabase.from("results").upsert(
    {
      user_id: me.id,
      date_key: dateKey,
      puzzle_number: puzzleNumber,
      score,
      time_ms: timeMs,
      theme_correct: themeCorrect,
      rungs,
    },
    { onConflict: "user_id,date_key" }
  );
  if (error) return fail(error);
  return { data: true, error: null };
}
