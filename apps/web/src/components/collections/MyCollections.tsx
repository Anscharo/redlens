import { useCollections } from "../../hooks/useCollections";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { track } from "../../lib/analytics";
import type { Collection } from "../../lib/collectionsApi";
import { CollectionCard } from "./CollectionCard";
import { ListGate } from "./ListGate";
import { useOpenOwnCollection } from "./useOpenOwnCollection";

// The signed-in user's saved selections. Each can be reopened into the atlas
// reader (selected-only view), renamed, or deleted. Doc titles are resolved
// from the cached atlas bundle (best-effort — falls back to a bare count if
// docs.json hasn't landed yet).
export function MyCollections() {
  const { collections, loading, error, rename, remove } = useCollections();
  const openCollection = useOpenOwnCollection();
  const docs = useLoaded(loadDocs, { soft: true });

  const deleteCollection = async (c: Collection) => {
    if (!window.confirm(`Delete collection "${c.name}"? This can't be undone.`)) return;
    await remove(c.id);
    track("collection_delete", { id: c.id });
  };

  const empty = collections.length === 0 ? "No collections yet — select documents in the reader and save them." : null;
  return (
    <ListGate loading={loading} error={error} errorPrefix="Failed to load collections" empty={empty}>
      <div className="space-y-3">
        {collections.map((c) => (
          <CollectionCard
            key={c.id}
            collection={c}
            docs={docs}
            onOpen={() => openCollection(c)}
            onRename={(name) => rename(c.id, name)}
            onDelete={() => deleteCollection(c)}
          />
        ))}
      </div>
    </ListGate>
  );
}
