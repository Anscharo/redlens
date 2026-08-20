import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { useCollections } from "../../hooks/useCollections";
import { useSelection } from "@/lib/selection";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { loadDocs } from "@/lib/docs";
import { track } from "@/lib/analytics";
import { ROUTES } from "@/lib/routes";
import type { AtlasNode } from "@/types";
import type { Collection } from "@/lib/collectionsApi";
import { CollectionCard } from "./CollectionCard";

// /collections — a signed-in user's saved document selections. Sign-in gated;
// each collection can be reopened into the atlas reader (selected-only view),
// renamed, or deleted. Doc titles are resolved from the cached atlas bundle
// (best-effort — falls back to a bare count if docs.json hasn't landed yet).
export function CollectionsPage() {
  useDocumentTitle("Collections");
  const { user } = useAuth();
  const { collections, loading, error, rename, remove } = useCollections();
  const { replace, setActiveCollectionId, setActiveCollectionName } = useSelection();
  const [, navigate] = useLocation();
  const [docs, setDocs] = useState<Record<string, AtlasNode> | null>(null);

  useEffect(() => {
    if (!user) return;
    loadDocs()
      .then(setDocs)
      .catch(() => setDocs(null));
  }, [user]);

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

  return (
    <div className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">collections</p>
        <h1 className="text-xl font-semibold mb-6" style={{ color: "var(--tan)" }}>
          Your Collections
        </h1>

        {!user ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <h2 className="text-sm font-medium" style={{ color: "var(--tan)" }}>
              Sign in to view your collections
            </h2>
            <div className="w-64">
              <SignInButtons variant="menu" source="collections" />
            </div>
          </div>
        ) : loading ? (
          <p className="mono text-xs text-tan-3">Loading…</p>
        ) : error ? (
          <p className="mono text-xs" style={{ color: "var(--error-text)" }}>
            Failed to load collections: {error}
          </p>
        ) : collections.length === 0 ? (
          <p className="mono text-xs text-tan-3">
            No collections yet — select documents in the reader and save them.
          </p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
