// Which documents a retrieval-eval query's target competes with at close range.
//
// One definition, two readers. `pnpm briefings:plan --eval-targets` uses it to
// choose what the pilot describes; `eval-retrieval.ts --briefings` uses it to
// decide which queries it may score. They must agree: if only a query's target
// had a briefing and its competing siblings had none, the briefing signal would
// favour the target for being covered, not for being right — and a guard that
// computed "covered" differently from the plan would not catch it.
import type { AtlasNode } from "../../src/types.ts";
import { parentDocNo, type EmbedUnit } from "../../src/server/retrieval/embed-units.ts";
import type { RetrievalQuery } from "./eval-retrieval-queries.ts";

/**
 * query id → the UUIDs its target competes with.
 *
 * For each target: its whole embedding unit, every unit anchored beside that
 * unit under the same parent, and then every sibling set any of those documents
 * sits in, completed. Siblings are grouped by doc-number parent, the structural
 * use embed-units.ts itself makes (`parentId` is capped at heading depth 6).
 */
export function competingSets(
  docs: AtlasNode[],
  units: EmbedUnit[],
  queries: RetrievalQuery[],
): Map<string, Set<string>> {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const parentOf = (id: string) => parentDocNo(byId.get(id)?.doc_no ?? "") ?? "";
  const siblings = new Map<string, string[]>();
  for (const d of docs) {
    const key = parentDocNo(d.doc_no) ?? "";
    const set = siblings.get(key);
    if (set) set.push(d.id);
    else siblings.set(key, [d.id]);
  }
  const unitOf = new Map<string, EmbedUnit>();
  const unitsByParent = new Map<string, EmbedUnit[]>();
  for (const unit of units) {
    unitOf.set(unit.anchorId, unit);
    for (const id of unit.memberIds) unitOf.set(id, unit);
    const key = parentOf(unit.anchorId);
    const list = unitsByParent.get(key);
    if (list) list.push(unit);
    else unitsByParent.set(key, [unit]);
  }

  const out = new Map<string, Set<string>>();
  for (const query of queries) {
    const near = new Set<string>();
    for (const target of query.relevant) {
      const unit = unitOf.get(target);
      if (!unit) continue;
      for (const beside of unitsByParent.get(parentOf(unit.anchorId)) ?? []) {
        near.add(beside.anchorId);
        for (const id of beside.memberIds) near.add(id);
      }
    }
    const complete = new Set<string>();
    for (const id of near) for (const sib of siblings.get(parentOf(id)) ?? []) complete.add(sib);
    out.set(query.id, complete);
  }
  return out;
}

/** True when every document the query's target competes with has a briefing. */
export function fullyCovered(competing: Set<string> | undefined, covered: ReadonlySet<string>): boolean {
  if (!competing || competing.size === 0) return false;
  for (const id of competing) if (!covered.has(id)) return false;
  return true;
}
