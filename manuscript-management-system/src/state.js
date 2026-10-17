// Shared application state and small utilities.
export const M = {
  ADMIN: false, sb: null, me: null, cfgErr: false,
  db: { users: [], ms: [], nt: [], au: [] },
  st: { view: "dash", sel: null, q: { t: "", s: "", g: "" }, af: "", mode: "login", notice: "", recovery: false }
};
export const $ = (s, e = document) => e.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fm = t => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
export const mid = id => "MS-" + String(id).padStart(3, "0");
export const rl = r => (r === "User" ? "Other user" : r);
let th;
export const toast = m => {
  const t = $("#toast"); if (!t) return;
  t.textContent = m; t.className = "show"; clearTimeout(th); th = setTimeout(() => (t.className = ""), 3200);
};
export const download = (name, text, type = "text/plain") => {
  const a = document.createElement("a");
  a.href = typeof text === "string" && /^https?:|^blob:|^data:/.test(text) ? text : URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
};
