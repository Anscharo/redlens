// The risk-rule candidate universe for docs/risk-assessment-rubric.md §Scope:
// every atlas paragraph that may define a risk-management rule, parameter, or
// process across three domains (peg maintenance / allocation risk / smart
// contract security). Deterministic pre-filter only — the LLM triage stage
// decides rule-vs-mention; this module decides candidate-vs-unrelated with
// census-style exclusion buckets.

import type { AtlasBundle } from "./docs";
import type { AtlasNode } from "../types";
import { normalizeAssessedText } from "./oeaTasks";
import riskNonRuleDocs from "./data/risk-non-rule-docs.json";

export type RiskDomain = "peg" | "alloc" | "sc";

export const RISK_DOMAIN_LABELS: Record<RiskDomain, string> = {
  peg: "Peg Maintenance",
  alloc: "Allocation Risk",
  sc: "Smart Contract Security",
};

// One per-agent location of a collapsed agent-artifact rule. The report
// re-expands collapsed candidates into one visible row per copy (joinRisk),
// so every agent's own doc shows up — the collapse exists only to assess the
// shared clause once, not to hide locations.
export interface RiskCopy {
  uuid: string;
  docNo: string;
  quote: string; // that agent's own paragraph text
  agent: string;
}

export interface RiskCandidate {
  taskKey: string; // u:<uuid> | t:<title>|risk (identical agent-artifact copies)
  uuid: string; // representative doc (lowest doc_no for collapsed copies)
  docNo: string;
  title: string;
  quote: string; // the paragraph's full exact text — what gets assessed
  domains: RiskDomain[];
  anchored: boolean; // in an anchor subtree (vs keyword residue)
  agents?: string[]; // covered Prime Agents for agent-artifact rows
  copies?: RiskCopy[]; // per-agent locations of a collapsed rule (incl. the rep)
  stub: boolean; // "specified in a future iteration" — preciseness-1 finding
  hasMetrics: boolean; // carries quantifiable tokens (%/bps/amounts/durations)
}

export interface RiskEnumeration {
  candidates: RiskCandidate[];
  excluded: Record<string, number>; // census buckets among risk-matching docs
}

// Anchor subtrees: every descendant is in scope by construction (keyword
// matching alone misses ~half of A.3). UUID-keyed; doc_nos are comments.
const ANCHORS: [string, RiskDomain[]][] = [
  ["80f168a3-4a01-40dd-bb57-851f48d58912", ["peg"]], // A.3.1 Core Stability Parameters
  ["55999acf-75fe-4adf-8584-9746ef50d3e4", ["alloc"]], // A.3.2 Risk Capital
  ["6478afd5-7c3f-4bed-a2b7-9f8ee402bb64", ["peg", "alloc"]], // A.3.3 Asset Liability Management
  ["edd96df7-4058-4a74-a6e5-827df31e5fdd", ["alloc"]], // A.3.4 Real World Assets
  ["3eb6f099-2736-4f62-9cb8-096a8fcca757", ["alloc"]], // A.3.5 Surplus Buffer / Smart Burn Engine
  ["4d8b0d82-97da-4041-b185-4b98c2779cbe", ["alloc"]], // A.3.6 SKY Backstop
  ["92b5164c-2a55-4947-bb8a-9b05ca5ed8c8", ["alloc"]], // A.3.7.1 Endgame Transition measures
  ["1d940c6d-02ce-4c17-8057-cef13c1cc7ad", ["sc"]], // A.1.9 Emergency Response System
  ["de0cc370-de9c-48a4-b10e-91782df7abcd", ["sc"]], // A.1.10 Sky Core Governance Security
  ["d1142876-33c2-4e21-9339-d8711525d46f", ["alloc"]], // A.2.2.10 Supply Side Stablecoin Primitives
];
export const RISK_ANCHOR_UUIDS: string[] = ANCHORS.map(([u]) => u);

