// Evidence for the export gate, split by provenance so a file built on the MSC
// brief faces the same non-Atlas attribution rules the harness applies to the
// chat answer (a file outlives the conversation — CLAUDE.md's citation dictate
// is strictest about it). Which tool_call_ids belong to the external tool is
// read back off the transcript rather than tracked in the loop's own state —
// any downstream consumer of the transcript classifies those rounds identically.
import type { ExportEvidence } from "../tools/export-verify.ts";
import { isExternalMscTool } from "../../external/envelope.ts";
import { isUserTeachingTool } from "../teach/inject.ts";
import { isReviewRound } from "../review-round.ts";
import type { Msg } from "./types.ts";

function toolCallIdsByKind(msgs: Msg[]): { externalIds: Set<string>; teachingIds: Set<string> } {
  const externalIds = new Set<string>();
  // A user's /teach notes ride a synthetic tool round (teach/inject.ts). They
  // are neither atlas text nor external figures, so an export must not treat
  // them as grounding — the orchestrator already excludes them from atlas
  // evidence (splitFromTranscript), and this is the export-side twin.
  const teachingIds = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      if (tc.type !== "function") continue;
      if (isExternalMscTool(tc.function.name)) externalIds.add(tc.id);
      else if (isUserTeachingTool(tc.function.name)) teachingIds.add(tc.id);
    }
  }
  return { externalIds, teachingIds };
}

export function exportEvidence(msgs: Msg[]): ExportEvidence {
  const { externalIds, teachingIds } = toolCallIdsByKind(msgs);
  const atlasTexts: string[] = [];
  const externalTexts: string[] = [];
  for (const m of msgs) {
    if (typeof m.content !== "string") continue;
    if (m.role === "tool") {
      if (teachingIds.has(m.tool_call_id)) continue;
      // The review round (review-round.ts) is verifier output about this
      // conversation, not atlas text — and an exported file is held to the
      // STRICTEST reading of CLAUDE.md's citation dictate, so certifying a quote
      // against a check result is the worst place for it. Excluded here for the
      // same reason the teach notes above are.
      if (isReviewRound(m.tool_call_id)) continue;
      (externalIds.has(m.tool_call_id) ? externalTexts : atlasTexts).push(m.content);
    } else if (m.role === "assistant") atlasTexts.push(m.content);
  }
  return { atlasTexts, externalTexts };
}
