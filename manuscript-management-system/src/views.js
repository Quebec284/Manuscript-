// Page renderers (HTML strings) for every role.
import { M, $, esc, fm, mid, rl } from "./state.js";
import { CONFIG } from "./config.js";

const ST = ["Draft", "Submitted", "Under Review", "Returned", "Approved"];
const BC = { Draft: "g", Submitted: "b", "Under Review": "y", Returned: "r", Approved: "gr", Pending: "y", Rejected: "r" };
const bd = s => `<span class="bd ${BC[s] || "g"}">${s}</span>`;

export const NAV = {
  Author: [["dash", "🏠", "Home"], ["list", "📁", "Mine"], ["upload", "⬆️", "Upload"]],
  Editor: [["dash", "🏠", "Home"], ["list", "📁", "Manuscripts"], ["rep", "📊", "Reports"]],
  User: [["dash", "🏠", "Home"], ["catalog", "📚", "Catalog"]],
  Administrator: [["dash", "🏠", "Home"], ["users", "👥", "Users"], ["reqs", "📝", "Requests"], ["list", "📁", "Manuscripts"], ["rep", "📊", "Audit"]]
};
export const TT = { dash: "Dashboard", list: "Manuscripts", catalog: "Approved catalog", detail: "Manuscript details", upload: "Upload manuscript", notif: "Notifications", users: "Users & roles", reqs: "Requests", rep: "Reports", profile: "My profile" };

