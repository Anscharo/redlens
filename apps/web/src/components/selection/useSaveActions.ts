import { createCollection, updateCollectionItems } from "../../lib/collectionsApi";
import { track } from "../../lib/analytics";
import { useSelection } from "../../lib/selection";

interface SaveActionsInput {
  /** The whole selection: what Update writes. */
  ids: string[];
  /** What a save-as-new would write: the selection, or the selection without the opened collection's docs. */
  saveIds: string[];
  /** Which save-as-new the name is for; null while still choosing. */
  naming: "new" | "without" | null;
  name: string;
  /** The ids a save would write are over the collection size limit. */
  over: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
}

// The two writes the save dialog can make. A save sets the active collection
// so its name shows in the pill; a save without the opened collection's docs
// also moves the selection onto the new, smaller set.
export function useSaveActions({ ids, saveIds, naming, name, over, run }: SaveActionsInput) {
  const { activeCollectionId, setActiveCollectionId, setActiveCollectionName, replace } = useSelection();

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed || over || !naming) return;
    return run(async () => {
      const created = await createCollection(trimmed, saveIds);
      if (naming === "without") replace(saveIds);
      setActiveCollectionId(created.id);
      setActiveCollectionName(created.name);
      track("collection_save", naming === "without" ? { count: saveIds.length, without_opened: true } : { count: saveIds.length });
    });
  };

  const update = () => {
    if (!activeCollectionId || over) return;
    return run(async () => {
      await updateCollectionItems(activeCollectionId, ids);
      track("collection_update", { id: activeCollectionId, count: ids.length });
    });
  };

  return { create, update };
}
