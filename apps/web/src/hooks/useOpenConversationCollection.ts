import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { getConversationCollection } from "../lib/conversationsApi";
import { useSelection } from "../lib/selection";
import { track } from "../lib/analytics";
import { ROUTES } from "@/lib/routes";

// Opens a conversation's auto collection in the reader's selected-only view.
// The collection goes into the working selection exactly as a shared collection
// does (SharedCollectionOpener): the active collection id is cleared, so Save
// can only offer "save as new" and never writes back to a conversation, which
// has no editable collection to write to.
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
        const c = await getConversationCollection(conversationId);
        replace(c.ids);
        setActiveCollectionId(null);
        setActiveCollectionName(c.name);
        track("conversation_collection_open", { id: conversationId, count: c.ids.length });
        // subset=selected is read from the destination URL by SelectionProvider.
        navigate(`${ROUTES.ATLAS}?subset=selected`);
      } catch {
        setFailed(true);
      }
    },
    [replace, setActiveCollectionId, setActiveCollectionName, navigate],
  );

  return { open, failed };
}
