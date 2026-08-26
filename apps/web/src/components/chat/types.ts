// Shared type-only definitions for the chat widget. Colocated here (rather than
// declared in ChatWidget.tsx) so ChatWidget and ChatPanel don't form a type-only
// import cycle between each other.
export type Placement = "float" | "anchored";

// Mirrors SendResult["rateLimited"] (useChatStream.ts) — ChatPanel's own lock
// state, held across the composer-disabled period rather than just the one
// send() call. "token" lifts deterministically at resetsAt; "commons" only
// lifts once a fresh /api/usage read shows room in the shared pool again;
// "concurrent" (the per-user in-flight cap, chat/concurrency.ts) has no
// external signal to wait on at all — it clears itself as soon as one of the
// user's own in-flight turns finishes, typically within seconds — so it
// self-lifts on a short fixed timeout instead (useRateLimitLock.ts).
export interface RateLimitState {
  message: string;
  resetsAt?: string;
  kind: "token" | "commons" | "concurrent";
}
