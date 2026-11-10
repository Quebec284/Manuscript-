import { createClient } from "@supabase/supabase-js";
import { CONFIG, configured } from "./config.js";
import { authStorage } from "./prefs.js";

export const makeClient = portal =>
  configured()
    ? createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
        auth: { storageKey: "mms-auth-" + portal, storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
