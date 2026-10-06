import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { getConversationCollection } from "../lib/conversationsApi";
import { useSelection } from "../lib/selection";
import { track } from "../lib/analytics";
import { ROUTES } from "@/lib/routes";

type Selection = Pick<ReturnType<typeof useSelection>, "replace" | "setActiveCollectionId" | "setActiveCollectionName">;

// Puts the conversation's cited docs into the working selection as an unowned
// collection and opens the reader's selected-only view. The active collection id
// is cleared, so Save can only offer "save as new" and never writes back to a
// conversation, which has no editable collection to write to.
async function openInReader(id: string, sel: Selection, navigate: (to: string) => void): Promise<void> {
  const c = await getConversationCollection(id);
  sel.replace(c.ids);
  sel.setActiveCollectionId(null);
  sel.setActiveCollectionName(c.name);
  track("conversation_collection_open", { id, count: c.ids.length });
  // subset=selected is read from the destination URL by SelectionProvider.
  navigate(`${ROUTES.ATLAS}?subset=selected`);
}

export function useOpenConversationCollection(): {
  open: (conversationId: string) => Promise<void>;
  /** The last open failed; cleared by the next attempt. */
  failed: boolean;
} {
  const { replace, setActiveCollectionId, setActiveCollectionName } = useSelection();
  const [, navigate] = useLocation();
  const [failed, setFailed] = useState(false);

  const open = useCallback(
    async (conversationId: string) => {
      setFailed(false);
      try {
        await openInReader(conversationId, { replace, setActiveCollectionId, setActiveCollectionName }, navigate);
      } catch {
        setFailed(true);
      }
    },
    [replace, setActiveCollectionId, setActiveCollectionName, navigate],
  );

  return { open, failed };
}
