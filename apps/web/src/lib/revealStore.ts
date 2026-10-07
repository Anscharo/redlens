// Event channel from the reader to the tree sidebar (shape borrowed from
// selectionStore). When sections get expanded in the reader, the sidebar
// expands their ancestors so the affected rows become visible even though
// they aren't selected.
import { createChannel } from "./createChannel";

const channel = createChannel<readonly string[]>();

export const revealStore = {
  reveal: (ids: readonly string[]): void => channel.emit(ids),
  subscribe: channel.subscribe,
};
