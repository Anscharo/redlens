import { JEV } from "./chat.ts";
import type { EnvGroup } from "./types.ts";

export const chatVerify: EnvGroup = {
  title: "Chat: verification",
  note: "How the verifier works: src/server/chat/CLAUDE.md and docs/chat-system.md §6.",
  vars: [
    { name: "CHAT_VERIFY_CHECKS", doc: "Deterministic checks, which cost nothing. 0 turns them off.", default: "1", key: "chatVerifyChecks" },
    {
      name: "CHAT_VERIFIER_MODEL",
      doc: "Audit model, from a different family than CHAT_MODEL. \"\" turns model verification off; the deterministic checks still run.",
      default: "",
      key: "chatVerifierModel",
    },
    {
      name: "CHAT_VERIFIER_SLICE_MODELS",
      doc: "Per-auditor overrides, \"refute=m1,overreach=m2,confirm=m3\". Unnamed auditors use CHAT_VERIFIER_MODEL.",
      default: "",
      key: "chatVerifierSliceModels",
    },
    {
      name: "CHAT_VERIFIER_SLICE_TIMEOUT_MS",
      doc: "Per-auditor deadline. Auditors run concurrently after the stream, so a turn pays about one.",
      default: "45000",
      key: "chatVerifierSliceTimeoutMs",
    },
    { name: "CHAT_VERIFIER_EVIDENCE_MAX_CHARS", doc: "Evidence digest budget for the audit, newest round first.", default: "120000", key: "chatVerifierEvidenceMaxChars" },
    {
      name: "CHAT_REFUTE_MODE",
      doc: "paragraph: the refute audit runs on each paragraph as it closes, catching more and landing sooner. answer: one call over the finished answer. Any other value means paragraph.",
      default: "paragraph",
      key: "chatRefuteMode",
    },
    { name: "CHAT_REFUTE_CONCURRENCY", doc: "Refute calls in flight per burst.", default: "3", key: "chatRefuteConcurrency" },
    {
      name: "CHAT_REFUTE_MAX_PARAGRAPHS",
      doc: "Paragraphs past this many in one burst share one extra call; every call carries the full evidence, so call count drives input tokens.",
      default: "8",
      key: "chatRefuteMaxParagraphs",
    },
    {
      name: "CHAT_REFUTE_SCREEN",
      doc: "Jev screen in front of the per-paragraph refute. shadow: recorded beside the audit, which still runs on every paragraph. gate: the audit runs only on flagged paragraphs. off: no screen.",
      default: "shadow",
      key: "chatRefuteScreen",
    },
    { name: "CHAT_REFUTE_SCREEN_MODEL", doc: "Model of that screen.", default: JEV, key: "chatRefuteScreenModel" },
    {
      name: "CHAT_CITATION_CHECK_MODEL",
      doc: "Judges each claim against each document it cites and marks the Sources chips. \"\" turns it off.",
      default: JEV,
      key: "chatCitationCheckModel",
    },
    {
      name: "CHAT_ANSWER_COVERAGE_MODEL",
      doc: "Asks whether the answer answered every part of the question. \"\" turns it off.",
      default: JEV,
      key: "chatAnswerCoverageModel",
    },
    {
      name: "CHAT_QUOTE_ATTRIBUTION",
      doc: "Asks whether an ungrounded quoted span is presented as source wording. shadow: judged and recorded, severity unchanged. gate: hard-fails only at P ≥ CHAT_QUOTE_ATTRIBUTION_MARGIN; turn it on only once the bakeoff has set the margin on real traffic. off: no call.",
      default: "shadow",
      key: "chatQuoteAttribution",
    },
    { name: "CHAT_QUOTE_ATTRIBUTION_MODEL", doc: "Model of that judgement.", default: JEV, key: "chatQuoteAttributionModel" },
    {
      name: "CHAT_QUOTE_ATTRIBUTION_MARGIN",
      doc: "Gate threshold, unmeasured: 0.5 is a Noul's neutral point. Read only in gate mode.",
      default: "0.5",
      key: "chatQuoteAttributionMargin",
    },
  ],
};
