// Deterministic markdown export of the risk assessment — the client's exact
// table shape (title+link / description / quote / preciseness / enforcement),
// grouped by domain. Derived purely from the committed artifact, no LLM.

import type { RiskAssessmentArtifact, RiskAssessmentEntry } from "../../src/lib/riskAssessment";
import { RISK_DOMAIN_LABELS, type RiskDomain } from "../../src/lib/riskRules";

const SITE = "https://atlas.redline.support";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function row(e: RiskAssessmentEntry): string {
  const link = `[${e.docNo} ${cell(e.title)}](${SITE}/atlas?id=${e.uuid})`;
  const quote = cell(e.quote);
  const precise = `**${e.preciseness}/5** — ${cell(e.precisenessReasoning)}`;
  const enforce = `**${e.enforcement}** — ${cell(e.enforcementReasoning)}`;
  return `| ${link} | ${cell(e.description)} | ${quote} | ${precise} | ${enforce} |`;
}

export function renderMarkdown(artifact: RiskAssessmentArtifact): string {
  const lines: string[] = [
    `# Sky Atlas — Risk Rules Assessment`,
    ``,
    `Scope: peg maintenance · allocation risk · smart contract security. ` +
      `${artifact.assessments.length} rules. Assessed by ${artifact.assessModel} ` +
      `(human-reviewed) against rubric ${artifact.rubricVersion}; atlas commit ${artifact.atlasCommit ?? "unknown"}.`,
  ];
  for (const domain of Object.keys(RISK_DOMAIN_LABELS) as RiskDomain[]) {
    const rows = artifact.assessments.filter((e) => e.domains[0] === domain);
    if (!rows.length) continue;
    lines.push(
      ``,
      `## ${RISK_DOMAIN_LABELS[domain]} (${rows.length})`,
      ``,
      `| Paragraph | Description | Exact quote | Preciseness (1–5) | Penalties / incentives |`,
      `|---|---|---|---|---|`,
      ...rows.map(row),
    );
  }
  return `${lines.join("\n")}\n`;
}
