import type { RefObject } from "react";

/**
 * Focuses the search field on the next frame, with the caret at `pos` (the end
 * when omitted). The next frame, because the controls that call this have just
 * rewritten the query and the field shows the new text only once React commits.
 */
export function focusInputAt(ref: RefObject<HTMLInputElement | null>, pos?: number): void {
  requestAnimationFrame(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const at = pos ?? input.value.length;
    input.setSelectionRange(at, at);
  });
}
