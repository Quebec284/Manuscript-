// All runtime settings come from environment variables (see .env.example).
// Vite replaces import.meta.env.VITE_* at build time; only VITE_* values reach the browser.
const e = import.meta.env;
export const CONFIG = {
  appName: e.VITE_APP_NAME || "Manuscript Management System",
  supabaseUrl: (e.VITE_SUPABASE_URL || "").trim(),
  anonKey: (e.VITE_SUPABASE_ANON_KEY || "").trim(),
  maxFileMb: Math.min(Math.max(Number(e.VITE_MAX_FILE_MB) || 10, 1), 50),
  allowedTypes: ["docx", "doc", "pdf", "txt"],
  bucket: "manuscripts"
};
export const configured = () => /^https?:\/\/.+/.test(CONFIG.supabaseUrl) && CONFIG.anonKey.length > 20 && !CONFIG.supabaseUrl.includes("YOUR-PROJECT");
