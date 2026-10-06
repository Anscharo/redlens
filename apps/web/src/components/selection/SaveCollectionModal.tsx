import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { MAX_COLLECTION_DOCS } from "@/lib/collectionsLimits";
import { stashResumeSave } from "../../lib/authReturn";
import { Modal } from "../Modal";
import { SaveChoiceView } from "./SaveChoiceView";
import { SaveDocPreview } from "./SaveDocPreview";
import { SaveNameView } from "./SaveNameView";
import { useSaveFlow, type Naming } from "./useSaveFlow";

interface SaveCollectionModalProps {
  ids: string[];
  onClose: () => void;
}

// The count line is how many docs the previewed option would save, against the
// limit. It also carries Update's "+A added · −R removed · U unchanged"
// summary. It never wraps, so its height cannot change while previewing.
function Heading({ title, count, summary }: { title: string; count: number; summary?: string }) {
  const over = count > MAX_COLLECTION_DOCS;
  return (
    <div>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>{title}</h2>
      <p
        className="mono"
        style={{ fontSize: 10, color: over ? "var(--red)" : "var(--tan-3)", margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        <span>
          {count.toLocaleString()} / {MAX_COLLECTION_DOCS.toLocaleString()} Max Docs
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

function saveTitle(naming: Naming, hasCollection: boolean, collectionName: string): string {
  if (naming === null) return "Save changes";
  if (naming === "without") return `Save as new, minus “${collectionName}”`;
  return hasCollection ? "Save as new collection" : "Save as collection";
}

// Save the current selection as a collection, in the shared Modal shell.
// When one of the user's saved collections is open, the choice comes first:
// Update it, save as new, or save as new minus the docs it already holds. The
// doc list shows what the last hovered or focused option would save, and stays
// on it until another is. A successful save sets the active collection so its
// name shows in the pill. State and data live in useSaveFlow.
function SaveBody({ ids, onClose }: SaveCollectionModalProps) {
  const f = useSaveFlow(ids, onClose);
  return (
    <>
      <Heading title={saveTitle(f.naming, f.activeCollectionId !== null, f.collectionName)} count={f.preview.count} summary={f.preview.summary} />
      <SaveDocPreview preview={f.preview} docs={f.docs} stable={f.naming === null} resetKey={f.naming ?? f.previewing ?? "default"} />
      {f.error && (
        <p className="mono" style={{ fontSize: 11, color: "var(--red)", margin: 0 }}>
          {f.error}
        </p>
      )}
      {f.naming === null ? (
        <SaveChoiceView
          collectionName={f.collectionName}
          baseline={f.baseline}
          diff={f.diff}
          pending={f.pending}
          over={f.selectionOver}
          onUpdate={f.update}
          onSaveNew={f.setNaming}
          previewing={f.previewing}
          onPreview={f.setPreviewing}
        />
      ) : (
        <SaveNameView name={f.name} onName={f.setName} onSave={f.create} onCancel={onClose} pending={f.pending} blocked={!f.name.trim() || f.over} />
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
