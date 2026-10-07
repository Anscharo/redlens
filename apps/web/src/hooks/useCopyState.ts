import { useCallback, useEffect, useRef, useState } from "react";

const COPY_RESET_MS = 1200;

// `copied` is true for `resetMs` after a successful clipboard write. `copy`
// resolves true on success and false when the clipboard is missing or rejects,
// so callers can fall back (e.g. window.prompt) without their own try/catch.
export function useCopyState(resetMs: number = COPY_RESET_MS): {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, resetMs);
      return true;
    },
    [resetMs],
  );

  return { copied, copy };
}
