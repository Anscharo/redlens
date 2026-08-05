// Deterministic verification of an export artifact before it's handed to the
// user. The export tool emits a file mid-loop, BEFORE the reliability harness
// audits the turn — and the harness only ever sees the chat answer ("your file
// is downloading"), never the file body. Without this pass, fabricated
// citations, invented doc numbers, ungrounded quotes, or invented addresses in
// the downloaded Markdown/CSV would ship unchecked (see PR #239 review).
//
// This reuses the SAME pure, LLM-free helpers the harness runs on the chat
// answer (verify-checks + citation repair) — no network, no model, no Postgres,
// so it fits the loop's purity constraint. It does NOT run the model verifier;
// that's the harness's job on the answer, and adding it here would put verifier
// latency on every export. The coupling to verify/ lives in this module (not the
// pure export-tool.ts builder) so the builder stays dependency-light.
import { runDeterministicChecks } from "../verify/verify-checks.ts";
import { repairCitations } from "../verify/citation-repair.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ExportArtifact } from "./export-tool.ts";

export type ExportCheck = { ok: true; content: string } | { ok: false; problems: string[] };

// Human-readable, model-actionable lines for each hard failure — mirrors the
// harness's own describeCheckFailures so a refused export tells the model
// exactly what to fix.
function problemsFrom(
  checks: ReturnType<typeof runDeterministicChecks>,
  stripped: { title: string; target: string }[],
  includeQuotes: boolean,
): string[] {
  const out: string[] = [];
  for (const u of checks.invalidCitations) out.push(`cited document ${u} does not exist in the atlas`);
  for (const s of stripped) out.push(`citation to "${s.target}" could not be matched to a real atlas document`);
  for (const d of checks.invalidDocNos) out.push(`document number ${d} does not exist in the atlas`);
  for (const m of checks.docNoMismatches) out.push(`misattributed citation: ${m}`);
  for (const a of checks.ungroundedAddresses) out.push(`address ${a} appears in no evidence retrieved this turn`);
  if (includeQuotes) {
    for (const q of checks.ungroundedQuotes) out.push(`quoted text not found in any retrieved source: "${q.slice(0, 80)}"`);
  }
  return out;
}

// Verify (and, for Markdown, repair) an export artifact against the turn's
// evidence. Returns the content to ship (citation-repaired for Markdown) or the
// list of problems the model must fix before re-exporting.
//
// CSV skips citation repair (bytes must stay exact) and quote-grounding: every
// RFC-4180 cell is wrapped in double quotes, which the quote extractor would
// read as verbatim-quote claims and false-positive on. The hard, low-false-
// positive signals (invalid UUIDs / doc numbers, misattribution, invented
// addresses) apply to both formats.
export function checkExportArtifact(artifact: ExportArtifact, evidenceTexts: string[], ix: Indexes): ExportCheck {
  if (artifact.format === "markdown") {
    const repair = repairCitations(artifact.content, evidenceTexts, ix);
    const checks = runDeterministicChecks(repair.content, evidenceTexts, ix);
    const problems = problemsFrom(checks, repair.stripped, true);
    return problems.length ? { ok: false, problems } : { ok: true, content: repair.content };
  }
  // csv
  const checks = runDeterministicChecks(artifact.content, evidenceTexts, ix);
  const problems = problemsFrom(checks, [], false);
  return problems.length ? { ok: false, problems } : { ok: true, content: artifact.content };
}
