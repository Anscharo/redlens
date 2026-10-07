// Web Storage access that never throws. Reaching `localStorage` itself can
// throw (blocked site data, sandboxed frames), as can reads, writes and quota,
// so every helper catches and reports failure as `null` / `false`.

export type StorageKind = "local" | "session";

const area = (kind: StorageKind): Storage => (kind === "session" ? sessionStorage : localStorage);

/** The stored string, or `null` when absent or storage is unavailable. */
export function readString(key: string, kind: StorageKind = "local"): string | null {
  try {
    return area(kind).getItem(key);
  } catch {
    return null;
  }
}

/** True when the value was stored. */
export function writeString(key: string, value: string, kind: StorageKind = "local"): boolean {
  try {
    area(kind).setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The parsed JSON value, or `null` when absent, unparseable or storage is unavailable. */
export function readJson<T = unknown>(key: string, kind: StorageKind = "local"): T | null {
  const raw = readString(key, kind);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** True when the value was serialised and stored. */
export function writeJson(key: string, value: unknown, kind: StorageKind = "local"): boolean {
  try {
    return writeString(key, JSON.stringify(value), kind);
  } catch {
    return false;
  }
}

/** The stored base-10 integer, or `null` when absent, not a number or storage is unavailable. */
export function readInt(key: string, kind: StorageKind = "local"): number | null {
  const n = parseInt(readString(key, kind) ?? "", 10);
  return Number.isFinite(n) ? n : null;
}
