import { useCallback, useState } from "react";
import { PALETTE_TOKENS, TOKEN_BY_NAME } from "./palette-tokens";
import {
  ALL_TOKEN_NAMES,
  applyOverrides,
  buildOverrideSnippet,
  clearInlineOverrides,
  clearOverrides,
  cssDefault,
  normalize,
  readOverrides,
  writeOverrides,
} from "./palette-storage";

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) if (a[k] !== b[k]) return false;
  return true;
}

export interface UseColorOverridesResult {
  draft: Record<string, string>;
  saved: Record<string, string>;
  isDirty: boolean;
  hasSaved: boolean;
  setDraftValue: (name: string, value: string) => void;
  apply: () => void;
  reset: () => void;
  copySnippet: () => Promise<void>;
  effectiveValue: (name: string) => string;
}

export function useColorOverrides(): UseColorOverridesResult {
  const [saved, setSaved] = useState<Record<string, string>>(() => readOverrides());
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...saved }));

  const setDraftValue = useCallback((name: string, value: string) => {
    const token = TOKEN_BY_NAME.get(name);
    if (!token) return;
    setDraft((d) => {
      // Setting back to default removes the override entry entirely.
      if (normalize(value) === normalize(cssDefault(name))) {
        if (!(name in d)) return d;
        const next = { ...d };
        delete next[name];
        return next;
      }
      if (d[name] === value) return d;
      return { ...d, [name]: value };
    });
  }, []);

  const apply = useCallback(() => {
    writeOverrides(draft);
    // Inline-style cleanup for tokens that were saved before but are no longer overridden.
    const removed = Object.keys(saved).filter((k) => !(k in draft));
    if (removed.length > 0) clearInlineOverrides(removed);
    applyOverrides(draft);
    setSaved({ ...draft });
  }, [draft, saved]);

  const reset = useCallback(() => {
    clearOverrides();
    clearInlineOverrides(ALL_TOKEN_NAMES);
    setSaved({});
    setDraft({});
  }, []);

  const copySnippet = useCallback(async () => {
    const snippet = buildOverrideSnippet(draft, PALETTE_TOKENS);
    await navigator.clipboard.writeText(snippet);
  }, [draft]);

  const effectiveValue = useCallback(
    (name: string): string => {
      if (name in draft) return draft[name];
      return cssDefault(name);
    },
    [draft],
  );

  return {
    draft,
    saved,
    isDirty: !shallowEqual(draft, saved),
    hasSaved: Object.keys(saved).length > 0,
    setDraftValue,
    apply,
    reset,
    copySnippet,
    effectiveValue,
  };
}
