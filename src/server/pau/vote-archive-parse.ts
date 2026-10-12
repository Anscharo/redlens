// The rules vote-archive.ts applies to one makerdao/community executive file:
// what its frontmatter says, and whether the chain bears it out. Pure.

export interface ArchiveFields {
  spell: string | null;
  title: string | null;
  date: string | null;
}

export interface ArchiveVerdict extends ArchiveFields {
  status: "pending" | "verified" | "rejected";
  reason: string;
}

const field = (fm: string, name: string) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(fm)?.[1].trim().replace(/^"(.*)"$/, "$1") ?? null;

// The repository files each vote under a template title, "Template - [Executive
// Vote] <what it does> - <date>"; the archive keeps what it does and its date.
const cleanTitle = (t: string) => t.replace(/^template\s*-\s*/i, "").replace(/^\[executive (vote|proposal)\]\s*/i, "").trim();

export function readFrontmatterFields(md: string): ArchiveFields {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? "";
  const address = field(fm, "address");
  const title = field(fm, "title");
  const date = field(fm, "date");
  return {
    spell: address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null,
    title: title ? cleanTitle(title) : null,
    date: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
  };
}

/**
 * What the spell contract says of itself: `done()`, and `expiration()` (unix
 * seconds), the last moment it can be cast. `done` is null when the spell
 * could not be read; `expiration` is null when it has none (spells before
 * mid-2020) or it could not be read.
 */
export interface SpellState {
  done: boolean | null;
  expiration: number | null;
}

const day = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/** Why a spell with no recorded cast has none, from its own state; null when it may still be cast or the state is unread. */
function notCast(spell: string, s: SpellState, now: number): ArchiveVerdict["reason"] | null {
  if (s.done !== false) return null;
  if (s.expiration === null) return `spell ${spell} reports it was not cast as of ${day(now / 1000)}, and has no expiration()`;
  return s.expiration * 1000 < now ? `spell ${spell} expired on ${day(s.expiration)} without being cast` : null;
}

/** The verdict on one file: a recorded DSPause cast verifies it; otherwise the spell's own done() and expiration() decide whether it never will be. */
export function verdictFor(f: ArchiveFields, first: string | null, state: SpellState, now: number): ArchiveVerdict {
  const v = (status: ArchiveVerdict["status"], reason: string): ArchiveVerdict => ({ ...f, status, reason });
  if (!f.spell) return v("rejected", "the file names no spell address");
  if (!f.title || !f.date) return v("rejected", "the file has no title or no date");
  if (first) {
    if (first.slice(0, 10) < f.date) return v("rejected", `spell ${f.spell} was cast on ${first.slice(0, 10)}, before the vote's date ${f.date}`);
    return v("verified", `DSPause.exec ran spell ${f.spell} on ${first.slice(0, 10)}`);
  }
  const never = notCast(f.spell, state, now);
  if (never) return v("rejected", never);
  if (state.done === true) return v("pending", `spell ${f.spell} reports done(); its cast is not in the cast list yet`);
  if (state.done === false) return v("pending", `spell ${f.spell} is not cast yet and can be until ${day(state.expiration!)}`);
  return v("pending", `spell ${f.spell}'s done() could not be read`);
}
