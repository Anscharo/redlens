// Tiny external store for the currently-selected atlas node id.
//
// Each CollapsibleNode subscribes via useSyncExternalStore and reads its own
// isSelected as (store.get() === node.id). When the store changes, only the
// two rows whose getSnapshot value flipped (old selected, new selected) re-
// render — the rest of the ~1,200 atlas rows skip via React.memo. This keeps
// the click-to-paint path off the docList rebuild critical path.

const listeners = new Set<() => void>();
let currentId: string | null = null;

export const selectionStore = {
  set(id: string | null): void {
    if (currentId === id) return;
    currentId = id;
    for (const l of listeners) l();
  },
  get(): string | null {
    return currentId;
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