// Strong-phrase residue matching for docs outside the anchors.
const KEYWORDS: Record<RiskDomain, RegExp> = {
  peg: /\bpeg\b|de-?peg|\bPSM\b|peg stability|price stability|\brepeg/i,
  alloc:
    /risk capital|\bRRC\b|\bTRC\b|\bOVRC\b|\bIJRC\b|debt ceiling|liquidat(?:e|ion|ed)|solvency|insolven|asset liability|surplus buffer|backstop|exposure (?:limit|cap|threshold)|concentration (?:limit|risk)|collateraliz(?:ation|ed) ratio|loan.to.value|\bLTV\b|risk (?:management|model|parameter|assessment|monitoring|framework|limit|mitigation|rating|premium)/i,
  sc: /smart contract|\baudit|vulnerabilit|exploit|bug bount|security (?:review|practice|registry|requirement)|emergency (?:shutdown|spell|action|process|response)|circuit breaker|timelock|multi-?sig|access control|admin key|kill switch|governance security|GSM pause/i,
};

const EXCLUDED_TYPES = new Set([
  "Annotation",
  "Scenario",
  "Scenario Variation",
  "Needed Research",
  "Type Specification",
]);
// A one-sentence intro whose only content is pointing at its children.
const CONTAINER_RE = /^(the (sub)?documents (herein|below)|this (article|section|scope|chapter) (defines|describes|outlines|governs|contains|specifies))/i;
// Reviewed-by-hand: paragraphs whose entire content is a pointer/deferral to
// another doc, in phrasing CONTAINER_RE's fixed opening-clause match doesn't
// cover (mid-sentence deferral, or a container framed as two full sentences).
// A generic regex for "defers everything to a link/section" over-matches badly
// across the corpus — real quantified rules routinely cite another doc for one
// supporting detail. Kept as an explicit, audited UUID list instead (see
// ./data/risk-non-rule-docs.json for the doc_no + reason behind each entry).
//
// Unlike the `!stub`-guarded CONTAINER_RE check just below, this UUID
// exclusion had no staleness guard: once curated, a doc dropped forever
// regardless of later content edits. Entries now carry an optional
// `quoteHash` (see riskDocContentHash below) recorded at curation time; the
// exclusion only applies while the doc's current content still hashes to
// that value. An entry with NO quoteHash (not yet backfilled) falls back to
// the old unconditional-exclude behavior, so this is non-breaking pre-backfill
// — see scripts/aux/backfill-risk-non-rule-hashes.mjs.
const nonRuleByUuid = new Map(riskNonRuleDocs.map((d) => [d.uuid, d as { uuid: string; docNo: string; reason: string; quoteHash?: string }]));

// A tiny, dependency-free, synchronous hash (FNV-1a). enumerateRiskCandidates
// runs both in the browser (RiskRulesReport.tsx) and under bun (assess-risk.ts),
// so it can't use node:crypto (node-only) or crypto.subtle (async-only) like
// the assessment-cache quoteHash in riskAssessment.ts does. This only needs to
// be internally consistent with itself (curation time vs. check time), not
// match that other artifact's hash format.
export function riskDocContentHash(content: string): string {
  const s = normalizeAssessedText(content);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
const STUB_RE = /(further (populated|developed|defined|specified)|be (populated|developed|defined|specified)( further)?) (in|during) (a |the )?(future|later|subsequent) iteration/i;
const METRICS_RE = /\d+(\.\d+)?\s*%|\bbps\b|basis points|\b\d+\s(hours?|days?|weeks?|months?|years?)\b|\$\s?\d|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d+)?\s?(million|billion)\b/i;

// fragile: doc_no prefix
const AGENT_ARTIFACT_RE = /^A\.6\.1\.1\.\d+\./;
// fragile: doc_no prefix
const AGENT_ROOT_RE = /^A\.6\.1\.1\.\d+$/;

const DOMAIN_ORDER: RiskDomain[] = ["peg", "alloc", "sc"];

function agentNameFor(node: AtlasNode, docs: Record<string, AtlasNode>): string | null {
  for (let p: string | null = node.parentId; p; p = docs[p]?.parentId ?? null) {
    const a = docs[p];
    if (!a) break;
    if (AGENT_ROOT_RE.test(a.doc_no)) return a.title;
  }
  return null;
}

