// Prompt construction for the risk-rules assessment (docs/risk-assessment-rubric.md).
// Triage asks Jev yes/no questions (assess-risk-jev.ts) and so writes no prose;
// the assess stage writes the paragraph's description with its rating. The
// rubric's axes + catalog + calibration are embedded verbatim at runtime so a
// rubric edit changes rubricVersion and re-queues every rating.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AtlasNode } from "../../src/types";
import type { RiskCandidate } from "../../src/lib/riskRules";
import { RISK_DOMAIN_LABELS } from "../../src/lib/riskRules";
import { ancestorChain } from "./assess-common";

export const RUBRIC_PATH = path.resolve(import.meta.dir, "../../docs/risk-assessment-rubric.md");

export function loadRubric(): { text: string; version: string } {
  const text = fs.readFileSync(RUBRIC_PATH, "utf8");
  return { text, version: crypto.createHash("sha256").update(text).digest("hex").slice(0, 12) };
}

// Axes + catalog + calibration are the rating instructions; scope/process
// sections govern enumeration and storage, which are code's job.
export function rubricAxes(text: string): string {
  const start = text.indexOf("## Axis 1");
  const end = text.indexOf("## Process requirements");
  return start !== -1 && end !== -1 ? text.slice(start, end).trim() : text;
}

// Catalog uuids the assess stage may cite — verified against docs.json at
// script start (the summaries live in the rubric itself, which is in-prompt).
export const MECHANISM_UUIDS: string[] = [
  "b8ee2d12-c94b-4d22-b55e-d2b6e6d94ad0", // A.3.2.2.7.2 Penalty Mechanisms
  "5c3dd35a-0c67-44c2-b51b-d40bc865af85", // A.3.2.2.7.2.1.4 Conservatorship For Breach Of Capital Requirements
  "12b7d480-68a0-4493-9534-d6915f86c112", // A.2.2.10.1.1.3.2.1.4 Risk-Capital Incident Response
  "bce9331b-04ca-4c50-9783-098739fc72c8", // A.3.2.2.1.1.1.1.1.2.1 Liquidation Penalty
  "0082c12d-f1a7-46ff-a4aa-5fe42ece1a4d", // A.3.3.2.1.1 Peg Stability Module
  "3eb6f099-2736-4f62-9cb8-096a8fcca757", // A.3.5 Surplus Buffer and Smart Burn Engine
  "4d8b0d82-97da-4041-b185-4b98c2779cbe", // A.3.6 SKY Backstop
  "b8266c11-3a84-4bbe-abe2-de9474f74ffd", // A.1.10.5 Emergency Spells
  "1d940c6d-02ce-4c17-8057-cef13c1cc7ad", // A.1.9 Emergency Response System
  "fd1f682c-2d8a-47c5-8c1d-d95a0a2f2021", // A.1.10.2.3.2.2.1.4.2.2 Risk-Based Pricing Of Insurance
  "d4bf73e7-2f9f-454c-8add-614dff784f78", // A.1.14.2.10 Agent Artifact Review By Core GovOps
  "c6c6f595-b29d-48b1-8196-79d15428e78c", // A.1.3.2.4 Reports Of Misalignment (catch-all)
  "560e1024-0897-4f1e-ae71-3ba31e29ed57", // A.1.5.9 Adjudication Process (catch-all)
];

const CONTENT_CAP = 6000;
export const capped = (s: string) => (s.length > CONTENT_CAP ? `${s.slice(0, CONTENT_CAP)}\n[…truncated]` : s);

export const candidateHeader = (c: RiskCandidate, docs: Record<string, AtlasNode>) => [
  `Paragraph: ${c.title} (${c.docNo})`,
  `Context: ${ancestorChain(docs[c.uuid], docs) || "(top level)"}`,
  `Pre-filter domains: ${c.domains.map((d) => RISK_DOMAIN_LABELS[d]).join(", ")}${c.anchored ? " (in a risk-anchor subtree)" : " (keyword match outside anchors)"}`,
  c.agents?.length ? `Replicated across Prime Agents: ${c.agents.join(", ")}` : null,
];

// --- Stage 2: assess -------------------------------------------------------

const ASSESS_SCHEMA = `{"description": "one plain sentence, <=20 words, describing what the paragraph regulates",
 "preciseness": 1|2|3|4|5,
 "precisenessReasoning": "1-3 sentences naming the concrete evidence (thresholds present, metrics missing, …)",
 "metrics": ["each quantifiable metric/threshold/deadline the rule states, verbatim-ish; [] if none"],
 "enforcement": "weak|mid|strong",
 "mechanismUuids": ["uuid of each mechanism doc the rating relies on; [] if none"],
 "enforcementReasoning": "1-3 sentences citing the mechanism and why it reaches this rule, or stating none found"}`;

export function buildAssessSystemPrompt(rubricText: string): string {
  return `You are a risk manager — expert in market risk, portfolio construction, cyber security, smart contract audit, stablecoins, and peg maintenance. You critically assess risk-management rules in the Sky Atlas (Sky Core mints the USDS stablecoin; Primes/Stars allocate USDS) against a fixed rubric. Respond with a single JSON object only — no prose, no markdown fences.

<rubric>
${rubricAxes(rubricText)}
</rubric>

Output exactly this JSON shape:
${ASSESS_SCHEMA}

Rules:
- An enforcement rating of mid or strong MUST cite at least one mechanism UUID — from the rubric's catalog, or a UUID that appears verbatim in the paragraph text. If nothing citable reaches this rule, rate weak and say "none found".
- The two catch-all mechanisms alone always mean weak. Self-enforcement is always weak.
- Step back for implicit enforcement: on-chain automatic mechanisms, capital at risk, and priced incentives count even when the paragraph never mentions them — but you must still cite the mechanism doc.
- Rate the text the regulated party would be held to, not what the document probably intends.
- A stub paragraph ("specified in a future iteration") is preciseness 1; rate its enforcement on what exists today.
- description: neutral and concrete ("Requires Primes to hold 5% of collateral as ASC").`;
}

export function buildAssessUserPrompt(
  c: RiskCandidate,
  docs: Record<string, AtlasNode>,
): string {
  return [
    ...candidateHeader(c, docs),
    c.stub ? `Deterministic flag: contains "future iteration" stub language` : null,
    ``,
    `The rule text to assess (the paragraph's full content):`,
    "```",
    capped(c.quote),
    "```",
  ].filter((l): l is string => l !== null).join("\n");
}
