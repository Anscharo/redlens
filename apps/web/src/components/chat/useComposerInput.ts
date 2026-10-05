import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { acceptSlashCompletion, type SlashCompletion } from "@/lib/chatSlashCommands";

interface ComposerInputOptions {
  onDraftChange: (v: string) => void;
  onSend: () => void;
  /** Bump to focus the textarea; 0 / undefined never focuses. */
  focusKey?: number;
  /** The slash command a lone `/t` draft offers, if any. */
  completion: SlashCompletion | null;
  /** Enter may send right now (not streaming, not locked, draft not blank). */
  canSend: boolean;
}

// Tab must be swallowed or focus leaves the textarea; Space must be, or the
// textarea inserts its own space after the one the completion adds. Enter
// sends, Shift+Enter newlines.
function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>, o: ComposerInputOptions, send: () => void) {
  if (o.completion && (e.key === "Tab" || e.key === " ") && !e.nativeEvent.isComposing) {
    e.preventDefault();
    o.onDraftChange(acceptSlashCompletion(o.completion));
    return;
  }
  if (e.key !== "Enter" || e.shiftKey) return;
  e.preventDefault();
  if (o.canSend) send();
}

// The auto-growing textarea's behaviour: focus on request, grow to fit (up to
// 120px), the key map above, and a send that shrinks it back.
export function useComposerInput(o: ComposerInputOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (o.focusKey) ref.current?.focus();
  }, [o.focusKey]);
  const send = () => {
    o.onSend();
    if (ref.current) ref.current.style.height = "auto";
  };
  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
    o.onDraftChange(ta.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => onComposerKey(e, o, send);
  return { send, textarea: { ref, onChange, onKeyDown } };
}
