import { useSyncExternalStore } from "react";
import * as idb from "./idb";
import type { VisitEvent } from "./visitHistory";

// Reactive snapshot of the visit log (backs the /history page): an in-memory
// copy of the IndexedDB events that components read through useVisitLog.

// `loaded` rides in the same object as the events so both change in one atomic
// swap: the /history page needs to tell "the log is empty" from "the first
// IndexedDB read hasn't resolved yet", and two separate stores could disagree
// for a render.
export interface VisitLog {
  events: VisitEvent[];
  loaded: boolean;
}

let snapshot: VisitLog = { events: [], loaded: false };
let hydrated = false;
// Set when a visit lands with no subscriber: the snapshot is now behind the
// store, so the next subscribe re-reads instead of trusting it.
let stale = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

// Full re-read — used only for initial hydration and after a clear, NOT per
// write (the log is append-only, so recordVisit appends to the snapshot in place).
async function refresh(): Promise<void> {
  snapshot = { events: await idb.getAll<VisitEvent>(), loaded: true };
  emit();
}

// Push a change into the live snapshot — but only while something is actually
// rendering it. `hydrated` stays true for the session once /me/history has been
// opened, so without this guard every later navigation would copy the whole log
// (up to MAX_ROWS) for no listener. Mark it stale instead and re-read on the
// next subscribe.
export function publish(next: (events: VisitEvent[]) => VisitEvent[]): void {
  if (!hydrated) return;
  if (listeners.size === 0) {
    stale = true;
    return;
  }
  snapshot = { events: next(snapshot.events), loaded: snapshot.loaded };
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!hydrated || stale) {
    hydrated = true;
    stale = false;
    void refresh();
  }
  return () => listeners.delete(cb);
}

/** Reactive view of the raw event log plus whether the first read has landed. */
export function useVisitLog(): VisitLog {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Re-reads the snapshot after the log is wiped, when anything has hydrated it. */
export async function refreshIfHydrated(): Promise<void> {
  if (hydrated) await refresh();
}
