import { useSyncExternalStore } from "react";

// The footer's contextual hint line. Two tiers, resolved hover-first: what the
// pointer is over is a more immediate answer to "what can I do" than what holds
// focus, and only one hint is ever shown.
//
// An external store rather than context on purpose. The hover tier is written
// from a delegated pointer listener that fires as the cursor crosses rows —
// routing that through context would re-render the virtualized tree and the
// whole reader for a one-line label. Same reasoning as useModifierKeyAttrs,
// which writes modifier state to DOM attributes for exactly this cost. Only
// FooterHint subscribes here, so a hover costs one tiny re-render.

type Listener = () => void;
const listeners = new Set<Listener>();

let hover: string | null = null;
let focus: string | null = null;
// The resolved value, cached. useSyncExternalStore compares snapshots by
// identity and re-reads until two agree, so getSnapshot must never compute a
// fresh value per call.
let snapshot: string | null = null;

function publish() {
  const next = hover ?? focus;
  if (next === snapshot) return;
  snapshot = next;
  for (const l of listeners) l();
}

export const hintStore = {
  /** The pointer is over something with a modifier-click gesture. */
  setHover(text: string | null): void {
    if (hover === text) return;
    hover = text;
    publish();
  },
  /** Something that responds to the keyboard holds focus. */
  setFocus(text: string | null): void {
    if (focus === text) return;
    focus = text;
    publish();
  },
  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  getSnapshot(): string | null {
    return snapshot;
  },
};

/** The hint to show right now, or null. Hover outranks focus. */
export function useHint(): string | null {
  return useSyncExternalStore(hintStore.subscribe, hintStore.getSnapshot, () => null);
}
