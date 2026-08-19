// Deterministic retrieval queries derived from atlas structure.
// No LLM judge: each query has known relevant UUIDs.
//
// Queries are PARAPHRASED (see eval-retrieval-paraphrase.ts): they share only the
// entity name with their target, never the field label or the value. Before
// 2026-08-18 they were built by concatenating the target's own strings, so 39 of 40
// icd-param queries contained the answer verbatim and the set measured lexical
// matching that BM25 already wins. Every number produced before that date is
// therefore suspect and its conclusions are open to re-investigation.
//
// Sampling STRIDES across candidates rather than taking the first N: the old
// `slice(0, 4)` gave 36 of 40 disambiguation queries to one product family
// (SparkLend x 4 tokens), so n=40 bought far less independent evidence than it looked.
//
// icd-param queries are the ones structured tools (atlas_entity_params /
// atlas_params) already answer — they stay in the set so grouping cannot
// claim a win by stealing that traffic from a worse semantic ranker.
import type { AtlasNode } from "../../src/types.ts";
import { isICD } from "../lib/graph-patterns.mjs";
import { extractInstanceParams, buildChildrenIndex } from "../lib/graph-instances.mjs";
import { DIRECTORY_RE, HUB_TITLE_RE, ancestorTitles, buildUnits } from "../../src/server/retrieval/embed-units.ts";
import { paraphraseFor } from "./eval-retrieval-paraphrase.ts";

export type RetrievalSlice =
  | "icd-param"
  | "icd-disambiguation"
  | "directory"
  | "hub"
  | "kv-record"
  | "control";

export interface RetrievalQuery {
  id: string;
  slice: RetrievalSlice;
  query: string;
  relevant: string[];
  // True when the query intentionally reuses the target's own wording — the lexical
  // control group. Everything else should paraphrase.
  lexicalControl?: boolean;
  // kv-record only: does this query's target sit in a subtree the GENERIC kv pass
  // folds, i.e. is it treated differently by kv_records_breadcrumbs than by
  // icd_params_breadcrumbs? Only differential queries carry signal about the
  // generic pass; non-differential ones are within-slice controls (scaffolding the
  // pass rejects, or docs the ICD pass — common to both arms — already owns).
  // The 2026-08-17 run had only 3/24 differential and was therefore uninformative;
  // emit this so every future run is self-diagnosing.
  differential?: boolean;
}

function icdShort(title: string): string {
  return title.replace(/\s+Instance Configuration Document\s*$/i, "").trim();
}

// Docs folded by kv_records_breadcrumbs' GENERIC pass but not by the ICD pass — i.e.
// the docs whose treatment actually differs between those two arms. Used to stratify
// the kv-record slice for power, never to build query text. Compared at the shipping
// crumb depth so the sets match what a `--crumb-depth 2` run indexes.
function genericOnlyFoldedIds(docs: AtlasNode[]): Set<string> {
  const grouped = (policy: "icd_params_breadcrumbs" | "kv_records_breadcrumbs") => {
    const ids = new Set<string>();
    for (const u of buildUnits(docs, policy, { crumbDepth: 2 })) {
      if (u.memberIds.length > 1) for (const id of u.memberIds) ids.add(id);
    }
    return ids;
  };
  const icdSide = grouped("icd_params_breadcrumbs");
  const out = new Set<string>();
  for (const id of grouped("kv_records_breadcrumbs")) if (!icdSide.has(id)) out.add(id);
  return out;
}

// Generic ICD param names that collide across instances — the disambiguation
// problem ("of N docs titled Network, the right instance").
const DISAMBIG_NAMES = /^(network|reward code|token|chain|rate|spread|fee)$/i;

// Take `n` items spread evenly across `xs` instead of the first n. The old
// slice(0, n) collapsed onto whichever family happened to sort first — 36 of 40
// disambiguation queries landed on SparkLend.
function stride<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return [...xs];
  const step = xs.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.floor(i * step)]!);
  return out;
}

function distinctive(short: string): boolean {
  const words = short.split(/\s+/).filter((w) => w.length > 1);
  return short.length >= 8 && words.length >= 2;
}

