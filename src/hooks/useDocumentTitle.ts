import { useEffect } from "react";

const DEFAULT_TITLE = "Sky Atlas by Redline";

/**
 * Sets `document.title` to the given page title while mounted, restoring the
 * default site title on unmount. Pass `null`/empty to fall back to the default.
 *
 * Format: `<title> — Sky Atlas by Redline`.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} — ${DEFAULT_TITLE}` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
