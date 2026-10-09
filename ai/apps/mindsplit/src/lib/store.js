/* localStorage, wrapped: it throws in private windows and can come back
   empty at any time, and nothing here may break when it does. */
export const load = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return fallback; }
};
export const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};
