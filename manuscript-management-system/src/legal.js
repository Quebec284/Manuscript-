// Terms of Service, Privacy Policy and Session Cookies notice (shown in a dialog).
import { CONFIG } from "./config.js";
import { esc } from "./state.js";

export const LEGAL_TITLES = { terms: "Terms of Service", privacy: "Privacy Policy", cookies: "Session Cookies" };
const N = () => esc(CONFIG.appName);

const DOCS = {
  terms: () => `
<p class="mu">Last updated: November 2026</p>
<p>Welcome to <b>${N()}</b>, a school project for submitting, reviewing and approving manuscripts. By creating an account you agree to these terms. You can still create an account if you decline, but the rules below describe how the service is run for everybody.</p>
<h4>1. Accounts and roles</h4>
<p>Everyone starts as an <i>Other user</i>. Author and Editor roles must be approved by an administrator, who may also change, disable or remove accounts that break these terms. Keep your password private; you are responsible for activity on your account.</p>
<h4>2. Your content</h4>
<p>You keep ownership of every manuscript you upload. You confirm that you have the right to share it and that it does not infringe anyone else’s rights or contain unlawful material. Uploading gives editors and administrators permission to read and review it. Once a manuscript is finally approved, its title, author name, genre and keywords are visible to signed-in users in the catalog.</p>
<h4>3. How approval works</h4>
<p>Submitted manuscripts are reviewed by an editor. An editor’s approval is not final: an administrator must give final approval before a manuscript is shown as Approved on dashboards and in the catalog. Either may return a manuscript to you with comments.</p>
<h4>4. Acceptable use</h4>
<p>Do not attempt to bypass access controls, upload malware, harass others or disrupt the service. Activity such as sign-ins, uploads, decisions and denied access is recorded in an audit log for security.</p>
<h4>5. No warranty</h4>
<p>This is a student project provided “as is”, without guarantees of availability or that data will never be lost. Keep your own copy of every file you upload.</p>
<h4>6. Changes and contact</h4>
<p>These terms may be updated; the date above will change. Questions? Contact the site administrator.</p>`,
  privacy: () => `
<p class="mu">Last updated: November 2026</p>
<p>This policy explains what <b>${N()}</b> collects and why. You can still create an account if you decline this policy; the data below is needed for the service to work at all.</p>
<h4>What we collect</h4>
<ul><li><b>Account data:</b> your name, email address, role and a securely hashed password (handled by Supabase Auth).</li>
<li><b>Manuscripts:</b> the files, titles, genres, keywords, version history and review comments you submit.</li>
<li><b>Activity:</b> notifications and an audit log (sign-ins, uploads, decisions, denied access) with timestamps.</li>
<li><b>Your choices:</b> whether you accepted the Terms, this Policy and Session Cookies.</li></ul>
<h4>How it is used</h4>
<p>Only to run the manuscript workflow: signing you in, showing you your own work, routing it to editors and administrators, and keeping the service secure. We do not sell your data and do not show advertising.</p>
<h4>Who can see it</h4>
<ul><li>Authors see only their own manuscripts.</li><li>Editors see submitted manuscripts (not drafts).</li><li>Administrators see accounts, manuscripts and the audit log.</li>
<li>Other users see only finally approved manuscripts (no files).</li></ul>
<h4>Where it is stored</h4>
<p>Data is stored with Supabase (database, authentication and private file storage). Files are in a private bucket and downloaded through short-lived links.</p>
<h4>Your rights</h4>
<p>You can edit your name and email and change your password in <b>Settings</b>, download a copy of your data from <b>Settings → Privacy</b>, and change your consent choices at any time. To have your account removed, ask an administrator.</p>`,
  cookies: () => `
<p class="mu">Last updated: November 2026</p>
<p>${N()} uses a small amount of browser storage. It does not use advertising or tracking cookies. You can still create an account whichever option you choose.</p>
<h4>If you accept session cookies</h4>
<p>Your sign-in session is kept in this browser so you stay signed in after closing it (until you log out or the session expires). Your colour and light/dark preferences are remembered on this device.</p>
<h4>If you reject session cookies</h4>
<p>Your sign-in lasts only for the current browser tab/window and is cleared when you close it, so you will sign in again next time. Your appearance preferences are also forgotten when you close it.</p>
<h4>What is always stored</h4>
<p>A single entry that remembers your Accept/Reject choice, so we do not ask again on this device. Sign-in itself cannot work without a session, which is why a temporary one is always used.</p>
<p>You can change this choice at any time in <b>Settings → Privacy &amp; cookies</b>.</p>`
};

export function openLegal(kind) {
  if (!DOCS[kind]) return;
  closeLegal();
  const d = document.createElement("div");
  d.className = "mo"; d.id = "legal"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
  d.innerHTML = `<div class="cd lgl"><div class="row"><h2 class="sp" style="margin:0">${LEGAL_TITLES[kind]}</h2><button class="ic" data-a="closeLegal" aria-label="Close">✕</button></div><div class="lb">${DOCS[kind]()}</div><button class="bt w" data-a="closeLegal">Close</button></div>`;
  document.body.appendChild(d);
}
export const closeLegal = () => { const d = document.getElementById("legal"); if (d) d.remove(); };
