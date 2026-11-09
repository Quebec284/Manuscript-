// Controller: authentication flow, navigation, actions, events and boot.
import { M, $, toast, download, mid, rl } from "./state.js";
import { CONFIG, configured } from "./config.js";
import { makeClient } from "./supabase.js";
import * as api from "./api.js";
import { render, res, aud, NAV } from "./views.js";
import { openLegal, closeLegal } from "./legal.js";
import { getConsent, saveConsent, applyAppearance, setMode, setAccent, isDark } from "./prefs.js";

const S = M.st;
const pwOk = p => (p || "").length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const err = t => { const e = $("#lerr"); if (e) e.textContent = t; };
const msOf = id => M.db.ms.find(x => String(x.id) === String(id));
const sync = async () => { await api.refresh(); render(); };
// CSV: quote every cell and neutralise spreadsheet formulas (=, +, -, @) so exports are safe to open in Excel.
const csvCell = c => { let s = String(c ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
const csvText = rows => "\ufeff" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
const readConsent = prefix => {
  const c = {};
  for (const k of ["terms", "privacy", "cookies"]) { const el = document.querySelector(`input[name="${prefix}${k}"]:checked`); if (!el) return null; c[k] = el.value; }
  return c;
};

/* ---------- sign-in / sign-out ---------- */
const CHOICE = { Author: "Author", Editor: "Editor", Other: "User" };
// Signs out without triggering the "session ended" handler, then returns to the sign-in screen.
async function quit(notice = "", isErr = false, scope = "local") {
  M.leaving = true;
  try { await M.sb.auth.signOut({ scope }); } catch (e) { /* already signed out */ }
  M.leaving = false;
  M.me = null; M.db = { users: [], ms: [], nt: [], au: [] };
  S.view = "dash"; S.sel = null; S.mode = "login"; S.recovery = false; S.q = { t: "", s: "", g: "" }; S.notice = notice; S.nerr = isErr;
  render();
}
// Loads the profile for the current session and enforces portal + role-choice rules.
async function enterPortal(choice, email) {
  const p = await api.loadProfile();
  const quiet = async () => { M.leaving = true; try { await M.sb.auth.signOut(); } catch (e) { /* ignore */ } M.leaving = false; M.me = null; };
  if (!p) { await quiet(); return "Your account profile was not found. Contact an administrator."; }
  const deny = async (action, msg) => { await api.logEvent(action, email || p.email, false); await quiet(); return msg; };
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
  // Carry the account's consent choice to this device if it has none (so "reject session cookies" is honoured).
  if (p.consent && !getConsent()) saveConsent({ terms: p.consent.terms, privacy: p.consent.privacy, cookies: p.consent.cookies });
  await api.refresh();
  if (choice !== null) api.logEvent("Login", p.email);
  return "";
}
// Re-checks the signed-in profile (role changes, disabled accounts). Returns false if the user was signed out.
async function checkSession() {
  if (!M.me || S.recovery) return true;
  const p = await api.loadProfile();
  if (!p || !p.on) { await quit(p ? "Your account has been disabled. Contact an administrator." : "Your session has ended. Please sign in again.", true); return false; }
  if ((M.ADMIN && p.role !== "Administrator") || (!M.ADMIN && p.role === "Administrator")) { await quit("This account can’t use this portal.", true); return false; }
  if (p.role !== M.me.role) {
    M.me = p; toast("Your role is now " + rl(p.role));
    if (!["notif", "settings", "profile"].includes(S.view) && !NAV[p.role].some(n => n[0] === S.view)) S.view = "dash";
    await api.refresh(); render();
  } else M.me = p;
  return true;
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
  legal: d => openLegal(d.k),
  closeLegal: () => closeLegal(),
  consentAll: d => document.querySelectorAll('input[name^="c-"]').forEach(i => { i.checked = i.value === d.v; }),

  /* appearance */
  theme: () => { setMode(isDark() ? "light" : "dark"); if (S.view === "settings" || S.view === "profile") render(); },
  setmode: d => { setMode(d.m); render(); },
  accent: d => { setAccent(d.c); render(); },

  out: async () => { await api.logEvent("Logout"); await quit(); },
  outAll: async () => { await api.logEvent("Logout (all devices)"); await quit("You were signed out on all devices.", false, "global"); },

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
    const consent = readConsent("c-");
    if (!consent) return err("Please choose Accept or Reject for the Terms of Service, Privacy Policy and Session Cookies.");
    saveConsent(consent); // applies the session-cookie choice immediately; the account is created either way
    const { data, error } = await M.sb.auth.signUp({ email, password: pw, options: { data: { full_name: name, requested_role: want === "Other" ? "" : want, consent }, emailRedirectTo: location.origin + location.pathname } });
    if (error) return err(error.message);
    if (data.user && data.user.identities && data.user.identities.length === 0) return err("That email is already registered.");
    if (data.session) { M.leaving = true; try { await M.sb.auth.signOut(); } catch (e) { /* ignore */ } M.leaving = false; } // always return to the sign-in screen
    const base = want === "Other" ? "Account created." : `Account created. Your ${want} request was sent to an administrator.`;
    S.mode = "login"; S.nerr = false; S.notice = base + (data.session ? " You can sign in now (use “Other user” until a role request is approved)." : " Check your email to confirm your address, then sign in (use “Other user” until a role request is approved)."); render();
  },
  forgot: async () => {
    const email = $("#fe").value.trim().toLowerCase(); if (!email) return err("Enter your email.");
    const { error } = await M.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return err(error.message);
    S.mode = "login"; S.nerr = false; S.notice = "If that account exists, a password reset link has been emailed."; render();
  },
  recover: async () => {
    const a = $("#pn").value, b = $("#pf").value;
    if (!pwOk(a)) return err("Password needs 8+ characters with at least one letter and one number.");
    if (a !== b) return err("The passwords do not match.");
    const { error } = await M.sb.auth.updateUser({ password: a }); if (error) return err(error.message);
    history.replaceState(null, "", location.pathname + location.search);
    await quit("Password updated. Please sign in.");
  },

  /* settings */
  roleReq: async d => { await api.rpc("request_role", { p_role: d.r }); M.me.req = { role: d.r, status: "Pending", date: new Date().toISOString() }; toast("Request sent to administrators"); render(); },
  saveName: async () => {
    const n = $("#pnm").value.trim(); if (!n) return toast("Name cannot be empty");
    await api.rpc("update_my_name", { p_name: n }); M.me.name = n; toast("Name updated"); await sync();
  },
  saveEmail: async () => {
    const email = $("#pem").value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Enter a valid email address");
    if (email === M.me.email) return toast("That is already your email");
    const { error } = await M.sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
    if (error) return toast(error.message);
    api.logEvent("Requested email change", email); toast("Confirmation link sent – check your inbox to finish the change");
  },
  pw: async () => {
    const cur = $("#pc").value, a = $("#pn").value, b = $("#pf").value;
    if (!cur) return toast("Enter your current password");
    if (!pwOk(a)) return toast("New password needs 8+ characters with a letter and a number");
    if (a !== b) return toast("The new passwords do not match");
    if (a === cur) return toast("Choose a password different from the current one");
    const { error: e1 } = await M.sb.auth.signInWithPassword({ email: M.me.email, password: cur });
    if (e1) { api.logEvent("Failed password change", M.me.email, false); return toast("Current password is incorrect"); }
    const { error } = await M.sb.auth.updateUser({ password: a }); if (error) return toast(error.message);
    api.logEvent("Changed password"); toast("Password updated"); render();
  },
  consentSave: async () => {
    const c = readConsent("s-"); if (!c) return toast("Choose Accept or Reject for each item");
    await api.rpc("update_my_consent", { p_terms: c.terms === "accepted", p_privacy: c.privacy === "accepted", p_cookies: c.cookies === "accepted" });
    saveConsent(c); M.me.consent = { ...c, at: new Date().toISOString() };
    toast(c.cookies === "rejected" ? "Saved. You’ll be signed out when you close the browser." : "Choices saved"); render();
  },
  exportMe: () => {
    const me = M.me, data = { exportedAt: new Date().toISOString(), profile: { name: me.name, email: me.email, role: me.role, consent: me.consent || getConsent() },
      manuscriptsYouAuthored: M.db.ms.filter(m => m.au === me.id), notifications: M.db.nt };
    api.logEvent("Exported own data"); download("my-data.json", JSON.stringify(data, null, 2), "application/json");
  },

  /* manuscripts */
  start: async d => { await api.rpc("start_review", { p_ms: Number(d.id) }); await sync(); },
  dec: async d => {
    const c = ($("#cm") || {}).value || "";
    if (d.d === "Returned" && !c.trim()) return toast("Add a comment explaining what to change");
    await api.rpc("decide_manuscript", { p_ms: Number(d.id), p_decision: d.d, p_comment: c });
    toast(d.d === "Approved" ? "Approved – sent to an administrator for final approval" : "Returned to the author"); await sync();
  },
  fin: async d => {
    const c = ($("#cm") || {}).value || "";
    if (d.d === "Returned" && !c.trim()) return toast("Add a comment explaining what to change");
    await api.rpc("final_decision", { p_ms: Number(d.id), p_decision: d.d, p_comment: c });
    toast(d.d === "Approved" ? "Final approval granted – manuscript is now published" : "Returned to the author"); await sync();
  },
  sub: async d => { await api.rpc("submit_manuscript", { p_ms: Number(d.id) }); toast("Submitted for review"); await sync(); },
  del: async d => {
    if (!confirm("Delete this draft and its file? This cannot be undone.")) return;
    await api.deleteDraft(d.id); toast("Draft deleted"); await api.refresh(); go("list");
  },
  rev: async d => { await api.reviseManuscript(d.id, $("#rf").files[0]); toast("Revision uploaded and resubmitted"); await sync(); },
  new: async d => {
    const t = $("#ut").value.trim(); if (!t) return toast("Enter a title");
    toast("Uploading…");
    try {
      const id = await api.createManuscript({ title: t, genre: $("#ug").value, kw: $("#uk").value.trim(), file: $("#uf").files[0], submit: d.d === "1" });
      await api.refresh(); toast(d.d === "1" ? "Submitted for review" : "Saved as draft"); go("detail", id);
    } catch (e) {
      if (e.msId) { await api.refresh(); toast("Saved as draft, but submitting failed: " + e.message); return go("detail", e.msId); }
      throw e;
    }
  },
  dl: async d => {
    const m = msOf(d.id), v = m && m.v.find(x => String(x.n) === String(d.n)); if (!v) return toast("File not found");
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
      : d.k === "us" && M.me.role === "Administrator" ? [["Name", "Email", "Role", "Active", "Terms", "Privacy", "Cookies", "Created"], ...M.db.users.map(u => [u.name, u.email, rl(u.role), u.on, u.consent ? u.consent.terms : "", u.consent ? u.consent.privacy : "", u.consent ? u.consent.cookies : "", u.c])]
      : d.k === "au" && M.me.role === "Administrator" ? [["Time", "User", "Action", "Item", "Result"], ...M.db.au.map(a => [a.t, a.u, a.a, a.m, a.ok ? "Success" : "Failed"])] : null;
    if (!rows) return;
    api.logEvent("Exported report", d.k); download({ ms: "manuscripts", us: "users", au: "audit-log" }[d.k] + ".csv", csvText(rows), "text/csv");
  }
};

/* ---------- events ---------- */
document.addEventListener("click", e => {
  if (e.target.classList && e.target.classList.contains("mo")) return closeLegal(); // click on the dialog backdrop
  const t = e.target.closest("[data-a]");
  if (!t || !A[t.dataset.a]) return;
  e.preventDefault();
  if (t.dataset.busy) return; // ignore double-clicks while an action is running
  t.dataset.busy = "1"; if (t.tagName === "BUTTON") t.disabled = true;
  Promise.resolve().then(() => A[t.dataset.a](t.dataset, t)).catch(x => toast(x.message || String(x)))
    .finally(() => { delete t.dataset.busy; if (t.tagName === "BUTTON") t.disabled = false; });
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
  if (e.key === "Escape") return closeLegal();
  if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
  const id = e.target.id, click = sel => { const b = $(sel); b && b.click(); };
  if (!M.me || S.recovery) { if (["le", "lp", "rn", "fe", "pn", "pf"].includes(id)) click("[data-a=login],[data-a=register],[data-a=forgot],[data-a=recover]"); }
  else if (["pc", "pn", "pf"].includes(id)) click("[data-a=pw]");
  else if (id === "pnm") click("[data-a=saveName]");
  else if (id === "pem") click("[data-a=saveEmail]");
});

/* ---------- boot ---------- */
export async function boot(portal) {
  M.ADMIN = portal === "admin";
  applyAppearance();
  document.title = (M.ADMIN ? "Administrator Portal – " : "") + CONFIG.appName;
  if (!configured()) { M.cfgErr = true; render(); return; }
  M.sb = makeClient(portal);
  // Read the link parameters first: Supabase removes them from the URL once it has used them.
  const hp = new URLSearchParams(location.hash.replace(/^#/, "")), qp = new URLSearchParams(location.search);
  const linkErr = hp.get("error_description") || qp.get("error_description"), linkMsg = hp.get("message");
  if (hp.get("type") === "recovery") S.recovery = true;
  M.sb.auth.onAuthStateChange(ev => {
    if (ev === "PASSWORD_RECOVERY") { S.recovery = true; render(); }
    else if (ev === "SIGNED_OUT" && M.me && !M.leaving) { // expired / revoked / signed out in another tab
      M.me = null; S.view = "dash"; S.mode = "login"; S.notice = "Your session has ended. Please sign in again."; S.nerr = true; render();
    }
  });
  try {
    const { data: { session } } = await M.sb.auth.getSession();
    if (linkErr) { S.notice = linkErr.replace(/\+/g, " ") + (/expired|invalid/i.test(linkErr) ? " Request a new link and try again." : ""); S.nerr = true; S.recovery = false; }
    else if (linkMsg) { S.notice = linkMsg; S.nerr = false; }
    if (linkErr || linkMsg) history.replaceState(null, "", location.pathname);
    if (session && !S.recovery) { const msg = await enterPortal(null); if (msg) { S.notice = msg; S.nerr = true; } }
    else if (S.recovery && !session) { S.recovery = false; S.notice = "This reset link is invalid or has expired. Request a new one."; S.nerr = true; }
  } catch (e) { S.notice = "Could not reach the server: " + e.message; S.nerr = true; }
  render();
  // Light polling keeps dashboards fresh (and notices role changes / disabled accounts) without disturbing forms.
  const tick = async () => {
    if (!M.me || document.hidden || S.recovery || document.querySelector("input:focus,textarea:focus,select:focus,.mo")) return;
    try {
      if (!(await checkSession())) return;
      if (["dash", "list", "catalog", "notif", "users", "reqs", "rep", "appr"].includes(S.view)) { await api.refresh(); render(); }
    } catch (e) { /* offline: ignore */ }
  };
  setInterval(tick, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}
