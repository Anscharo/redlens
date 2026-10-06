import { createCollection, updateCollectionItems, type Collection } from "../../lib/collectionsApi";
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

// A save sets the active collection so its name shows in the pill; a save
// without the opened collection's docs also moves the selection onto the new,
// smaller set.
function adoptSaved(sel: ReturnType<typeof useSelection>, created: Collection, saveIds: string[], without: boolean) {
  if (without) sel.replace(saveIds);
  sel.setActiveCollectionId(created.id);
  sel.setActiveCollectionName(created.name);
}

// The two writes the save dialog can make.
export function useSaveActions({ ids, saveIds, naming, name, over, run }: SaveActionsInput) {
  const sel = useSelection();

  const create = () => {
    if (!name.trim() || over || !naming) return;
    return run(async () => {
      const created = await createCollection(name.trim(), saveIds);
      adoptSaved(sel, created, saveIds, naming === "without");
      track("collection_save", { count: saveIds.length, ...(naming === "without" && { without_opened: true }) });
    });
  };

  const update = () => {
    const id = sel.activeCollectionId;
    if (!id || over) return;
    return run(async () => {
      await updateCollectionItems(id, ids);
      track("collection_update", { id, count: ids.length });
    });
  };

  return { create, update };
}
