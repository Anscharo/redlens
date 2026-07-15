// Minimal, dependency-free IndexedDB promise wrapper for the visit-history log
// (src/lib/visitHistory.ts). One database, one object store. Every function
// feature-detects IndexedDB and resolves to a no-op / empty value when it is
// unavailable — SSR, private-mode with storage disabled, quota errors — so
// callers never need their own try/catch (mirrors curationStore.ts's defensive
// posture, adapted for async IndexedDB).

const DB_NAME = "redline-sky-atlas";
const DB_VERSION = 1;
const STORE = "visits";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

// Memoized open (module-level, like loadAtlas's promise cache). Resolves to null
// rather than rejecting when IndexedDB is missing or the open fails, so every
// helper can `if (!db) return <empty>`.
export function openDb(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("at", "at"); // time-window queries + oldest-first pruning
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function add<T>(record: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await wrap(store(db, "readwrite").add(record as unknown as Record<string, unknown>));
  } catch {
    // quota / constraint — drop the row silently, never break the caller
  }
}

export async function getAll<T>(): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    return await wrap(store(db, "readonly").getAll() as IDBRequest<T[]>);
  } catch {
    return [];
  }
}

export async function count(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  try {
    return await wrap(store(db, "readonly").count());
  } catch {
    return 0;
  }
}

export async function clear(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await wrap(store(db, "readwrite").clear());
  } catch {
    // ignore
  }
}

// Cursor over the `at` index deleting every row strictly older than `cutoff`.
export async function deleteBefore(cutoff: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const idx = store(db, "readwrite").index("at");
    const req = idx.openCursor(IDBKeyRange.upperBound(cutoff, true));
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

// Delete oldest rows (ascending `at`) until at most `max` remain.
export async function trimToMax(max: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const total = await count();
    let toDelete = total - max;
    if (toDelete <= 0) return;
    const idx = store(db, "readwrite").index("at");
    const req = idx.openCursor();
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || toDelete <= 0) return resolve();
        cursor.delete();
        toDelete--;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

// Test-only: drop the memoized handle so a fresh fake-indexeddb picks up.
export function __resetForTests(): void {
  dbPromise = null;
}
