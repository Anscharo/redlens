// Renames: a body the test calls replaced, that the TITLE shows was renamed.
// Two rules, and both yield to a demonstrated relocation (identity.ts). Pure.
// Measurements: docs/research/identity-swap-detection.md, threads 3 and 11.

import { BODY_TEST_MAX_CELLS, words, wordsInOrder } from "./identity-text.ts";
import { titleSubstitution, titleSubstitutions } from "./identity-titles.ts";
import type { SwapNode } from "./identity-types.ts";

// Renamed in place: once the title's substitution is applied to the old body,
// at least this much of it survives. The two real renames score 1.000 and the
// next real retitle 0.537; at 0.80 it starts to spare swaps between
// one-sentence templates ("The party 'Sky' comprises…").
export const RENAME_MIN_KEPT = 0.9;
// A bulk rename: this many documents in one diff took the identical title
// substitution. Low, because titleSubstitution already refuses a substitution
// that replaces most of a title.
export const CAMPAIGN_MIN_DOCS = 2;

/** Was this document RENAMED IN PLACE — its body changed by the same
 *  substitution its title underwent, and by little else? Returns the fraction
 *  of the old body's words that survive into the new one once that
 *  substitution is applied, or null when the title made no substitution or the
 *  body holds none of the words it replaced.
 *
 *  This is the case an entity rename produces and the word measure misreads:
 *  "Launch Agent 4 Details" → "Obex Details", whose one-sentence body names
 *  the agent four times, keeps exactly 9 of its 18 words. It needs no second
 *  document to agree, unlike renameCampaigns, which cannot help here anyway:
 *  the rename replaces three of the title's four words, so it yields no key. */
export function renameScore(main: SwapNode, prev: SwapNode): number | null {
  const subs = titleSubstitutions(main.title, prev.title);
  if (!subs.length) return null;
  const old = words(main.content);
  const renamed: string[] = [];
  let replaced = 0;
  for (let i = 0; i < old.length; ) {
    const sub = subs.find(([from]) => from.every((w, k) => old[i + k] === w));
    if (sub) {
      renamed.push(...sub[1]);
      i += sub[0].length;
      replaced++;
    } else renamed.push(old[i++]);
  }
  if (!replaced) return null;
  const now = words(prev.content);
  if (renamed.length * now.length > BODY_TEST_MAX_CELLS) return null;
  return wordsInOrder(renamed, now) / renamed.length;
}

/** The changed documents whose retitle is one document's share of a bulk
 *  rename — the same substitution applied across at least CAMPAIGN_MIN_DOCS of
 *  them. The per-document gate cannot see this: three UUIDs independently
 *  repurposed to matching titles is implausible, one terminology pass is
 *  obvious. A corpus-level judgement, so it is computed once per diff.
 *
 *  Its exposure is correlated and cannot be tuned out: at the level of titles,
 *  "the Keel docs now hold the Obex docs" and "we renamed Keel to Obex" are
 *  the same edit. What tells them apart is the displaced content. */
export function renameCampaigns(args: {
  changed: Iterable<string>;
  mainById: Map<string, SwapNode>;
  previewById: Map<string, SwapNode>;
}): Set<string> {
  const byEdit = new Map<string, string[]>();
  for (const id of args.changed) {
    const main = args.mainById.get(id);
    const prev = args.previewById.get(id);
    if (!main || !prev) continue;
    const key = titleSubstitution(main.title, prev.title);
    if (!key) continue;
    const group = byEdit.get(key);
    if (group) group.push(id);
    else byEdit.set(key, [id]);
  }
  const members = new Set<string>();
  for (const ids of byEdit.values()) {
    if (ids.length >= CAMPAIGN_MIN_DOCS) for (const id of ids) members.add(id);
  }
  return members;
}
