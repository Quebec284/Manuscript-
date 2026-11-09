// Consent record + appearance preferences.
// The "Session cookies" choice decides where the sign-in session and preferences live:
//   accepted (or no choice yet) → localStorage  (stay signed in after closing the browser)
//   rejected                    → sessionStorage (signed out when the tab/browser is closed)
const CK = "mms_consent";
const safe = f => { try { return f(); } catch (e) { return null; } };

export const ACCENTS = {
  blue:   { name: "Blue",   hex: "#1F4E79" },
  green:  { name: "Green",  hex: "#15803d" },
  teal:   { name: "Teal",   hex: "#0f766e" },
  purple: { name: "Purple", hex: "#6d28d9" },
  orange: { name: "Orange", hex: "#c2410c" },
  rose:   { name: "Rose",   hex: "#be185d" }
};

export const getConsent = () => {
  const c = safe(() => JSON.parse(localStorage.getItem(CK)));
  return c && typeof c === "object" ? c : null;
};
export const cookiesRejected = () => (getConsent() || {}).cookies === "rejected";
const area = () => (cookiesRejected() ? sessionStorage : localStorage);
const other = () => (cookiesRejected() ? localStorage : sessionStorage);

// Moves the auth session and preferences to the storage that matches the current consent.
export function migrate() {
  safe(() => {
    const from = other(), to = area();
    Object.keys(from).filter(k => k.startsWith("mms-auth-") || k === "mms_theme" || k === "mms_accent").forEach(k => {
      const v = from.getItem(k); if (v !== null) to.setItem(k, v); from.removeItem(k);
    });
  });
}
export function saveConsent(c) {
  safe(() => localStorage.setItem(CK, JSON.stringify({ terms: c.terms, privacy: c.privacy, cookies: c.cookies, at: new Date().toISOString(), v: 1 })));
  migrate();
}

// Storage adapter handed to Supabase Auth (re-evaluated on every call, so a consent change applies at once).
export const authStorage = {
  getItem: k => safe(() => area().getItem(k)),
  setItem: (k, v) => safe(() => { area().setItem(k, v); other().removeItem(k); }),
  removeItem: k => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); })
};

/* ---------- appearance ---------- */
const pget = k => safe(() => area().getItem(k));
const pset = (k, v) => safe(() => { if (v == null) { localStorage.removeItem(k); sessionStorage.removeItem(k); } else { area().setItem(k, v); other().removeItem(k); } });
export const getMode = () => { const t = pget("mms_theme"); return t === "light" || t === "dark" ? t : "system"; };
export const getAccent = () => { const a = pget("mms_accent"); return ACCENTS[a] ? a : "blue"; };
export const isDark = () => { const m = getMode(); return m === "system" ? matchMedia("(prefers-color-scheme:dark)").matches : m === "dark"; };
export function applyAppearance() {
  const r = document.documentElement, m = getMode(), a = getAccent();
  if (m === "system") delete r.dataset.theme; else r.dataset.theme = m;
  if (a === "blue") delete r.dataset.accent; else r.dataset.accent = a;
}
export const setMode = m => { pset("mms_theme", m === "system" ? null : m); applyAppearance(); };
export const setAccent = a => { if (ACCENTS[a]) { pset("mms_accent", a === "blue" ? null : a); applyAppearance(); } };
