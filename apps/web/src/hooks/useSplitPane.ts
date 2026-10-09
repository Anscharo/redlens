import { useCallback } from "react";
import { track } from "../lib/analytics";
import { useUrlState, urlString } from "./useUrlState";

const splitCodec = urlString(null);

/** The reader's comparison pane. It lives in ?split=<uuid> so shift-click and
 *  back/forward restore the same side-by-side view and the URL is shareable.
 *  The URL is the only state, so every caller sees the same pane. */
export function useSplitPane(nodeId: string | null) {
  const [splitId, setSplitId] = useUrlState("split", splitCodec);

  // Opening and closing are tracked on the null ↔ uuid transitions only.
  const handleSplitChange = useCallback(
    (sid: string | null) => {
      if (sid && sid !== splitId) track("atlas_split_open", { node_id: nodeId, split_id: sid });
      else if (!sid && splitId) track("reader_split_close", { node_id: nodeId, split_id: splitId });
      setSplitId(sid);
    },
    [setSplitId, splitId, nodeId],
  );

  return { splitId, handleSplitChange };
}
