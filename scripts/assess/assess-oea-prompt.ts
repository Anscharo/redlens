// Prompt construction for the OEA duty assessment (docs/oea-assessment-rubric.md).
// The rubric's two axes + calibration examples are embedded verbatim at runtime
// so a rubric edit changes rubricVersion and re-queues every rating.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AtlasNode } from "../../src/types";
import type { OeaTask } from "../../src/lib/oeaTasks";
import { ancestorChain } from "./assess-common";

export const RUBRIC_PATH = path.resolve(import.meta.dir, "../../docs/oea-assessment-rubric.md");

export function loadRubric(): { text: string; version: string } {
  const text = fs.readFileSync(RUBRIC_PATH, "utf8");
  return { text, version: crypto.createHash("sha256").update(text).digest("hex").slice(0, 12) };
}

// The axes + calibration sections are the rating instructions; scope/process
// sections govern enumeration and storage, which are code's job, not the model's.
export function rubricAxes(text: string): string {
  const start = text.indexOf("## Axis 1");
  const end = text.indexOf("## Process requirements");
  return start !== -1 && end !== -1 ? text.slice(start, end).trim() : text;
}

// Known enforcement-mechanism docs the incentives axis can cite. Keyed by UUID
// (doc_nos in comments are for human reference only). Verified against
// docs.json at script start; grows under human review as new mechanisms
// surface in assessments.
export const MECHANISM_CATALOG: { uuid: string; title: string; summary: string }[] = [
  { uuid: "d4bf73e7-2f9f-454c-8add-614dff784f78", title: "Agent Artifact Review By Core GovOps", // A.1.14.2.10
    summary: "Core GovOps reviews Agent Artifacts on a schedule, with staged findings, published outcomes, and penalty assessment. Enforcer ≠ actor; reaches artifact-maintenance and artifact-accuracy duties." },
  { uuid: "b8ee2d12-c94b-4d22-b55e-d2b6e6d94ad0", title: "Penalty Mechanisms", // A.3.2.2.7.2
    summary: "Risk Capital penalty machinery — quantified financial penalties for Prime-side rule violations; reaches tasks whose failure creates measurable protocol risk." },
  { uuid: "de1592f5-dbce-46de-913f-6ec9589d36e8", title: "True Up In Subsequent Monthly Settlement Cycle", // A.2.4.1.2.1.5
    summary: "Settlement-cycle dispute and true-up process — calculation/payment errors surface and are corrected in the next cycle; consequences for the erring actor are not quantified." },
  { uuid: "cd9b64bd-9a0c-41ed-b02c-5cc6bfb231d3", title: "Emergency Process For Misaligned Agent Artifacts", // A.1.14.1.5.4
    summary: "Emergency correction path when an Agent Artifact is misaligned; a defined escalation with a named process." },
  { uuid: "7aafa61e-8649-41fb-8c3f-64e5714f9f18", title: "Acting Against Misalignment", // A.1.7.6
    summary: "Facilitators are required to act against observed misalignment — an escalation duty that gives other mechanisms a path to fire, but unquantified by itself." },
  { uuid: "c6c6f595-b29d-48b1-8196-79d15428e78c", title: "Reports Of Misalignment", // A.1.3.2.4
    summary: "Generic misalignment reporting entry point. CATCH-ALL: alone this is always a weak rating." },
  { uuid: "560e1024-0897-4f1e-ae71-3ba31e29ed57", title: "Adjudication Process", // A.1.5.9
    summary: "The atlas-wide adjudication backstop. CATCH-ALL: alone this is always a weak rating." },
];

const OUTPUT_SCHEMA = `{"precision": {"rating": "weak|mid|strong",
  "elements": {"actor": "present|partial|absent", "trigger": "…", "action": "…",
               "timeBound": "…", "completion": "…", "discretion": "…"},
  "reasoning": "1-3 sentences naming the present/missing elements by name"},
 "incentives": {"rating": "weak|mid|strong",
  "mechanismUuids": ["uuid of each mechanism doc the rating relies on; [] if none"],
  "reasoning": "1-3 sentences citing the mechanism or stating none found"}}`;

export function buildSystemPrompt(rubricText: string): string {
  const catalog = MECHANISM_CATALOG.map((m) => `- ${m.uuid} — ${m.title}: ${m.summary}`).join("\n");
  return `You rate tasks assigned to the Operational Executor Agent (OEA) in the Sky Atlas against a fixed rubric. Respond with a single JSON object only — no prose, no markdown fences.

<rubric>
${rubricAxes(rubricText)}
</rubric>

<mechanism-catalog>
Known enforcement mechanisms you may cite by UUID on the incentives axis:
${catalog}
</mechanism-catalog>

Output exactly this JSON shape:
${OUTPUT_SCHEMA}

Rules:
- An incentives rating of mid or strong MUST cite at least one mechanism UUID — from the catalog, or a UUID that appears verbatim in the document text. If no citable mechanism reaches this task, rate weak and say "none found".
- The two catch-all mechanisms alone always mean weak. Self-enforcement is always weak.
- For [automated] process steps: rate precision on the automation's spec; rate incentives on the OEA's duty to supervise the automation — and say so in the reasoning.
- Rate the text the OEA would be held to, not what the document probably intends.`;
}

const CONTENT_CAP = 6000;

export function buildUserPrompt(task: OeaTask, docs: Record<string, AtlasNode>): string {
  const node = docs[task.uuid];
  const content = node.content.length > CONTENT_CAP
    ? `${node.content.slice(0, CONTENT_CAP)}\n[…truncated]`
    : node.content;
  const textLabel = task.quoted
    ? "The text the OEA is held to (verbatim from the atlas)"
    : "Representative snippet — no single assigning sentence; rate the full document text below";
  return [
    `Task: ${task.title} (${task.docNo})`,
    `Context: ${ancestorChain(node, docs) || "(top level)"}`,
    `Category: ${task.category} · attributed via: ${task.sources.join(", ")}${task.automated ? " · [automated] process step" : ""}`,
    task.agents?.length ? `Covered Prime Agents: ${task.agents.join(", ")}` : null,
    ``,
    `${textLabel}:`,
    "```",
    task.assessedText,
    "```",
    ``,
    `Full document content:`,
    "```",
    content,
    "```",
  ].filter((l): l is string => l !== null).join("\n");
}
