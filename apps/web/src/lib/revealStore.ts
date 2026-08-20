// Tiny event channel from the reader to the tree sidebar (pattern borrowed
// from selectionStore). When sections get expanded in the reader, the sidebar
// expands their ancestors so the affected rows become visible even though
// they aren't selected.

type Listener = (ids: readonly string[]) => void;
const listeners = new Set<Listener>();

export const revealStore = {
  reveal(ids: readonly string[]): void {
    for (const l of listeners) l(ids);
  },
  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
