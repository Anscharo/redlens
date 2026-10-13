// Agreement statistics for assess-risk-triage-compare.ts: how often a
// probability model, cut at a threshold τ, gives the same triage verdict as
// the stored labels. The labels are another model's verdicts, not ground
// truth, so the disagreement list is for a human to read.

import { RISK_DOMAINS, type RiskCandidate } from "../../src/lib/riskRules";
import type { RiskTriageEntry, RiskTriageProbabilities } from "../../src/lib/riskAssessment";
import { verdictAt } from "./assess-risk-jev";

export interface Pair { c: RiskCandidate; label: RiskTriageEntry; p: RiskTriageProbabilities }

const TAUS = [0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8];
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
const isRow = (t: { inScope: boolean; isRule: boolean }) => t.inScope && t.isRule;

function rowAt(pairs: Pair[], tau: number): string {
  const v = pairs.map((x) => ({ x, v: verdictAt(x.p, { rule: tau, domain: tau }) }));
  const same = (f: (x: Pair, t: ReturnType<typeof verdictAt>) => boolean) => pct(v.filter(({ x, v: t }) => f(x, t)).length, v.length);
  const both = v.filter(({ x, v: t }) => isRow(t) && isRow(x.label)).length;
  const mine = v.filter(({ v: t }) => isRow(t)).length;
  const theirs = v.filter(({ x }) => isRow(x.label)).length;
  return [
    tau.toFixed(2),
    same((x, t) => t.isRule === x.label.isRule),
    ...RISK_DOMAINS.map((d) => same((x, t) => t.domains.includes(d) === x.label.domains.includes(d))),
    same((x, t) => isRow(t) === isRow(x.label)),
    String(mine), pct(both, mine), pct(both, theirs),
  ].join(" | ");
}

export function agreementTable(pairs: Pair[]): string {
  const head = "τ | isRule | peg | alloc | sc | row | rows | of rows, label agrees | of label rows, found";
  return [head, head.replace(/[^|]/g, "-"), ...TAUS.map((t) => rowAt(pairs, t))].join("\n");
}

const fmt = (p: RiskTriageProbabilities) =>
  `rule ${p.isRule.toFixed(2)} · peg ${p.peg.toFixed(2)} · alloc ${p.alloc.toFixed(2)} · sc ${p.sc.toFixed(2)}`;

export function disagreements(pairs: Pair[], tau: number): string {
  const v = pairs.map((x) => ({ x, t: verdictAt(x.p, { rule: tau, domain: tau }) }));
  const line = ({ x }: { x: Pair }) =>
    `- ${x.c.docNo} ${x.c.title} · label: ${x.label.inScope ? x.label.domains.join("+") : "out"}${x.label.isRule ? "" : " not-rule"} · ${fmt(x.p)}`;
  const onlyMine = v.filter(({ x, t }) => isRow(t) && !isRow(x.label));
  const onlyTheirs = v.filter(({ x, t }) => !isRow(t) && isRow(x.label));
  return [
    `# Triage disagreements at τ ${tau}`, ``,
    `## Row only for the probability model (${onlyMine.length})`, ``, ...onlyMine.map(line), ``,
    `## Row only for the label (${onlyTheirs.length})`, ``, ...onlyTheirs.map(line), ``,
  ].join("\n");
}
