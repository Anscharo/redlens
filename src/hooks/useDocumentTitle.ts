import { useEffect } from "react";

const DEFAULT_TITLE = "Sky Atlas by Redline";

/**
 * Sets `document.title` to the given page title while mounted, restoring the
 * default site title on unmount. Pass `null`/empty to fall back to the default.
 *
 * Format: `Sky Atlas: <title> — by Redline`.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `Sky Atlas: ${title} — by Redline` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