export function enumerateRiskCandidates(bundle: AtlasBundle): RiskEnumeration {
  const { docs } = bundle;
  const all = Object.values(docs);

  // Every doc inside an anchor subtree, tagged with the anchor's domains.
  const kids = new Map<string, string[]>();
  for (const d of all) {
    if (!d.parentId) continue;
    const list = kids.get(d.parentId) ?? [];
    list.push(d.id);
    kids.set(d.parentId, list);
  }
  const anchorDomains = new Map<string, Set<RiskDomain>>();
  for (const [root, domains] of ANCHORS) {
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      const set = anchorDomains.get(id) ?? new Set<RiskDomain>();
      for (const dom of domains) set.add(dom);
      anchorDomains.set(id, set);
      stack.push(...(kids.get(id) ?? []));
    }
  }

  const excluded: Record<string, number> = {};
  const drop = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  const rows: RiskCandidate[] = [];

  for (const node of all) {
    const anchoredSet = anchorDomains.get(node.id);
    const haystack = `${node.title}\n${node.content}`;
    const domains = DOMAIN_ORDER.filter(
      (dom) => anchoredSet?.has(dom) || KEYWORDS[dom].test(haystack),
    );
    if (!domains.length) continue; // unrelated to risk
    const quote = node.content.trim();
    const stub = STUB_RE.test(quote);
    if (EXCLUDED_TYPES.has(node.type)) { drop(`type:${node.type}`); continue; }
    if (quote.length < 40) { drop("empty"); continue; }
    const nonRule = nonRuleByUuid.get(node.id);
    if (nonRule && (nonRule.quoteHash == null || nonRule.quoteHash === riskDocContentHash(quote))) {
      drop("container");
      continue;
    }
    if (!stub && quote.length < 180 && CONTAINER_RE.test(quote)) { drop("container"); continue; }
    rows.push({
      taskKey: `u:${node.id}`,
      uuid: node.id,
      docNo: node.doc_no,
      title: node.title,
      quote,
      domains,
      anchored: Boolean(anchoredSet),
      agents: AGENT_ARTIFACT_RE.test(node.doc_no)
        ? [agentNameFor(node, docs) ?? "(unknown agent)"]
        : undefined,
      stub,
      hasMetrics: METRICS_RE.test(quote),
    });
  }

  // Agent-artifact collapse: copies of the same clause replicated per Prime
  // become one row — but only when every copy's content is identical after the
  // Prime's own name is normalized away; per-Prime parameter docs with truly
  // differing contents stay separate uuid-keyed rows.
  const agentNames = all
    .filter((d) => AGENT_ROOT_RE.test(d.doc_no))
    .map((d) => d.title)
    .sort((a, b) => b.length - a.length);
  const collapseKey = (quote: string) => {
    let out = normalizeAssessedText(quote);
    for (const name of agentNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`${escaped}(’s|'s)?`, "gi"), "«agent»");
    }
    return out;
  };
  const byTitle = new Map<string, RiskCandidate[]>();
  for (const r of rows) {
    if (!AGENT_ARTIFACT_RE.test(r.docNo)) continue;
    const key = r.title.trim().toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), r]);
  }
  const dropKeys = new Set<string>();
  for (const [titleKey, group] of byTitle) {
    if (group.length < 2) continue;
    const contents = new Set(group.map((r) => collapseKey(r.quote)));
    if (contents.size !== 1) continue;
    group.sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
    const [rep, ...copies] = group;
    rep.taskKey = `t:${titleKey}|risk`;
    rep.agents = [...new Set(group.flatMap((r) => r.agents ?? []))];
    rep.copies = group.map((r) => ({
      uuid: r.uuid,
      docNo: r.docNo,
      quote: r.quote,
      agent: r.agents?.[0] ?? "(unknown agent)",
    }));
    for (const c of copies) dropKeys.add(c.taskKey);
    excluded["collapsed-copy"] = (excluded["collapsed-copy"] ?? 0) + copies.length;
  }

  const candidates = rows
    .filter((r) => !dropKeys.has(r.taskKey))
    .sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
  return { candidates, excluded };
}
