// Per-user in-flight request cap on /api/chat — a second, independent gate
// alongside the token-budget window (rate-limit.ts). That budget is checked
// once per request against PAST usage, so it cannot see a turn's cost until
// the turn has already finished; it does nothing to stop one user from
// opening many simultaneous turns at once. This module catches that shape
// directly by counting requests currently in flight per user.
//
// In-memory Map, same pattern as sse.ts's client registry: correct because
// this service runs as a replicas=1 singleton by design (CLAUDE.md) — no
// cross-process coordination needed.
const inFlight = new Map<string, number>();

// Returns true and reserves a slot if the caller is under the limit; false
// (no slot reserved) if they're already at it. Every true result MUST be
// paired with exactly one releaseChatSlot call, however the request ends
// (early return, error, or normal stream completion).
export function tryAcquireChatSlot(userId: string, max: number): boolean {
  const count = inFlight.get(userId) ?? 0;
  if (count >= max) return false;
  inFlight.set(userId, count + 1);
  return true;
}

export function releaseChatSlot(userId: string): void {
  const count = inFlight.get(userId) ?? 0;
  if (count <= 1) inFlight.delete(userId);
  else inFlight.set(userId, count - 1);
}

export function inFlightChatCount(userId: string): number {
  return inFlight.get(userId) ?? 0;
}
