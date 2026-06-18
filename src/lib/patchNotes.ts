// Patch-notes parsing — turns the grouped markdown in
// src/content/patch-notes.md into ordered date groups for the homepage.
// Pure data logic so it's unit-testable without React (matches the project's
// convention, e.g. staleDates.ts / activeDataIndex.ts). The markdown is a
// flat, known shape (## YYYY-MM-DD headings + `- bullet` lines), so no
// markdown library is needed.

export interface PatchNoteGroup {
  date: string; // raw YYYY-MM-DD, as written in the file
  items: string[];
}

const DATE_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const BULLET_RE = /^\s*-\s+(.+)$/;

// Parse the grouped markdown into ordered date groups (file order, already
// newest-first), then truncate to the first `limit` bullets total. Groups are
// preserved; a partially-consumed group keeps only its surviving bullets;
// emptied groups are dropped.
export function parsePatchNotes(raw: string, limit = 7): PatchNoteGroup[] {
  const groups: PatchNoteGroup[] = [];
  let current: PatchNoteGroup | null = null;
  let total = 0;

  for (const line of raw.split("\n")) {
    if (total >= limit) break;

    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      current = { date: dateMatch[1], items: [] };
      groups.push(current);
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch && current) {
      current.items.push(bulletMatch[1].trim());
      total++;
    }
    // Blank lines, comments, and any other text are ignored.
  }

  return groups.filter((g) => g.items.length > 0);
}

// Display formatter for a YYYY-MM-DD date, e.g. "Jun 18, 2026". Parsed as UTC
// so the label doesn't shift by a day depending on the viewer's timezone.
export function formatPatchDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
