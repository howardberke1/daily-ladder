// Supabase client. Loaded straight from a CDN as an ES module — no bundler,
// consistent with the rest of this static site.
//
// The publishable key below is safe to ship in client code by design: it can
// only do what Row Level Security in supabase/schema.sql allows (read public
// profiles/results, write only rows the signed-in user owns). It is NOT the
// secret key — that one must never appear in frontend code.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ehwzcmdkevdaxuflublh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tCuw9X3ucnpkLZaF_TzgOg_lpLTmVBQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
