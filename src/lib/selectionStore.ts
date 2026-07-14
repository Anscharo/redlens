// Local-only "Document Selection" set — the ids of docs a user has picked
// for a collection/export flow. Lives in localStorage; versioned so future
// shape changes can be migrated (or discarded) safely.

export const STORAGE_KEY = "redline-sky-atlas:selection";

interface PersistedSelection {
  v: 1;
  ids: string[];
}

export function loadSelection(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedSelection>;
    if (parsed.v !== 1 || !Array.isArray(parsed.ids)) return [];
    return [...new Set(parsed.ids)];
  } catch {
    return [];
  }
}

export function saveSelection(ids: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PersistedSelection = { v: 1, ids };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore (quota, privacy mode, etc.)
  }
}
