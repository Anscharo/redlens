// Panel-level notice for a failed turn (SSE "error" event, or a fetch/read
// exception in useChatStream). Sits above the composer input so it's visible
// without scrolling the thread and can't be mistaken for an assistant answer —
// distinct chip styling, not markdown, not inside a turn. Hidden while a
// rate-limit lock is active (RateLimitNote owns that story instead — see
// Composer, which renders at most one of the two). Cleared by the caller
// (ChatPanel/useChatStream) as soon as the next send is attempted.
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rlc-error" role="alert">
      <span className="rlc-error-dot" aria-hidden="true" />
      <span className="rlc-error-text">{message} — send another message to try again.</span>
    </div>
  );
}
