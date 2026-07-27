// Conversation-history windowing for /api/chat. The DB keeps every message
// forever; the model does not need to re-read all of it every round. This
// caps what gets replayed: recent messages verbatim, older ones truncated to
// their lead paragraph, and a hard char budget beyond which the oldest are
// dropped entirely. Pure function — chat.ts applies it between the DB read
// and the messages array.
export interface HistoryRow {
  role: string;
  content: string;
}

export interface WindowOptions {
  keepRecent?: number; // newest messages kept verbatim (2 per turn)
  oldMaxChars?: number; // older messages truncated to this many chars
  budgetChars?: number; // total history budget; oldest dropped beyond it
}

const DEFAULTS: Required<WindowOptions> = {
  keepRecent: 8,
  oldMaxChars: 600,
  budgetChars: 24_000,
};

const TRUNCATION_MARK = "\n…[earlier message truncated]";

// Lead paragraph capped at maxChars. The lead paragraph of an answer carries
// its conclusion (the system prompt demands answer-first), so it is the
// highest-value slice to keep from an old turn.
function truncateOld(content: string, maxChars: number): string {
  const paraEnd = content.indexOf("\n\n");
  const cut = Math.min(paraEnd === -1 ? content.length : paraEnd, maxChars);
  if (cut >= content.length) return content;
  return content.slice(0, cut) + TRUNCATION_MARK;
}

export function windowHistory(history: HistoryRow[], opts: WindowOptions = {}): HistoryRow[] {
  const { keepRecent, oldMaxChars, budgetChars } = { ...DEFAULTS, ...opts };
  // Empty rows (e.g. an exhausted loop persisted "") add nothing and some
  // providers reject blank assistant content — drop them before windowing.
  const rows = history.filter((m) => m.content.trim() !== "");

  // Walk newest-first: verbatim inside keepRecent, truncated beyond it, and
  // stop entirely once the budget is spent (oldest messages drop first).
  const kept: HistoryRow[] = [];
  let spent = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const recent = rows.length - i <= keepRecent;
    const content = recent ? rows[i].content : truncateOld(rows[i].content, oldMaxChars);
    if (spent + content.length > budgetChars && kept.length > 0) break;
    spent += content.length;
    kept.unshift({ role: rows[i].role, content });
  }
  return kept;
}
