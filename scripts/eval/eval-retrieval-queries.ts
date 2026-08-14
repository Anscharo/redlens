// Deterministic retrieval queries derived from atlas structure.
// No LLM judge: each query has known relevant UUIDs.
//
// icd-param queries are the ones structured tools (atlas_entity_params /
// atlas_params) already answer — they stay in the set so grouping cannot
// claim a win by stealing that traffic from a worse semantic ranker.
import type { AtlasNode } from "../../src/types.ts";
import { isICD } from "../lib/graph-patterns.mjs";
import { extractInstanceParams, buildChildrenIndex } from "../lib/graph-instances.mjs";
import { DIRECTORY_RE, HUB_TITLE_RE } from "../../src/server/retrieval/embed-units.ts";

export type RetrievalSlice =
  | "icd-param"
  | "icd-disambiguation"
  | "directory"
  | "hub"
  | "control";

export interface RetrievalQuery {
  id: string;
  slice: RetrievalSlice;
  query: string;
  relevant: string[];
}

function icdShort(title: string): string {
  return title.replace(/\s+Instance Configuration Document\s*$/i, "").trim();
}

// Generic ICD param names that collide across instances — the disambiguation
// problem ("of N docs titled Network, the right instance").
const DISAMBIG_NAMES = /^(network|reward code|token|chain|rate|spread|fee)$/i;

function distinctive(short: string): boolean {
  const words = short.split(/\s+/).filter((w) => w.length > 1);
  return short.length >= 8 && words.length >= 2;
}

export function generateRetrievalQueries(docs: AtlasNode[], limit = 80): RetrievalQuery[] {
  const childrenByDocNo = buildChildrenIndex(docs) as Map<string, AtlasNode[]>;
  const out: RetrievalQuery[] = [];

  const icds = docs.filter((d) => isICD(d));
  const byParamName = new Map<string, { icd: AtlasNode; leafId: string; value: string }[]>();
  for (const icd of icds) {
    const params = extractInstanceParams(icd, childrenByDocNo) as Record<string, [string, string, string]>;
    for (const [name, [value, uuid]] of Object.entries(params)) {
      const arr = byParamName.get(name) ?? [];
      arr.push({ icd, leafId: uuid, value });
      byParamName.set(name, arr);
    }
  }

  // Instance-disambiguation: same generic param name across many ICDs, query
  // is "<distinctive instance> <param>" so the right leaf is the only hit.
  let dis = 0;
  const names = [...byParamName.entries()].sort((a, b) => {
    const ap = DISAMBIG_NAMES.test(a[0]) ? 0 : 1;
    const bp = DISAMBIG_NAMES.test(b[0]) ? 0 : 1;
    return ap - bp || b[1].length - a[1].length;
  });
  for (const [name, rows] of names) {
    if (rows.length < 4) continue;
    const distinct = rows.filter((r) => distinctive(icdShort(r.icd.title)));
    if (distinct.length < 4) continue;
    for (const row of distinct.slice(0, 4)) {
      out.push({
        id: `dis-${dis++}`,
        slice: "icd-disambiguation",
        query: `${icdShort(row.icd.title)} ${name}`,
        relevant: [row.leafId],
      });
      if (dis >= limit / 2) break;
    }
    if (dis >= limit / 2) break;
  }

  // Param name + value queries (sample). Structured tools already answer these.
  let p = 0;
  for (const icd of icds) {
    const params = extractInstanceParams(icd, childrenByDocNo) as Record<string, [string, string, string]>;
    const entries = Object.entries(params);
    if (entries.length === 0) continue;
    if (!distinctive(icdShort(icd.title))) continue;
    const [name, [value, uuid]] = entries[0]!;
    out.push({
      id: `param-${p++}`,
      slice: "icd-param",
      query: `${icdShort(icd.title)} ${name} ${value}`.slice(0, 180),
      relevant: [uuid],
    });
    if (p >= 40) break;
  }

  // Directory: "what is under <title>"
  let d = 0;
  for (const dir of docs) {
    if (!DIRECTORY_RE.test((dir.content ?? "").trim())) continue;
    const kids = childrenByDocNo.get(dir.doc_no) ?? [];
    if (kids.length < 2 || kids.length > 20) continue;
    out.push({
      id: `dir-${d++}`,
      slice: "directory",
      query: `${dir.title} ${kids.map((k) => k.title).slice(0, 3).join(" ")}`.slice(0, 180),
      relevant: [dir.id, ...kids.map((k) => k.id)],
    });
    if (d >= 20) break;
  }

  let h = 0;
  for (const hub of docs) {
    if (!HUB_TITLE_RE.test(hub.title)) continue;
    const kids = childrenByDocNo.get(hub.doc_no) ?? [];
    if (kids.length < 2) continue;
    out.push({
      id: `hub-${h++}`,
      slice: "hub",
      query: `which documents exist under ${hub.title}`.slice(0, 180),
      relevant: [hub.id, ...kids.map((k) => k.id)],
    });
    if (h >= 15) break;
  }

  // Control: longer Cores that are not ICD param leaves.
  const paramLeafIds = new Set([...byParamName.values()].flat().map((r) => r.leafId));
  let c = 0;
  for (const doc of docs) {
    if (doc.type !== "Core") continue;
    if (paramLeafIds.has(doc.id) || isICD(doc)) continue;
    if ((doc.content ?? "").length < 200) continue;
    const words = doc.title.split(/\s+/).filter((w) => w.length > 2).slice(0, 5).join(" ");
    if (words.length < 8) continue;
    out.push({ id: `ctrl-${c++}`, slice: "control", query: words, relevant: [doc.id] });
    if (c >= 40) break;
  }

  return out;
}
