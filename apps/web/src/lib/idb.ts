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

// The one place the openDb/null-check/try-catch dance lives: run `fn` against the
// store and return `fallback` if IndexedDB is missing or the op throws (quota,
// constraint, …). Every helper below is a one-liner over this.
async function withStore<T>(
  mode: IDBTransactionMode,
  fallback: T,
  fn: (s: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  try {
    return await fn(store(db, mode));
  } catch {
    return fallback;
  }
}

// Walk a cursor over the `at` index, deleting each row until `keepGoing` returns
// false or the cursor ends. Shared by the two pruning helpers.
function deleteWhile(
  req: IDBRequest<IDBCursorWithValue | null>,
  keepGoing: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || !keepGoing()) return resolve();
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Append a record, returning its generated key (null when IndexedDB is
 *  unavailable or the write failed) so the caller can update the row later. */
export function add<T>(record: T): Promise<number | null> {
  return withStore("readwrite", null, async (s) => {
    const key = await wrap(s.add(record as unknown as Record<string, unknown>));
    return typeof key === "number" ? key : null;
  });
}

/** Overwrite an existing record in place (keyed by its `id`). */
export function put<T>(record: T): Promise<void> {
  return withStore("readwrite", undefined, async (s) => {
    await wrap(s.put(record as unknown as Record<string, unknown>));
  });
}

export function getAll<T>(): Promise<T[]> {
  return withStore("readonly", [] as T[], (s) => wrap(s.getAll() as IDBRequest<T[]>));
}

export function count(): Promise<number> {
  return withStore("readonly", 0, (s) => wrap(s.count()));
}

export function clear(): Promise<void> {
  return withStore("readwrite", undefined, async (s) => {
    await wrap(s.clear());
  });
}

// Delete every row strictly older than `cutoff`.
export function deleteBefore(cutoff: number): Promise<void> {
  return withStore("readwrite", undefined, (s) =>
    deleteWhile(s.index("at").openCursor(IDBKeyRange.upperBound(cutoff, true)), () => true),
  );
}

// Delete oldest rows (ascending `at`) until at most `max` remain. `count()` runs
// in its own transaction first (awaiting a request then issuing another on the
// same transaction risks TransactionInactiveError once it auto-commits).
export async function trimToMax(max: number): Promise<void> {
  let toDelete = (await count()) - max;
  if (toDelete <= 0) return;
  await withStore("readwrite", undefined, (s) =>
    deleteWhile(s.index("at").openCursor(), () => toDelete-- > 0),
  );
}

// Test-only: drop the memoized handle so a fresh fake-indexeddb picks up.
export function __resetForTests(): void {
  dbPromise = null;
}
