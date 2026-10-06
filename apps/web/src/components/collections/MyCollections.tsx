import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useCollections } from "../../hooks/useCollections";
import { useSelection } from "../../lib/selection";
import { loadDocs } from "../../lib/docs";
import { track } from "../../lib/analytics";
import { ROUTES } from "@/lib/routes";
import type { AtlasNode } from "@/types";
import type { Collection } from "../../lib/collectionsApi";
import { CollectionCard } from "./CollectionCard";

// The signed-in user's saved selections. Each can be reopened into the atlas
// reader (selected-only view), renamed, or deleted. Doc titles are resolved
// from the cached atlas bundle (best-effort — falls back to a bare count if
// docs.json hasn't landed yet).
export function MyCollections() {
  const { collections, loading, error, rename, remove } = useCollections();
  const { replace, setActiveCollectionId, setActiveCollectionName } = useSelection();
  const [, navigate] = useLocation();
  const [docs, setDocs] = useState<Record<string, AtlasNode> | null>(null);

  useEffect(() => {
    loadDocs()
      .then(setDocs)
      .catch(() => setDocs(null));
  }, []);

  const openCollection = (c: Collection) => {
    replace(c.ids);
    setActiveCollectionId(c.id);
    setActiveCollectionName(c.name);
    track("collection_open", { id: c.id, count: c.ids.length });
    // Carry the selected subset in the destination URL: subset=selected is
    // decoded from the current URL by SelectionProvider, so setting it here
    // (still on /collections) would be dropped by the navigation to /atlas.
    navigate(`${ROUTES.ATLAS}?subset=selected`);
  };

  const deleteCollection = async (c: Collection) => {
    if (!window.confirm(`Delete collection "${c.name}"? This can't be undone.`)) return;
    await remove(c.id);
    track("collection_delete", { id: c.id });
  };

  if (loading) return <p className="mono text-xs text-tan-3">Loading…</p>;
  if (error) {
    return (
      <p className="mono text-xs" style={{ color: "var(--error-text)" }}>
        Failed to load collections: {error}
      </p>
    );
  }
  if (collections.length === 0) {
    return <p className="mono text-xs text-tan-3">No collections yet — select documents in the reader and save them.</p>;
  }
  return (
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
  );
}
