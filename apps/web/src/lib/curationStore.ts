// Local-only inventory of "mark as NonProcess" decisions captured from the
// processes report. Lives in localStorage; exported as a decisions file that
// scripts/aux/processes-apply-decisions.mjs accepts directly.

const KEY = "processes:local-ignores";

export interface LocalIgnore {
  uuid: string;
  reason: string;
  marked_at: string;
}

export function loadLocalIgnores(): LocalIgnore[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as LocalIgnore[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalIgnores(marks: LocalIgnore[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(marks));
}

export const STORAGE_KEY = KEY;

// Shape consumed by scripts/aux/processes-apply-decisions.mjs.
export function toDecisionsJson(marks: LocalIgnore[]): string {
  const decisions = marks.map((m) => ({
    uuid: m.uuid,
    verdict: "ignore" as const,
    reason: m.reason,
  }));
  return JSON.stringify(decisions, null, 2) + "\n";
}
