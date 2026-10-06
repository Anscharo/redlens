import type { Preview } from "@/lib/collectionDiff";
import type { AtlasNode } from "@/types";
import { CollectionDocList } from "../collections/CollectionDocList";

// Rows past this are summarised as "+N more" (the full set is still saved).
const PREVIEW_LIMIT = 60;
// With hover previews the list swaps under the pointer, so a fixed height keeps
// the buttons below it from moving out from under the cursor.
const STABLE_HEIGHT = 200;

// The documents a save would leave in the collection, in the list the
// collections page uses. Empty until docs.json has loaded.
export function SaveDocPreview({
  preview,
  docs,
  stable,
}: {
  preview: Preview;
  docs: Record<string, AtlasNode> | null;
  stable: boolean;
}) {
  if (!docs || preview.ids.length === 0) return null;
  return (
    <div>
      {preview.summary && (
        <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: "0 0 4px" }}>
          {preview.summary}
        </p>
      )}
      <div
        style={{
          ...(stable ? { height: STABLE_HEIGHT } : { maxHeight: STABLE_HEIGHT }),
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: 6,
        }}
      >
        <CollectionDocList ids={preview.ids} docs={docs} limit={PREVIEW_LIMIT} marks={preview.marks} />
      </div>
    </div>
  );
}
