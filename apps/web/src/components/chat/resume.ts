// Reload-resume snapshot for the chat widget. sessionStorage (not
// localStorage): per-tab, so two open chats don't overwrite each other and
// closing one doesn't wipe another's snapshot. Survives a reload, dies with
// the tab. While the panel is open, ChatWidget keeps this snapshot current
// (and re-stamps it on pagehide, the reliable reload/close signal); an
// explicit close clears it. On mount, a snapshot fresher than
// RESUME_WINDOW_MS reopens the panel on the same conversation — so a page
// refresh mid-chat lands back exactly where it was, while a brand-new tab
// (or a long-dead one) starts collapsed as usual.
const KEY = "rlc-resume";

export const RESUME_WINDOW_MS = 30_000;

export interface ResumeSnapshot {
  at: number; // epoch ms of the last moment the chat was known open
  conversationId: string | null; // null = a fresh, not-yet-persisted thread
  title: string | null;
}

export function writeResume(s: ResumeSnapshot): void {
  sessionStorage.setItem(KEY, JSON.stringify(s));
}

export function clearResume(): void {
  sessionStorage.removeItem(KEY);
}

// Returns the snapshot only while it's still fresh; stale or malformed reads
// are null AND cleared, so an expired snapshot can't linger around to confuse
// a later session.
export function readFreshResume(now = Date.now()): ResumeSnapshot | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<ResumeSnapshot>;
    if (typeof s.at !== "number" || now - s.at >= RESUME_WINDOW_MS) {
      clearResume();
      return null;
    }
    return { at: s.at, conversationId: s.conversationId ?? null, title: s.title ?? null };
  } catch {
    clearResume();
    return null;
  }
}
