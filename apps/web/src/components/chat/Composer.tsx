import type { ReactNode } from "react";
import { completeSlashCommand } from "@/lib/chatSlashCommands";
import { SlashGhost } from "./SlashGhost";
import { ContextChip, SendButton, StopButton } from "./ComposerControls";
import { useComposerInput } from "./useComposerInput";

interface ComposerProps {
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  locked?: boolean; // a 429 lock is in force — input disabled, hint shows "locked"
  // Notice slot above the input — ChatPanel composes RateLimitNote/ErrorNote
  // here (and owns the "error is suppressed while rate-limited" policy, since
  // it owns both pieces of state). The composer just provides the position.
  notice?: ReactNode;
  placeholder: string;
  chip: string;
  // True while useChatSession's openConversation() is awaiting its GET — the
  // panel already shows "Loading conversation…" in the thread, but nothing
  // upstream stopped the composer itself from accepting input during that
  // window. Without this, a send fired before hydrate() lands still carries
  // the PREVIOUS conversationId (or none), so it's posted to the wrong
  // conversation instead of the one the user just opened.
  historyLoading?: boolean;
  // Bump to move keyboard focus into the textarea (ChatPanel does this on
  // New chat, whose button disappears the moment the thread empties — so
  // focus would otherwise fall to the body). 0 / undefined never focuses.
  focusKey?: number;
  // Footer slot, rendered below the input — ChatPanel passes the LimitsMeter
  // here. Composition instead of props: the composer doesn't consume any of
  // the meter's data, so it shouldn't have to thread it through.
  children?: ReactNode;
}

interface HintState {
  streaming: boolean;
  historyLoading?: boolean;
  locked?: boolean;
  completing: boolean;
}

// The hint beside the chip: the one state the input is in right now.
function composerHint({ streaming, historyLoading, locked, completing }: HintState): string {
  if (streaming) return "streaming…";
  if (historyLoading) return "loading…";
  if (locked) return "locked";
  return completing ? "⇥ to complete" : "↵ to send";
}

// Auto-growing textarea + context chip + send/stop. Enter sends, Shift+Enter
// newlines. While streaming the send button becomes a stop button. A draft
// that is a lone `/t` offers the matching slash command as a ghost; Tab or
// Space accepts it (src/lib/chatSlashCommands.ts holds the list).
export function Composer(props: ComposerProps) {
  const { draft, onDraftChange, onSend, onStop, streaming, locked, notice, placeholder, chip, historyLoading, focusKey, children } = props;
  const disabled = !!locked || !!historyLoading;
  const completion = completeSlashCommand(draft);
  const canSend = !streaming && !!draft.trim() && !disabled;
  const input = useComposerInput({ onDraftChange, onSend, focusKey, completion, canSend });
  return (
    <div className="rlc-composer">
      {notice}
      <div className="rlc-inputwrap" data-state={completion ? "completing" : undefined}>
        {completion && <SlashGhost completion={completion} />}
        <textarea {...input.textarea} className="rlc-textarea" rows={1} placeholder={placeholder} value={draft} disabled={disabled} />
        <div className="rlc-composer-row">
          <ContextChip label={chip} />
          <span className="rlc-hint">{composerHint({ streaming, historyLoading, locked, completing: !!completion })}</span>
          {streaming ? <StopButton onStop={onStop} /> : <SendButton onSend={input.send} disabled={!draft.trim() || disabled} />}
        </div>
      </div>
      {children}
    </div>
  );
}
