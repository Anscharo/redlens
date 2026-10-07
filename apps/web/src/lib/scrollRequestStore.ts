// Event channel from the tree sidebar to the reader: "put this node into view
// now". URL-driven scrolling (useAtlasScroll) only reacts to id changes, so
// clicking the already-selected sidebar row would otherwise do nothing.
// Same shape as selectionStore / revealStore.
import { createChannel } from "./createChannel";

const channel = createChannel<string>();

export const scrollRequestStore = {
  request: (id: string): void => channel.emit(id),
  subscribe: channel.subscribe,
};
