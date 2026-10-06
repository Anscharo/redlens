import { useState } from "react";
import { useSelection } from "../../lib/selection";
import { diffIds, previewFor, type SaveOption } from "@/lib/collectionDiff";
import { MAX_COLLECTION_DOCS } from "@/lib/collectionsLimits";
import { loadDocs } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { useCollectionBaseline } from "./useCollectionBaseline";
import { useSaveActions } from "./useSaveActions";

/** Which save-as-new the name is being asked for; null while still choosing. */
export type Naming = "new" | "without" | null;

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

// What the dialog compares against: the atlas docs (for titles) and the open
// collection's saved docs, loaded when the dialog opens.
function useSaveSource(collectionId: string | null) {
  const docs = useLoaded(loadDocs, { soft: true });
  const baseline = useCollectionBaseline(collectionId);
  return { docs, baseline, saved: baseline.status === "ready" ? baseline.ids : null };
}

// The dialog's own state. With an own collection open it starts on the choice,
// previewing Update (the primary action, which the shell focuses anyway);
// without one it goes straight to naming.
function useSaveSteps(collectionId: string | null) {
  const [naming, setNaming] = useState<Naming>(collectionId ? null : "new");
  const [previewing, setPreviewing] = useState<SaveOption | null>(collectionId ? "update" : null);
  const [name, setName] = useState("");
  return { naming, setNaming, previewing, setPreviewing, name, setName };
}

// What would be shown and saved for the current step. Pure.
function savePlan(ids: string[], saved: string[] | null, naming: Naming, previewing: SaveOption | null) {
  const preview = previewFor(naming ?? previewing ?? "new", ids, saved);
  const saveIds = naming ? previewFor(naming, ids, saved).ids : ids;
  return {
    preview,
    saveIds,
    over: saveIds.length > MAX_COLLECTION_DOCS,
    selectionOver: ids.length > MAX_COLLECTION_DOCS,
    diff: saved ? diffIds(saved, ids) : null,
  };
}

// Everything the save dialog needs, as one view model: the data it compares
// against, the step it is on, what each option would save, and the two writes.
export function useSaveFlow(ids: string[], onClose: () => void) {
  const { activeCollectionId, activeCollectionName } = useSelection();
  const source = useSaveSource(activeCollectionId);
  const steps = useSaveSteps(activeCollectionId);
  const { pending, error, run } = useRun(onClose);
  const plan = savePlan(ids, source.saved, steps.naming, steps.previewing);
  const { create, update } = useSaveActions({ ids, saveIds: plan.saveIds, naming: steps.naming, name: steps.name, over: plan.over, run });
  const collectionName = activeCollectionName ?? "collection";
  return { ...source, ...steps, ...plan, create, update, pending, error, activeCollectionId, collectionName };
}
