// The risk-rule candidate universe for docs/risk-assessment-rubric.md §Scope:
// every atlas paragraph that may define a risk-management rule, parameter, or
// process across three domains (peg maintenance / allocation risk / smart
// contract security). Deterministic pre-filter only — the LLM triage stage
// decides rule-vs-mention; this module decides candidate-vs-unrelated with
// census-style exclusion buckets.

import type { AtlasBundle } from "./docs";
import type { AtlasNode } from "../types";
import { normalizeAssessedText } from "./oeaTasks";

export type RiskDomain = "peg" | "alloc" | "sc";

export const RISK_DOMAIN_LABELS: Record<RiskDomain, string> = {
  peg: "Peg Maintenance",
  alloc: "Allocation Risk",
  sc: "Smart Contract Security",
};

export interface RiskCandidate {
  taskKey: string; // u:<uuid> | t:<title>|risk (identical agent-artifact copies)
  uuid: string; // representative doc (lowest doc_no for collapsed copies)
  docNo: string;
  title: string;
  quote: string; // the paragraph's full exact text — what gets assessed
  domains: RiskDomain[];
  anchored: boolean; // in an anchor subtree (vs keyword residue)
  agents?: string[]; // covered Prime Agents for agent-artifact rows
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
// supporting detail. Kept as an explicit, audited UUID list instead, same
// pattern as ANCHORS/MECHANISM_UUIDS above.
const KNOWN_NON_RULE_UUIDS = new Set([
  "20dcf582-8862-48b3-9ca9-c3703871bd14", // A.1.9.1 Emergency Response — topic sentence + pointer to Emergency Spells
  "56b1cc27-a9e3-4099-8f1f-648da7d1c56b", // A.1.10.2.4.12.3.3 Additional Community Developed Spell Validation Checks
  "19222532-1ce1-4306-8129-ea95a982c247", // A.1.10.4 Governance Security Culture And Research — aspirational framing, no operative content
  "75473c4b-69ba-4e6b-bbf6-2c926732364c", // A.2.4.1.2 Implementation — scopes a subtree, not itself a rule
  "f999239e-8676-4772-b201-2e00920b2bfb", // A.3.2.2.1.1.1.2.1.1 Ethena — "specified in the documents herein"
  "2397551e-9704-435e-b815-0384429be224", // A.3.2.2.1.3.3.3 Ethena — defers CRR calc to another doc entirely
  "ce3affe8-9e1f-4825-82bd-40c320a1c220", // A.3.5.2.2.1.1.1 Kicker Threshold Current Value — defers the value elsewhere
  "a1ff2a3d-7131-425c-80c5-a887a4259f12", // A.3.2.2.1.1.1.5.2.3 Determine Risk Weights — restates the title, zero content
  "b83be319-7f7e-4cf5-ad70-ac59302422e4", // A.6.1.1.5.2.6.2.4 In Progress Invocations — pure bookkeeping pointer
]);
const STUB_RE = /(further (populated|developed|defined|specified)|be (populated|developed|defined|specified)( further)?) (in|during) (a |the )?(future|later|subsequent) iteration/i;
const METRICS_RE = /\d+(\.\d+)?\s*%|\bbps\b|basis points|\b\d+\s(hours?|days?|weeks?|months?|years?)\b|\$\s?\d|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d+)?\s?(million|billion)\b/i;

const AGENT_ARTIFACT_RE = /^A\.6\.1\.1\.\d+\./;
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
    if (KNOWN_NON_RULE_UUIDS.has(node.id)) { drop("container"); continue; }
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
    for (const c of copies) dropKeys.add(c.taskKey);
    excluded["collapsed-copy"] = (excluded["collapsed-copy"] ?? 0) + copies.length;
  }

  const candidates = rows
    .filter((r) => !dropKeys.has(r.taskKey))
    .sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
  return { candidates, excluded };
}
