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

// The default history budget, exported for the conversations list's
// estimated-context fallback (conversations.ts): stored text beyond this
// many chars can never be replayed into a future turn's context.
export const HISTORY_BUDGET_CHARS = DEFAULTS.budgetChars;

const TRUNCATION_MARK = "\n…[earlier message truncated]";

// Structural-only line: a heading, a horizontal rule, or a bold-only line
// (e.g. "**Summary:**" alone). The system prompt tells the model to answer in
// GFM markdown, so an answer-first response often OPENS with one of these —
// a heading naming the topic, occasionally a rule or a bold lead-in — before
// any prose. None of these carry the answer's substance on their own.
const STRUCTURAL_LINE_RE = /^(#{1,6}\s+\S|(?:-{3,}|\*{3,}|_{3,})$|\*\*[^*\n]+\*\*$)/;

function isStructuralParagraph(para: string): boolean {
  const lines = para
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lines.length > 0 && lines.every((l) => STRUCTURAL_LINE_RE.test(l));
}

// Lead paragraph capped at maxChars. The lead paragraph of an answer carries
// its conclusion (the system prompt demands answer-first), so it is the
// highest-value slice to keep from an old turn — UNLESS the answer opens with
// a heading (or other structural-only line): then the "first paragraph" by
// blank-line splitting is just a title, and keeping only that throws away every
// citation. Walk past any leading structural-only paragraphs first, so the
// paragraph boundary we cut at is the end of real prose. The slice returned
// still starts at content[0] (heading included, for topic context) — only the
// END of the cut moves forward to capture substance instead of stopping at
// the heading's own line break.
function truncateOld(content: string, maxChars: number): string {
  let searchFrom = 0;
  for (;;) {
    const nextBreak = content.indexOf("\n\n", searchFrom);
    if (nextBreak === -1) break; // no more paragraph breaks — nothing left to skip past
    const para = content.slice(searchFrom, nextBreak);
    if (!isStructuralParagraph(para)) break;
    searchFrom = nextBreak + 2;
  }
  const paraEnd = content.indexOf("\n\n", searchFrom);
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
