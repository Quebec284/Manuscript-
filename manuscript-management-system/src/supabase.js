import { createClient } from "@supabase/supabase-js";
import { CONFIG, configured } from "./config.js";
import { authStorage } from "./prefs.js";

// Public and admin portals use SEPARATE session storage keys so that signing in to one
// never signs you in to (or out of) the other, even on the same domain.
// The storage adapter honours the user's "session cookies" choice (see prefs.js).
export const makeClient = portal =>
  configured()
    ? createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
        auth: { storageKey: "mms-auth-" + portal, storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
