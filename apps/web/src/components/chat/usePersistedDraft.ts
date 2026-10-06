import { useCallback, useEffect, useState } from "react";

const DRAFT_KEY = "rlc-draft";

// The composer draft, restored on mount and mirrored to localStorage on every
// change. `clear` empties it and drops the stored copy.
export function usePersistedDraft() {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(localStorage.getItem(DRAFT_KEY) ?? "");
  }, []);
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, draft);
  }, [draft]);
  const clear = useCallback(() => {
    setDraft("");
    localStorage.removeItem(DRAFT_KEY);
  }, []);
  return { draft, setDraft, clear };
}
