// The spells one history change belongs to, as the history API serves them
// (HistoryEntry.spells): the ones its matched PR bullet names, else the ones its
// pull request names (atlas_prs.spell_refs, pr-spells.ts), each a date the year
// of the change resolves (src/lib/atlasPrSpell.ts). A change with no pull
// request names none; one whose PR record is not read yet is left unknown.
import { resolveSpellRefs, spellRefs } from "../../lib/atlasPrSpell.ts";

export interface SpellRow {
  pr_number: number | null;
  summary: string | null;
  description: string | null;
  /** jsonb: an array, or a JSON string on a row written double-encoded; null while unread. */
  pr_spell_refs?: unknown;
}

const asRefs = (v: unknown): string[] | null => {
  const parsed = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : null;
};

/** The change's spells as YYYY-MM-DD; undefined while its PR is not read. */
export function entrySpells(row: SpellRow, date: string): string[] | undefined {
  const resolve = (refs: string[]) => (date ? resolveSpellRefs(refs, date) : refs.filter((r) => !r.startsWith("--")));
  const own = [...spellRefs(row.summary), ...spellRefs(row.description)];
  if (own.length) return resolve(own);
  if (row.pr_number == null) return [];
  const refs = asRefs(row.pr_spell_refs ?? null);
  return refs ? resolve(refs) : undefined;
}
