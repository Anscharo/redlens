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

/** `cast.first` is the spell's earliest cast (ISO), null when never cast; `cast.casts` whether the cast list has been read at all. */
export function verdictFor(f: ArchiveFields, cast: { first: string | null; casts: boolean }): ArchiveVerdict {
  const v = (status: ArchiveVerdict["status"], reason: string): ArchiveVerdict => ({ ...f, status, reason });
  if (!f.spell) return v("rejected", "the file names no spell address");
  if (!f.title || !f.date) return v("rejected", "the file has no title or no date");
  if (!cast.casts) return v("pending", "the DSPause casts are not read yet");
  if (!cast.first) return v("rejected", `spell ${f.spell} was never cast through DSPause`);
  if (cast.first.slice(0, 10) < f.date) return v("rejected", `spell ${f.spell} was cast on ${cast.first.slice(0, 10)}, before the vote's date ${f.date}`);
  return v("verified", `DSPause.exec ran spell ${f.spell} on ${cast.first.slice(0, 10)}`);
}
