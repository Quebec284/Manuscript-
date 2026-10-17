// Controller: authentication flow, navigation, actions, events and boot.
import { M, $, toast, download, mid, rl } from "./state.js";
import { CONFIG, configured } from "./config.js";
import { makeClient } from "./supabase.js";
import * as api from "./api.js";
import { render, res, aud, NAV } from "./views.js";

const S = M.st;
const pwOk = p => (p || "").length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const err = t => { const e = $("#lerr"); if (e) e.textContent = t; };
const msOf = id => M.db.ms.find(x => String(x.id) === String(id));
const sync = async () => { await api.refresh(); render(); };
const csvText = rows => rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

/* ---------- sign-in rules ---------- */
const CHOICE = { Author: "Author", Editor: "Editor", Other: "User" };
// Loads the profile for the current session and enforces portal + role-choice rules.
async function enterPortal(choice, email) {
  let p = await api.loadProfile();
  if (!p) { await M.sb.auth.signOut(); return "Your account profile was not found. Contact an administrator."; }
  const deny = async (action, msg) => { await api.logEvent(action, email || p.email, false); await M.sb.auth.signOut(); M.me = null; return msg; };
  if (!p.on) return deny("Login blocked (disabled)", "This account is disabled. Contact an administrator.");
  if (M.ADMIN && p.role !== "Administrator") return deny("Denied: non-admin on admin portal", "This portal is for administrators only.");
  if (!M.ADMIN) {
    if (p.role === "Administrator") return deny("Denied: admin on public portal", "Administrators must sign in through the admin portal.");
    const want = CHOICE[choice];
    if (choice && p.role !== want) {
      return deny("Denied: portal/role mismatch", p.role === "User"
        ? `Your account isn’t approved as ${want} yet. Sign in as “Other user” and request the role from your dashboard.`
        : `This account is registered as ${rl(p.role)}. Please choose “${rl(p.role)}”.`);
    }
  }
  M.me = p;
  await api.refresh();
  if (choice !== null) api.logEvent("Login", p.email);
  return "";
}

/* ---------- navigation with access control ---------- */
function go(v, id) {
  const me = M.me; if (!me) return;
  if (v === "detail") {
    const m = msOf(id), bad = !m || (me.role === "Author" && m.au !== me.id) || (me.role === "User" && m.status !== "Approved");
    if (bad) { api.logEvent("Access denied", "manuscript " + id, false); return toast("Access denied"); }
    S.sel = id;
  } else if (!["notif", "profile"].includes(v) && !NAV[me.role].some(n => n[0] === v)) {
    api.logEvent("Access denied", "page: " + v, false); toast("You don’t have access to that page"); v = "dash";
  }
  S.view = v; render(); scrollTo(0, 0);
}

