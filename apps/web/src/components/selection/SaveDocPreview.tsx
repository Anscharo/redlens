import type { Preview } from "@/lib/collectionDiff";
import type { AtlasNode } from "@/types";
import { CollectionDocList } from "../collections/CollectionDocList";

// Rows past this are summarised as "+N more" (the full set is still saved).
const PREVIEW_LIMIT = 60;
// The choice view's box keeps one height whatever it holds, so previewing never
// moves the buttons below it.
const STABLE_HEIGHT = 200;

// The documents a save would leave in the collection, in the list the
// collections page uses. In the choice view (`stable`) the box is always there,
// empty until docs.json has loaded; `resetKey` starts a new preview at the top.
export function SaveDocPreview({
  preview,
  docs,
  stable,
  resetKey,
}: {
  preview: Preview;
  docs: Record<string, AtlasNode> | null;
  stable: boolean;
  resetKey: string;
}) {
  if (!stable && (!docs || preview.ids.length === 0)) return null;
  return (
    <div
      key={resetKey}
      style={{
        ...(stable ? { height: STABLE_HEIGHT } : { maxHeight: STABLE_HEIGHT }),
        overflowY: "auto",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: 6,
      }}
    >
      {docs && <CollectionDocList ids={preview.ids} docs={docs} limit={PREVIEW_LIMIT} marks={preview.marks} />}
    </div>
  );
}