export function generateRetrievalQueries(docs: AtlasNode[], limit = 80): RetrievalQuery[] {
  // One question must not appear twice with different correct answers — it is
  // unanswerable and silently drags the score down. Paraphrasing makes collisions
  // MORE likely than the old raw-string queries did, so this guard is required.
  const emitted = new Set<string>();
  const fresh = (q: string) => (emitted.has(q) ? false : (emitted.add(q), true));
  const childrenByDocNo = buildChildrenIndex(docs) as Map<string, AtlasNode[]>;
  const byDocNo = new Map(docs.map((d) => [d.doc_no, d]));
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

  // Instance-disambiguation: ONE generic param name, asked about many DIFFERENT
  // instances, so the ranker has to pick the right instance among near-identical
  // documents. Strided across the whole candidate list so the families vary
  // (Aave, Morpho, Curve, Maple, Uniswap, Paxos …) instead of four tokens of one.
  let dis = 0;
  const disCap = Math.floor(limit / 2);
  const names = [...byParamName.entries()].sort((a, b) => {
    const ap = DISAMBIG_NAMES.test(a[0]) ? 0 : 1;
    const bp = DISAMBIG_NAMES.test(b[0]) ? 0 : 1;
    return ap - bp || b[1].length - a[1].length;
  });
  for (const [name, rows] of names) {
    const phrase = paraphraseFor(name);
    if (!phrase) continue; // no paraphrase => would leak the field label; skip
    const distinct = rows.filter((r) => distinctive(icdShort(r.icd.title)));
    if (distinct.length < 4) continue;
    for (const row of stride(distinct, 6)) {
      const q = phrase(icdShort(row.icd.title));
      if (!fresh(q)) continue;
      out.push({ id: `dis-${dis++}`, slice: "icd-disambiguation", query: q, relevant: [row.leafId] });
      if (dis >= disCap) break;
    }
    if (dis >= disCap) break;
  }

  // Param lookup: varied FIELDS across varied instances. The value is never included
  // — that was the old set's defect, and it made this a near-duplicate string match.
  let p = 0;
  const paramCandidates: { icd: AtlasNode; name: string; uuid: string }[] = [];
  for (const icd of icds) {
    if (!distinctive(icdShort(icd.title))) continue;
    const params = extractInstanceParams(icd, childrenByDocNo) as Record<string, [string, string, string]>;
    for (const [name, [, uuid]] of Object.entries(params)) {
      if (paraphraseFor(name)) paramCandidates.push({ icd, name, uuid });
    }
  }
  // Round-robin by field name so no single field can dominate the way
  // "Rate Limit IDs" took 39 of 40 slots.
  const byField = new Map<string, typeof paramCandidates>();
  for (const c of paramCandidates) {
    const k = c.name.toLowerCase();
    const arr = byField.get(k) ?? [];
    arr.push(c);
    byField.set(k, arr);
  }
  // Rotate each field's picks by its own index: without this, round 0 takes the first
  // entry of every field and they are all the same (alphabetically first) instance.
  const fields = [...byField.values()].map((v, i) => {
    const s = stride(v, 8);
    return [...s.slice(i % s.length), ...s.slice(0, i % s.length)];
  });
  outer: for (let round = 0; round < 8; round++) {
    for (const f of fields) {
      const c = f[round];
      if (!c) continue;
      const q = paraphraseFor(c.name)!(icdShort(c.icd.title));
      if (!fresh(q)) continue;
      out.push({ id: `param-${p++}`, slice: "icd-param", query: q, relevant: [c.uuid] });
      if (p >= 40) break outer;
    }
  }

  // Directory: "what is under <title>"
  let d = 0;
  for (const dir of docs) {
    if (!DIRECTORY_RE.test((dir.content ?? "").trim())) continue;
    const kids = childrenByDocNo.get(dir.doc_no) ?? [];
    if (kids.length < 2 || kids.length > 20) continue;
    const dq = `what is covered under ${dir.title}`.slice(0, 180);
    if (!fresh(dq)) continue;
    out.push({
      id: `dir-${d++}`,
      slice: "directory",
      // No child-title listing: pasting the children in made this a lexical test.
      query: dq,
      relevant: [dir.id, ...kids.map((k) => k.id)],
    });
    if (d >= 20) break;
  }

  let h = 0;
  for (const hub of docs) {
    if (!HUB_TITLE_RE.test(hub.title)) continue;
    const kids = childrenByDocNo.get(hub.doc_no) ?? [];
    if (kids.length < 2) continue;
    // Every hub is titled "Primitive Hub Document", so the title alone produced 15
    // copies of one unanswerable question — which is why this slice sat at exactly
    // 0.400 in every arm all session. Name the hub by its owner + primitive instead.
    const owner = ancestorTitles(hub, byDocNo).slice(-2).join(" ");
    if (!owner) continue;
    const q = `what does the ${owner} hub keep track of`.slice(0, 180);
    if (!fresh(q)) continue;
    out.push({
      id: `hub-${h++}`,
      slice: "hub",
      query: q,
      relevant: [hub.id, ...kids.map((k) => k.id)],
    });
    if (h >= 15) break;
  }

  // kv-record disambiguation: a generically-titled key/value record ("Freezer
  // Multisig", "Contract Addresses", "Role Hierarchy And Permissions") that occurs
  // under MULTIPLE agents, so the record title alone cannot identify the instance —
  // the agent has to come from context. This is the failure mode the existing
  // slices cannot see: they only cover ICD params, directories and hubs.
  //
  // Query TEXT is derived from atlas STRUCTURE only (titles + ancestor names), never
  // from unit text — sourcing wording from a unit would bias toward the folded
  // representation. Target SELECTION is stratified by whether the generic kv pass
  // folds the target, which is NOT a bias: both arms answer identical queries, so
  // concentrating on docs where the arms differ only buys statistical power. The
  // first version of this slice skipped that and landed 3/24 differential, which
  // made the 2026-08-17 run unable to say anything about the policy.
  const kvRoots = new Map<string, { root: AtlasNode; leaves: AtlasNode[]; agent: string }[]>();
  for (const root of docs) {
    const kids = childrenByDocNo.get(root.doc_no) ?? [];
    if (kids.length < 2 || kids.length > 12) continue;
    // Leaves must carry a VALUE, not directory prose. DIRECTORY_RE is a long-standing
    // atlas convention (the graph build uses it too), not part of this policy's gates.
    const leaves = kids.filter((k) => {
      const c = (k.content ?? "").trim();
      return (
        (childrenByDocNo.get(k.doc_no) ?? []).length === 0 &&
        c.length >= 5 &&
        c.length <= 400 &&
        !DIRECTORY_RE.test(c)
      );
    });
    if (leaves.length < 2) continue;
    // Outermost non-generic ancestor = the agent (Spark / Grove / Keel / Obex).
    const agent = ancestorTitles(root, byDocNo)[0];
    if (!agent) continue;
    const arr = kvRoots.get(root.title) ?? [];
    arr.push({ root, leaves, agent });
    kvRoots.set(root.title, arr);
  }
  // Most-collided titles first: more instances of the same record title = a harder,
  // more informative disambiguation.
  const kvFamilies = [...kvRoots.entries()]
    .filter(([, roots]) => new Set(roots.map((r) => r.agent)).size >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  const generic = genericOnlyFoldedIds(docs);
  const seenQueries = new Set<string>();
  const picked: { query: string; targets: string[]; differential: boolean }[] = [];
  for (const [title, roots] of kvFamilies) {
    const usedAgents = new Set<string>();
    for (const { root, leaves, agent } of roots) {
      if (usedAgents.has(agent)) continue; // one per agent — the point is cross-agent
      // Paraphrase the field the same way the ICD slices do, so a query shares only
      // the agent + record name with its target, never the field label.
      //
      // Many kv fields are one-off names ("Rate Limit Accounting", "Sky Details") that
      // no template can cover. Naming them would leak; omitting them would leave the
      // query unable to say WHICH leaf it wants. So when there is no paraphrase we
      // aim at the RECORD instead — question about the whole record, ground truth =
      // root + its leaves, exactly how the directory slice is scored.
      const leaf = leaves.find((l) => paraphraseFor(l.title));
      const phrase = leaf ? paraphraseFor(leaf.title) : null;
      const query = (
        phrase ? phrase(`${agent} ${title}`) : `what does ${agent} ${title} specify`
      ).slice(0, 180);
      const targets = leaf ? [leaf.id] : [root.id, ...leaves.map((l) => l.id)];
      if (seenQueries.has(query)) continue; // identical query, different answer = unanswerable
      seenQueries.add(query);
      usedAgents.add(agent);
      picked.push({ query, targets, differential: targets.some((t) => generic.has(t)) });
      if (usedAgents.size >= 3) break;
    }
  }
  // Stratify: fill half the slice with differential targets (the only ones that can
  // move between arms), half with controls, and take whatever's available if one
  // side is short — never silently emit an all-control slice again.
  const KV_TOTAL = 24;
  const diff = picked.filter((p) => p.differential);
  const ctrl = picked.filter((p) => !p.differential);
  const takeDiff = Math.min(diff.length, Math.ceil(KV_TOTAL / 2));
  const chosen = [...diff.slice(0, takeDiff), ...ctrl.slice(0, KV_TOTAL - takeDiff)];
  chosen.forEach((p, i) =>
    out.push({
      id: `kv-${i}`,
      slice: "kv-record",
      query: p.query,
      relevant: p.targets,
      differential: p.differential,
    }),
  );

  // Control: longer Cores that are not ICD param leaves.
  const paramLeafIds = new Set([...byParamName.values()].flat().map((r) => r.leafId));
  let c = 0;
  for (const doc of docs) {
    if (doc.type !== "Core") continue;
    if (paramLeafIds.has(doc.id) || isICD(doc)) continue;
    if ((doc.content ?? "").length < 200) continue;
    const words = doc.title.split(/\s+/).filter((w) => w.length > 2).slice(0, 5).join(" ");
    if (words.length < 8) continue;
    // The deliberate LEXICAL control: title words verbatim. Kept so we can still see
    // the lexical leg working, and flagged so the leakage report expects it to be high.
    if (!fresh(words)) continue;
    out.push({ id: `ctrl-${c++}`, slice: "control", query: words, relevant: [doc.id], lexicalControl: true });
    if (c >= 40) break;
  }

  return out;
}
