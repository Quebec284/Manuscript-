// Data access: every write goes through a SECURITY DEFINER database function (see supabase/schema.sql).
import { M, mid } from "./state.js";
import { CONFIG } from "./config.js";

const unwrap = r => { if (r.error) throw new Error(r.error.message); return r.data; };
export const rpc = async (fn, args = {}) => unwrap(await M.sb.rpc(fn, args));
export const logEvent = (action, item, ok = true) => M.sb.rpc("log_event", { p_action: action, p_item: item || null, p_ok: ok }).then(() => {}, () => {});

const mapUser = p => ({ id: p.id, name: p.full_name, email: p.email, role: p.role, on: p.active, c: p.created_at,
  req: p.requested_role ? { role: p.requested_role, status: p.request_status, date: p.request_date } : null });
const mapMs = m => ({
  id: m.id, title: m.title, au: m.author_id, an: m.author_name, genre: m.genre, kw: m.keywords || "", status: m.status, c: m.created_at, u: m.updated_at,
  v: (m.manuscript_versions || []).slice().sort((a, b) => a.version_number - b.version_number).map(v => ({ n: v.version_number, file: v.file_name, size: v.file_size, date: v.created_at, path: v.file_path })),
  cm: (m.reviews || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map(r => ({ by: r.editor_name, t: r.created_at, txt: r.comments, dec: r.decision }))
});

export async function loadProfile() {
  const { data: { session } } = await M.sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await M.sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapUser(data) : null;
}

export async function refresh() {
  const me = M.me, adm = me.role === "Administrator", none = Promise.resolve({ data: [] });
  const [ms, nt, us, au] = await Promise.all([
    M.sb.from("manuscripts").select("*, manuscript_versions(*), reviews(*)").order("updated_at", { ascending: false }).limit(1000),
    M.sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
    adm ? M.sb.from("profiles").select("*").order("created_at", { ascending: false }).limit(1000) : none,
    adm ? M.sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300) : none
  ]);
  [ms, nt, us, au].forEach(r => { if (r.error) throw new Error(r.error.message); });
  M.db.ms = ms.data.map(mapMs);
  M.db.nt = nt.data.map(n => ({ id: n.id, msg: n.message, ms: n.manuscript_id, t: n.created_at, r: n.is_read }));
  M.db.users = adm ? us.data.map(mapUser) : [me];
  M.db.au = au.data.map(a => ({ u: a.user_name, a: a.action, m: a.item || "—", t: a.created_at, ok: a.success }));
}

/* ---------- files ---------- */
const MIME = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" };
export function validateFile(f) {
  if (!f) throw new Error("Choose a file first");
  const x = f.name.split(".").pop().toLowerCase();
  if (!CONFIG.allowedTypes.includes(x)) throw new Error("File type not allowed (use " + CONFIG.allowedTypes.join(", ") + ")");
  if (f.size > CONFIG.maxFileMb * 1048576) throw new Error("File exceeds the " + CONFIG.maxFileMb + " MB limit");
  if (f.size === 0) throw new Error("The file is empty");
}
const upload = async (path, file) => {
  const x = file.name.split(".").pop().toLowerCase();
  const { error } = await M.sb.storage.from(CONFIG.bucket).upload(path, file, { contentType: MIME[x], upsert: false });
  if (error) throw new Error(error.message);
};
export async function createManuscript({ title, genre, kw, file, submit }) {
  validateFile(file);
  const r = await rpc("create_manuscript", { p_title: title, p_genre: genre, p_keywords: kw, p_file_name: file.name, p_file_size: file.size });
  const row = Array.isArray(r) ? r[0] : r;
  try { await upload(row.ms_path, file); } catch (e) { await rpc("discard_manuscript", { p_ms: row.ms_id }).catch(() => {}); throw e; }
  if (submit) await rpc("submit_manuscript", { p_ms: row.ms_id });
  return row.ms_id;
}
export async function reviseManuscript(id, file) {
  validateFile(file);
  const path = await rpc("add_version", { p_ms: Number(id), p_file_name: file.name, p_file_size: file.size });
  try { await upload(path, file); } catch (e) { await rpc("discard_version", { p_ms: Number(id) }).catch(() => {}); throw e; }
  await rpc("submit_manuscript", { p_ms: Number(id) });
}
export async function fileUrl(path, name) {
  const { data, error } = await M.sb.storage.from(CONFIG.bucket).createSignedUrl(path, 60, { download: name });
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
export { mid };