/* ---------- helpers ---------- */
const T = (h, r) => r.length
  ? `<div class="tw"><table><thead><tr>${h.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${r.map(x => `<tr>${x.map((c, i) => `<td data-l="${h[i]}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  : `<p class="mu">Nothing to show yet.</p>`;
const cnt = (a, f) => a.reduce((o, x) => ((o[f(x)] = (o[f(x)] || 0) + 1), o), {});
const byS = l => { const o = Object.fromEntries(ST.map(s => [s, 0])); l.forEach(m => o[m.status]++); return o; };
const bars = o => { const m = Math.max(1, ...Object.values(o)); return Object.entries(o).map(([k, v]) => `<div class="br"><span>${esc(k)}</span><i><u style="width:${v / m * 100}%"></u></i><b>${v}</b></div>`).join("") || '<p class="mu">No data.</p>'; };
const kpi = (l, v, s, go) => `<div class="cd kp" ${s ? `data-a="flt" data-s="${s}"` : go ? `data-a="go" data-v="${go}"` : ""}><small>${l}</small><h2>${v}</h2></div>`;
const mine = () => { const me = M.me, ms = M.db.ms; return me.role === "Author" ? ms.filter(m => m.au === me.id) : me.role === "User" ? ms.filter(m => m.status === "Approved") : ms; };
const ml = L => T(["ID", "Title", "Author", "Genre", "Status", "Ver.", "Updated", ""], L.slice().sort((a, b) => String(b.u).localeCompare(String(a.u))).map(m => [mid(m.id), `<b>${esc(m.title)}</b>`, esc(m.an), esc(m.genre), bd(m.status), m.v.length ? "v" + m.v.length : "—", fm(m.u), `<button class="bt s sm" data-a="open" data-id="${m.id}">View</button>`]));
const act = () => `<div class="cd"><h3>Recent activity</h3>${T(["Time", "User", "Action", "Item"], M.db.au.slice(0, 6).map(a => [fm(a.t), esc(a.u), esc(a.a), esc(a.m)]))}</div>`;
export const res = () => { const q = M.st.q, t = q.t.toLowerCase(); return ml(mine().filter(m => (!q.s || m.status === q.s) && (!q.g || m.genre === q.g) && (!t || (m.title + m.an + m.kw + mid(m.id)).toLowerCase().includes(t)))); };
export const aud = () => { const t = M.st.af.toLowerCase(); return T(["Time", "User", "Action", "Item", "Result"], M.db.au.filter(a => !t || (a.u + a.a + a.m).toLowerCase().includes(t)).slice(0, 100).map(a => [fm(a.t), esc(a.u), esc(a.a), esc(a.m), a.ok ? '<span class="bd gr">Success</span>' : '<span class="bd r">Failed / denied</span>'])); };
const reqBlock = () => {
  const me = M.me, rq = me.req, opts = ["Author", "Editor"].filter(r => r !== me.role);
  return `${rq ? `<p>Role request: <b>${rq.role}</b> ${bd(rq.status)} <small class="mu">${fm(rq.date)}</small></p>` : ""}${!rq || rq.status !== "Pending" ? `<div class="row">${opts.map(r => `<button class="bt s sm" data-a="roleReq" data-r="${r}">Request ${r} role</button>`).join("")}</div><p class="hint">An administrator reviews every request.</p>` : '<p class="hint">Waiting for an administrator to review your request.</p>'}`;
};

/* ---------- pages ---------- */
export const V = {};
V.dash = () => {
  const me = M.me, L = mine(), s = byS(L), db = M.db; let h = `<h2>Welcome, ${esc(me.name.split(" ")[0])} 👋</h2>`;
  if (me.role === "Author") {
    h += `<div class="g">${kpi("My manuscripts", L.length)}${kpi("Under review", s["Under Review"], "Under Review")}${kpi("Needs revision", s.Returned, "Returned")}${kpi("Approved", s.Approved, "Approved")}</div>`;
    const r = L.filter(m => m.status === "Returned");
    if (r.length) h += `<div class="cd al">⚠️ Returned for revision: ${r.map(m => `<a data-a="open" data-id="${m.id}">${esc(m.title)}</a>`).join(", ")}</div>`;
    h += `<div class="cd"><h3>My recent manuscripts</h3>${ml(L.slice(0, 5))}</div>`;
  } else if (me.role === "Editor") {
    h += `<div class="g">${kpi("Awaiting review", s.Submitted, "Submitted")}${kpi("Under review", s["Under Review"], "Under Review")}${kpi("Approved", s.Approved, "Approved")}${kpi("Returned", s.Returned, "Returned")}</div><div class="g2"><div class="cd"><h3>Pipeline</h3>${bars(s)}</div><div class="cd"><h3>Review queue</h3>${ml(L.filter(m => ["Submitted", "Under Review"].includes(m.status)))}</div></div>`;
  } else if (me.role === "User") {
    h += `<div class="cd"><h3>Your account</h3><p>You are signed in as a standard user. You can browse approved manuscripts in the catalog. To submit or review manuscripts, request a role below.</p>${reqBlock()}</div><div class="cd"><h3>Latest approved manuscripts</h3>${ml(L.slice(0, 5))}</div>`;
  } else {
    const pq = db.users.filter(u => u.req && u.req.status === "Pending").length, sa = byS(db.ms);
    if (pq) h += `<div class="cd al">🔔 ${pq} role request(s) need action. <a data-a="go" data-v="reqs">Review now</a></div>`;
    h += `<div class="g">${kpi("Users", db.users.length, "", "users")}${kpi("Pending requests", pq, "", "reqs")}${kpi("Manuscripts", db.ms.length, "", "list")}${kpi("Failed / denied events", db.au.filter(a => !a.ok).length, "", "rep")}</div><div class="g2"><div class="cd"><h3>Users by role</h3>${bars(cnt(db.users, u => rl(u.role)))}</div><div class="cd"><h3>Pipeline</h3>${bars(sa)}</div></div>${act()}`;
  }
  return h;
};
V.list = () => {
  const me = M.me, q = M.st.q, gs = [...new Set(M.db.ms.map(m => m.genre))], A = me.role === "Author", U = me.role === "User";
  return `<div class="row"><h2 class="sp">${A ? "My manuscripts" : U ? "Approved catalog" : "Manuscript repository"}</h2>${A ? '<button class="bt" data-a="go" data-v="upload">+ New</button>' : U ? "" : '<button class="bt s" data-a="csv" data-k="ms">Export CSV</button>'}</div><div class="cd"><input id="qt" placeholder="Search title, author, keyword…" value="${esc(q.t)}"><div class="g2"><select id="qs" ${U ? "hidden" : ""}><option value="">All statuses</option>${ST.map(s => `<option ${q.s === s ? "selected" : ""}>${s}</option>`).join("")}</select><select id="qg"><option value="">All genres</option>${gs.map(s => `<option ${q.g === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div></div><div class="cd" id="res">${res()}</div>`;
};
V.catalog = V.list;
V.detail = () => {
  const me = M.me, m = M.db.ms.find(x => String(x.id) === String(M.st.sel)), ed = me.role === "Editor", au = me.role === "Author" && m.au === me.id, U = me.role === "User", l = m.v.at(-1);
  let h = `<button class="bt s sm" data-a="go" data-v="${U ? "catalog" : "list"}" style="margin-bottom:10px">← Back</button><div class="cd"><div class="row"><h2 class="sp">${esc(m.title)}</h2>${bd(m.status)}</div><p class="mu">${mid(m.id)} · ${esc(m.an)} · ${esc(m.genre)} · ${esc(m.kw || "no keywords")}<br>Created ${fm(m.c)}${l ? ` · Current version v${l.n}` : ""}</p>`;
  if (ed && m.status === "Submitted") h += `<button class="bt" data-a="start" data-id="${m.id}">Start review</button>`;
  if (ed && ["Submitted", "Under Review"].includes(m.status)) h += `<label>Editor comment (required to return)</label><textarea id="cm" rows="3"></textarea><div class="row"><button class="bt ok" data-a="dec" data-d="Approved" data-id="${m.id}">✓ Approve</button><button class="bt bad" data-a="dec" data-d="Returned" data-id="${m.id}">↩ Return for revision</button></div>`;
  if (au && m.status === "Draft") h += `<button class="bt" data-a="sub" data-id="${m.id}">Submit for review</button>`;
  if (au && m.status === "Returned") h += `<label>Upload revised version (${CONFIG.allowedTypes.join(", ")} · max ${CONFIG.maxFileMb} MB)</label><input type="file" id="rf" accept=".docx,.doc,.pdf,.txt"><button class="bt" data-a="rev" data-id="${m.id}">Upload &amp; resubmit</button>`;
  h += "</div>";
  if (U) return h;
  return h + `<div class="cd"><h3>Version history</h3>${T(["Version", "File", "Size", "Uploaded", "By", ""], m.v.slice().reverse().map(v => [`v${v.n}${v === l ? " ★ current" : ""}`, esc(v.file), Math.max(1, Math.round(v.size / 1024)) + " KB", fm(v.date), esc(m.an), `<button class="bt s sm" data-a="dl" data-id="${m.id}" data-n="${v.n}">Download</button>`]))}</div><div class="cd"><h3>Review history</h3>${m.cm.length ? m.cm.map(c => `<p><b>${esc(c.by)}</b> ${bd(c.dec)} <small>${fm(c.t)}</small><br>${esc(c.txt)}</p>`).join("") : '<p class="mu">No review comments yet.</p>'}</div>`;
};
V.upload = () => `<h2>Submit a manuscript</h2><div class="cd"><label>Title</label><input id="ut" maxlength="200"><div class="g2"><div><label>Genre</label><select id="ug">${["Fiction", "Non-fiction", "Thriller", "Romance", "Poetry", "Folklore", "Academic", "Other"].map(x => `<option>${x}</option>`).join("")}</select></div><div><label>Keywords</label><input id="uk" placeholder="comma separated"></div></div><label>Manuscript file (${CONFIG.allowedTypes.join(", ")} · max ${CONFIG.maxFileMb} MB)</label><input type="file" id="uf" accept=".docx,.doc,.pdf,.txt"><div class="row"><button class="bt" data-a="new" data-d="1">Submit for review</button><button class="bt s" data-a="new" data-d="0">Save as draft</button></div></div>`;
V.notif = () => {
  const L = M.db.nt;
  return `<div class="row"><h2 class="sp">Notifications</h2><button class="bt s" data-a="readall">Mark all read</button></div><div class="cd">${L.length ? L.slice(0, 60).map(n => `<div class="nt ${n.r ? "" : "un"}" data-a="nopen" data-id="${n.id}" data-ms="${n.ms || ""}"><span>${esc(n.msg)}</span><small>${fm(n.t)}</small></div>`).join("") : '<p class="mu">No notifications.</p>'}</div>`;
};
V.profile = () => {
  const me = M.me;
  return `<h2>My profile</h2><div class="cd"><label>Full name</label><input id="pnm" value="${esc(me.name)}" maxlength="80"><p class="mu">${esc(me.email)} · <span class="bd b">${rl(me.role)}</span></p><button class="bt s sm" data-a="saveName">Save name</button>${me.role === "Administrator" ? "" : `<h3 style="margin-top:14px">Role</h3>${reqBlock()}`}</div><div class="cd"><h3>Change password</h3><label>Current password</label><input id="pc" type="password" autocomplete="current-password"><label>New password</label><input id="pn" type="password" autocomplete="new-password"><label>Confirm new password</label><input id="pf" type="password" autocomplete="new-password"><p class="hint">8+ characters with at least one letter and one number.</p><button class="bt" data-a="pw">Update password</button></div>`;
};
V.users = () => `<h2>User &amp; role management</h2><p class="hint">People create their own accounts on the public page; assign or change their role here. Disabled accounts cannot sign in or read any data.</p><div class="cd">${T(["Name", "Email", "Role", "Status", ""], M.db.users.map(u => [esc(u.name) + (u.req && u.req.status === "Pending" ? ` ${bd("Pending")}` : ""), esc(u.email), `<select data-c="role" data-id="${u.id}" ${u.id === M.me.id ? "disabled" : ""}>${["Author", "Editor", "User", "Administrator"].map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${rl(r)}</option>`).join("")}</select>`, u.on ? '<span class="bd gr">Active</span>' : '<span class="bd r">Disabled</span>', u.id === M.me.id ? "" : `<button class="bt sm ${u.on ? "bad" : "ok"}" data-a="tog" data-id="${u.id}" data-on="${u.on ? 1 : 0}">${u.on ? "Disable" : "Enable"}</button>`]))}</div>`;
V.reqs = () => {
  const rq = M.db.users.filter(u => u.req && u.req.status === "Pending");
  return `<h2>Role requests</h2><div class="cd">${T(["Name", "Email", "Current", "Requested", "Date", ""], rq.map(u => [esc(u.name), esc(u.email), rl(u.role), `<b>${u.req.role}</b>`, fm(u.req.date), `<button class="bt ok sm" data-a="decide" data-u="${u.id}" data-d="1">Approve</button> <button class="bt s bad sm" data-a="decide" data-u="${u.id}" data-d="0">Reject</button>`]))}</div>`;
};
V.rep = () => {
  const ad = M.me.role === "Administrator", L = M.db.ms;
  return `<div class="row"><h2 class="sp">${ad ? "Reports &amp; audit trail" : "Reports"}</h2><button class="bt s" data-a="csv" data-k="ms">Export manuscripts</button>${ad ? '<button class="bt s" data-a="csv" data-k="us">Export users</button><button class="bt s" data-a="csv" data-k="au">Export audit</button>' : ""}</div><div class="g2"><div class="cd"><h3>By status</h3>${bars(byS(L))}</div><div class="cd"><h3>By genre</h3>${bars(cnt(L, m => m.genre))}</div></div>` +
    (ad ? `<div class="cd"><div class="row"><h3 class="sp">Audit trail (latest 300 events)</h3><input id="aq" placeholder="Filter user / action…" value="${esc(M.st.af)}" style="max-width:240px"></div><div id="ar2">${aud()}</div></div>` : "");
};

/* ---------- login / register / forgot / recovery ---------- */
const setup = () => `<div class="lg"><div class="cd lc"><div class="logo">⚙️</div><h2 style="text-align:center">Setup required</h2><p>This site isn’t connected to Supabase yet.</p><ol class="hint"><li>Copy <code>.env.example</code> to <code>.env</code>.</li><li>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li><li>Restart <code>npm run dev</code> (or rebuild / re-deploy).</li></ol><p class="hint">See the README for the full setup.</p></div></div>`;
const loginUI = () => {
  const s = M.st, A = M.ADMIN, back = '<p class="mu" style="text-align:center"><a data-a="mode" data-m="login">← Back to sign in</a></p>';
  let h = `<div class="lg"><div class="cd lc"><div class="logo">${A ? "🛡️" : "📖"}</div><h2 style="text-align:center;margin:8px 0 2px">${A ? "Administrator Portal" : esc(CONFIG.appName)}</h2><p class="mu" style="text-align:center;margin-top:0">${A ? "Authorised administrators only" : s.recovery ? "Set a new password" : s.mode === "register" ? "Create your account" : "Sign in to continue"}</p>${s.notice ? `<div class="cd ok-n">${esc(s.notice)}</div>` : ""}`;
  if (s.recovery) h += `<label>New password</label><input id="pn" type="password" autocomplete="new-password"><label>Confirm new password</label><input id="pf" type="password" autocomplete="new-password"><p class="hint">8+ characters with a letter and a number.</p><div id="lerr" class="er"></div><button class="bt w" data-a="recover">Save new password</button>`;
  else if (s.mode === "forgot") h += `<label>Account email</label><input id="fe" type="email" autocomplete="username"><div id="lerr" class="er"></div><button class="bt w" data-a="forgot">Email me a reset link</button>${back}`;
  else if (s.mode === "register") h += `<label>Full name</label><input id="rn" autocomplete="name"><label>Email</label><input id="le" type="email" autocomplete="username"><label>Password</label><input id="lp" type="password" autocomplete="new-password"><p class="hint">8+ characters with a letter and a number.</p><label>I want to join as</label><select id="rw"><option value="Author">Author</option><option value="Editor">Editor</option><option value="Other">Other user</option></select><p class="hint">Author and Editor roles are approved by an administrator. Until then, sign in as “Other user”.</p><div id="lerr" class="er"></div><button class="bt w" data-a="register">Create account</button>${back}`;
  else h += `${A ? "" : '<label>Sign in as</label><select id="lr"><option value="Author">Author</option><option value="Editor">Editor</option><option value="Other">Other user</option></select>'}<label>Email</label><input id="le" type="email" autocomplete="username"><label>Password</label><input id="lp" type="password" autocomplete="current-password"><div id="lerr" class="er"></div><button class="bt w" data-a="login">Log in</button><p class="mu" style="text-align:center"><a data-a="mode" data-m="forgot">Forgot password?</a>${A ? "" : ' · <a data-a="mode" data-m="register">Create account</a>'}</p>`;
  return h + "</div></div>";
};

export function render() {
  const app = $("#app"), me = M.me, s = M.st;
  if (M.cfgErr) { app.innerHTML = setup(); return; }
  if (!me || s.recovery) { app.innerHTML = loginUI(); return; }
  const un = M.db.nt.filter(n => !n.r).length;
  app.innerHTML = `<div class="app"><nav><b>📖 ManuscriptMS</b>${NAV[me.role].map(n => `<a class="${s.view === n[0] || (s.view === "detail" && (n[0] === "list" || n[0] === "catalog")) ? "on" : ""}" data-a="go" data-v="${n[0]}">${n[1]}<span>${n[2]}</span></a>`).join("")}</nav><main><div class="top"><b class="sp">${TT[s.view]}</b><span class="bd b">${rl(me.role)}</span><span class="hm">${esc(me.name)}</span><button class="ic" data-a="go" data-v="notif" title="Notifications">🔔${un ? " " + un : ""}</button><button class="ic" data-a="go" data-v="profile" title="Profile">👤</button><button class="ic" data-a="theme" title="Toggle theme">🌓</button><button class="ic" data-a="out" title="Log out">⎋</button></div><div class="wrap">${V[s.view]()}</div></main></div>`;
}
