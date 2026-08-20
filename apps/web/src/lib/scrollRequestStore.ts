// Tiny event channel from the tree sidebar to the reader: "put this node into
// view now". URL-driven scrolling (useAtlasScroll) only reacts to id changes,
// so clicking the already-selected sidebar row would otherwise do nothing.
// Same pattern as selectionStore / revealStore.

type Listener = (id: string) => void;
const listeners = new Set<Listener>();

export const scrollRequestStore = {
  request(id: string): void {
    for (const l of listeners) l(id);
  },
  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
