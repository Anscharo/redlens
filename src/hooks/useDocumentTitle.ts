import { useEffect } from "react";

const DEFAULT_TITLE = "Sky Atlas by Redline";

/**
 * Sets `document.title` to the given full title string while mounted, restoring
 * the default site title (`Sky Atlas by Redline`) on unmount. Pass
 * `null`/empty to fall back to the default.
 *
 * Callers compose the full title (e.g. `<doc> — Sky Atlas by Redline`).
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title || DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
