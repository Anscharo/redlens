import { useState } from "react";
import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { useSelection } from "../../lib/selection";
import { diffIds, previewFor, type SaveOption } from "@/lib/collectionDiff";
import { MAX_COLLECTION_DOCS } from "@/lib/collectionsLimits";
import { loadDocs } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { stashResumeSave } from "../../lib/authReturn";
import { Modal } from "../Modal";
import { SaveChoiceView } from "./SaveChoiceView";
import { SaveDocPreview } from "./SaveDocPreview";
import { SaveNameView } from "./SaveNameView";
import { useCollectionBaseline } from "./useCollectionBaseline";
import { useSaveActions } from "./useSaveActions";

interface SaveCollectionModalProps {
  ids: string[];
  onClose: () => void;
}

// Runs one save: guards double clicks, closes on success, surfaces the error.
function useRun(onClose: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }
  return { pending, error, run };
}

// The count line also carries Update's "+A added · −R removed · U unchanged"
// summary. It never wraps, so its height cannot change while previewing.
function Heading({ title, count, over, summary }: { title: string; count: number; over: boolean; summary?: string }) {
  return (
    <div>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>{title}</h2>
      <p
        className="mono"
        style={{ fontSize: 10, color: over ? "var(--red)" : "var(--tan-3)", margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        <span>
          {count.toLocaleString()} / {MAX_COLLECTION_DOCS.toLocaleString()} document{count === 1 ? "" : "s"}
          {over ? " — over the limit" : ""}
        </span>
        {summary && (
          <>
            <span aria-hidden="true"> · </span>
            <span>{summary}</span>
          </>
        )}
      </p>
    </div>
  );
}

// Save the current selection as a collection, in the shared Modal shell.
// When one of the user's saved collections is open (activeCollectionId), the
// choice comes first: Update it, save as new, or save as new minus the docs it
// already holds. The doc list shows what the last hovered or focused option
// would save, and stays on it until another is. A successful save sets the
// active collection so its name shows in the pill.
function SaveBody({ ids, onClose }: SaveCollectionModalProps) {
  const { activeCollectionId, activeCollectionName } = useSelection();
  const docs = useLoaded(loadDocs, { soft: true });
  const baseline = useCollectionBaseline(activeCollectionId);
  const saved = baseline.status === "ready" ? baseline.ids : null;
  const diff = saved ? diffIds(saved, ids) : null;
  // null: still choosing; otherwise the save-as-new option the name is for.
  const [naming, setNaming] = useState<"new" | "without" | null>(activeCollectionId ? null : "new");
  // Opens on Update, the primary action (the shell focuses it, which previews it
  // anyway); hovering or focusing another button moves the preview there.
  const [previewing, setPreviewing] = useState<SaveOption | null>(activeCollectionId ? "update" : null);
  const [name, setName] = useState("");
  const { pending, error, run } = useRun(onClose);

  const preview = previewFor(naming ?? previewing ?? "new", ids, saved);
  const saveIds = naming ? previewFor(naming, ids, saved).ids : ids;
  const over = saveIds.length > MAX_COLLECTION_DOCS;
  const collectionName = activeCollectionName ?? "collection";

  const { create, update } = useSaveActions({ ids, saveIds, naming, name, over, run });

  const title =
    naming === null
      ? "Save changes"
      : naming === "without"
        ? `Save as new, minus “${collectionName}”`
        : activeCollectionId
          ? "Save as new collection"
          : "Save as collection";
  return (
    <>
      <Heading
        title={title}
        count={naming ? saveIds.length : ids.length}
        over={naming ? over : ids.length > MAX_COLLECTION_DOCS}
        summary={preview.summary}
      />
      <SaveDocPreview preview={preview} docs={docs} stable={naming === null} resetKey={naming ?? previewing ?? "default"} />
      {error && (
        <p className="mono" style={{ fontSize: 11, color: "var(--red)", margin: 0 }}>
          {error}
        </p>
      )}
      {naming === null ? (
        <SaveChoiceView
          collectionName={collectionName}
          baseline={baseline}
          diff={diff}
          pending={pending}
          over={ids.length > MAX_COLLECTION_DOCS}
          onUpdate={update}
          onSaveNew={setNaming}
          previewing={previewing}
          onPreview={setPreviewing}
        />
      ) : (
        <SaveNameView name={name} onName={setName} onSave={create} onCancel={onClose} pending={pending} blocked={!name.trim() || over} />
      )}
    </>
  );
}

export function SaveCollectionModal({ ids, onClose }: SaveCollectionModalProps) {
  const { user } = useAuth();
  return (
    <Modal label="Save as collection" onClose={onClose} width={user ? 560 : undefined}>
      {user ? (
        <SaveBody ids={ids} onClose={onClose} />
      ) : (
        <>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>
            Sign in to save this selection as a collection
          </h2>
          <SignInButtons variant="menu" source="collections" sansSerif onBeforeSignIn={stashResumeSave} />
        </>
      )}
    </Modal>
  );
}
