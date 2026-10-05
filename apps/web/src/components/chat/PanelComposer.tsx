import { Composer } from "./Composer";
import { ErrorNote } from "./ErrorNote";
import { LimitsMeter } from "./LimitsMeter";
import { RateLimitNote } from "./RateLimitNote";
import { useChatPanel } from "./chatPanelContext";

// The 429 lock note wins over the failed-turn note: a 429 already carries its
// full explanation, and the stale error would otherwise resurface the instant
// the lock lifts. The policy lives here, next to both pieces of session
// state — the composer just renders the slot.
function ComposerNotice() {
  const { session } = useChatPanel();
  if (session.rateLimit) return <RateLimitNote rateLimit={session.rateLimit} onRecheck={() => void session.refresh()} />;
  return <ErrorNote message={session.error} />;
}

export interface PanelComposerProps {
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Bump to move focus into the input. */
  focusKey: number;
}

// The signed-in composer, wired to the panel's session: send/stop, the lock
// and loading states, the page's placeholder and chip, and the limits meter.
export function PanelComposer({ draft, onDraftChange, focusKey }: PanelComposerProps) {
  const { session, page, send } = useChatPanel();
  return (
    <Composer
      draft={draft}
      onDraftChange={onDraftChange}
      onSend={() => send(draft)}
      onStop={session.stop}
      streaming={session.streaming}
      focusKey={focusKey}
      locked={!!session.rateLimit}
      notice={<ComposerNotice />}
      placeholder={page.placeholder}
      chip={page.chip}
      historyLoading={session.loadingHistory}
    >
      <LimitsMeter usage={session.usage} commons={session.commons} contextTokens={session.contextTokens} contextWindowTokens={session.contextWindow} />
    </Composer>
  );
}