/* ---------- actions (data-a="…") ---------- */
const A = {
  go: d => { S.q = { t: "", s: "", g: "" }; go(d.v); },
  flt: d => { S.q = { t: "", s: d.s, g: "" }; go("list"); },
  open: d => go("detail", d.id),
  mode: d => { S.mode = d.m; S.notice = ""; render(); },
  theme: () => {
    const r = document.documentElement, dk = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme:dark)").matches;
    r.dataset.theme = dk ? "light" : "dark"; try { localStorage.setItem("mms_theme", r.dataset.theme); } catch (e) { /* ignore */ }
  },
  out: async () => { await api.logEvent("Logout"); await M.sb.auth.signOut(); M.me = null; S.view = "dash"; S.mode = "login"; S.notice = ""; render(); },

  login: async () => {
    const email = $("#le").value.trim().toLowerCase(), pw = $("#lp").value;
    if (!email || !pw) return err("Enter your email and password.");
    const { error } = await M.sb.auth.signInWithPassword({ email, password: pw });
    if (error) return err(/invalid login/i.test(error.message) ? "Invalid email or password." : /not confirmed/i.test(error.message) ? "Please confirm your email first – check your inbox." : error.message);
    const msg = await enterPortal(($("#lr") || {}).value || "", email);
    if (msg) return err(msg);
    S.view = "dash"; S.notice = ""; render();
  },
  register: async () => {
    const name = $("#rn").value.trim(), email = $("#le").value.trim().toLowerCase(), pw = $("#lp").value, want = $("#rw").value;
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return err("Enter your name and a valid email.");
    if (!pwOk(pw)) return err("Password needs 8+ characters with at least one letter and one number.");
    const { data, error } = await M.sb.auth.signUp({ email, password: pw, options: { data: { full_name: name, requested_role: want === "Other" ? "" : want }, emailRedirectTo: location.origin + location.pathname } });
    if (error) return err(error.message);
    if (data.user && data.user.identities && data.user.identities.length === 0) return err("That email is already registered.");
    if (data.session) await M.sb.auth.signOut(); // always return to the sign-in screen
    const base = want === "Other" ? "Account created." : `Account created. Your ${want} request was sent to an administrator.`;
    S.mode = "login"; S.notice = base + (data.session ? " You can sign in now (use “Other user” until a role request is approved)." : " Check your email to confirm your address, then sign in (use “Other user” until a role request is approved)."); render();
  },
  forgot: async () => {
    const email = $("#fe").value.trim().toLowerCase(); if (!email) return err("Enter your email.");
    const { error } = await M.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return err(error.message);
    S.mode = "login"; S.notice = "If that account exists, a password reset link has been emailed."; render();
  },
  recover: async () => {
    const a = $("#pn").value, b = $("#pf").value;
    if (!pwOk(a)) return err("Password needs 8+ characters with at least one letter and one number.");
    if (a !== b) return err("The passwords do not match.");
    const { error } = await M.sb.auth.updateUser({ password: a }); if (error) return err(error.message);
    await M.sb.auth.signOut(); history.replaceState(null, "", location.pathname);
    M.me = null; S.recovery = false; S.mode = "login"; S.notice = "Password updated. Please sign in."; render();
  },
  roleReq: async d => { await api.rpc("request_role", { p_role: d.r }); M.me.req = { role: d.r, status: "Pending", date: new Date().toISOString() }; toast("Request sent to administrators"); render(); },
  saveName: async () => { const n = $("#pnm").value.trim(); await api.rpc("update_my_name", { p_name: n }); M.me.name = n; toast("Name updated"); render(); },
  pw: async () => {
    const cur = $("#pc").value, a = $("#pn").value, b = $("#pf").value;
    if (!pwOk(a)) return toast("New password needs 8+ characters with a letter and a number");
    if (a !== b) return toast("The new passwords do not match");
    if (a === cur) return toast("Choose a password different from the current one");
    const { error: e1 } = await M.sb.auth.signInWithPassword({ email: M.me.email, password: cur });
    if (e1) { api.logEvent("Failed password change", M.me.email, false); return toast("Current password is incorrect"); }
    const { error } = await M.sb.auth.updateUser({ password: a }); if (error) return toast(error.message);
    api.logEvent("Changed password"); toast("Password updated"); S.view = "dash"; render();
  },

  /* manuscripts */
  start: async d => { await api.rpc("start_review", { p_ms: Number(d.id) }); await sync(); },
  dec: async d => {
    const c = ($("#cm") || {}).value || "";
    if (d.d === "Returned" && !c.trim()) return toast("Add a comment explaining what to change");
    await api.rpc("decide_manuscript", { p_ms: Number(d.id), p_decision: d.d, p_comment: c }); toast("Decision recorded"); await sync();
  },
  sub: async d => { await api.rpc("submit_manuscript", { p_ms: Number(d.id) }); toast("Submitted for review"); await sync(); },
  rev: async d => { await api.reviseManuscript(d.id, $("#rf").files[0]); toast("Revision uploaded and resubmitted"); await sync(); },
  new: async d => {
    const t = $("#ut").value.trim(); if (!t) return toast("Enter a title");
    toast("Uploading…");
    const id = await api.createManuscript({ title: t, genre: $("#ug").value, kw: $("#uk").value.trim(), file: $("#uf").files[0], submit: d.d === "1" });
    await api.refresh(); toast(d.d === "1" ? "Submitted for review" : "Saved as draft"); go("detail", id);
  },
  dl: async d => {
    const m = msOf(d.id), v = m.v.find(x => String(x.n) === String(d.n));
    const url = await api.fileUrl(v.path, v.file); api.logEvent("Downloaded file", mid(m.id) + " v" + v.n); download(v.file, url);
  },

  /* notifications */
  readall: async () => { await api.rpc("mark_read", { p_id: null }); await sync(); },
  nopen: async d => {
    await api.rpc("mark_read", { p_id: Number(d.id) }); await api.refresh();
    const m = d.ms && msOf(d.ms); m ? go("detail", d.ms) : render();
  },

  /* administrator */
  tog: async d => { await api.rpc("set_user_active", { p_user: d.id, p_active: d.on !== "1" }); await sync(); },
  decide: async d => { await api.rpc("decide_role_request", { p_user: d.u, p_approve: d.d === "1" }); toast("Request " + (d.d === "1" ? "approved" : "rejected")); await sync(); },
  csv: d => {
    if (!["Editor", "Administrator"].includes(M.me.role)) return;
    const rows = d.k === "ms" ? [["ID", "Title", "Author", "Genre", "Status", "Versions", "Created", "Updated"], ...M.db.ms.map(m => [mid(m.id), m.title, m.an, m.genre, m.status, m.v.length, m.c, m.u])]
      : d.k === "us" && M.me.role === "Administrator" ? [["Name", "Email", "Role", "Active", "Created"], ...M.db.users.map(u => [u.name, u.email, rl(u.role), u.on, u.c])]
      : d.k === "au" && M.me.role === "Administrator" ? [["Time", "User", "Action", "Item", "Result"], ...M.db.au.map(a => [a.t, a.u, a.a, a.m, a.ok ? "Success" : "Failed"])] : null;
    if (!rows) return;
    api.logEvent("Exported report", d.k); download({ ms: "manuscripts", us: "users", au: "audit-log" }[d.k] + ".csv", csvText(rows), "text/csv");
  }
};

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-a]");
  if (!t || !A[t.dataset.a]) return;
  e.preventDefault();
  Promise.resolve().then(() => A[t.dataset.a](t.dataset, t)).catch(x => toast(x.message || String(x)));
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.c === "role") {
    api.rpc("set_user_role", { p_user: t.dataset.id, p_role: t.value }).then(() => { toast("Role updated"); return sync(); }).catch(x => { toast(x.message); sync(); });
  } else if (t.id === "qs" || t.id === "qg") { S.q.s = $("#qs").value; S.q.g = $("#qg").value; $("#res").innerHTML = res(); }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "qt") { S.q.t = t.value; $("#res").innerHTML = res(); }
  else if (t.id === "aq") { S.af = t.value; $("#ar2").innerHTML = aud(); }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || !["le", "lp", "rn", "fe", "pn", "pf"].includes(e.target.id)) return;
  const b = $("[data-a=login],[data-a=register],[data-a=forgot],[data-a=recover]"); b && b.click();
});

/* ---------- boot ---------- */
export async function boot(portal) {
  M.ADMIN = portal === "admin";
  try { const th = localStorage.getItem("mms_theme"); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignore */ }
  document.title = (M.ADMIN ? "Administrator Portal – " : "") + CONFIG.appName;
  if (!configured()) { M.cfgErr = true; render(); return; }
  M.sb = makeClient(portal);
  if (/type=recovery/.test(location.hash)) S.recovery = true;
  M.sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") { S.recovery = true; render(); } });
  try {
    const { data: { session } } = await M.sb.auth.getSession();
    if (session && !S.recovery) { const msg = await enterPortal(null); if (msg) S.notice = msg; }
  } catch (e) { S.notice = "Could not reach the server: " + e.message; }
  render();
  // Light polling keeps dashboards fresh without disturbing forms.
  setInterval(async () => {
    if (!M.me || document.hidden || S.recovery || document.querySelector("input:focus,textarea:focus,select:focus,.mo")) return;
    if (!["dash", "list", "catalog", "notif", "users", "reqs", "rep"].includes(S.view)) return;
    try { await api.refresh(); render(); } catch (e) { /* offline: ignore */ }
  }, 30000);
}
