
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const env = n => (process.env[n] || "").trim();
const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const email = env("ADMIN_EMAIL").toLowerCase();
const password = env("ADMIN_PASSWORD");
const name = env("ADMIN_NAME") || "System Administrator";

const fail = m => { console.error("✖ " + m); process.exit(1); };
if (!url || url.includes("YOUR-PROJECT")) fail("Set VITE_SUPABASE_URL (or SUPABASE_URL) in .env");
if (!key || key.startsWith("YOUR-")) fail("Set SUPABASE_SERVICE_ROLE_KEY in .env (Supabase → Project Settings → API → service_role)");
if (!/^\S+@\S+\.\S+$/.test(email)) fail("Set a valid ADMIN_EMAIL in .env");
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) fail("ADMIN_PASSWORD needs 8+ characters with at least one letter and one number");

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUser() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail("Could not list users: " + error.message);
    const hit = data.users.find(u => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

let user = await findUser();
if (!user) {
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) fail("Could not create the administrator: " + error.message);
  user = data.user; console.log("✔ Created administrator account " + email);
} else {
  const { error } = await sb.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) fail("Could not update the administrator: " + error.message);
  console.log("✔ Administrator already existed – password updated for " + email);
}

const { error } = await sb.from("profiles").upsert(
  { id: user.id, full_name: name, email, role: "Administrator", active: true, requested_role: null, request_status: null },
  { onConflict: "id" });
if (error) fail("Could not set the Administrator role (did you run supabase/schema.sql first?): " + error.message);
console.log("✔ Role set to Administrator. Sign in at /admin/ with " + email);
