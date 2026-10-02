import type { EnvGroup } from "./types.ts";

// Jev lanes default to the pinned release in config.ts's JEV_DEFAULT; each lane
// reads its own variable, so "" on one turns off that lane alone.
export const JEV = "typesafe/jev-1.13";

export const chatModels: EnvGroup = {
  title: "Chat: models and loop",
  note: "Model slots follow one convention: unset takes the default, \"\" turns the feature off. Routing and the harness are described in docs/chat-system.md.",
  vars: [
    { name: "CHAT_MODEL", doc: "Primary conversationalist.", default: "google/gemma-4-31b-it", key: "chatModel" },
    { name: "CHAT_MODEL_FALLBACKS", doc: "CSV of OpenRouter fallbacks for the default chain; unset tiers inherit it.", default: "", key: "chatModelFallbacks" },
    { name: "CHAT_MODEL_FAST", doc: "CSV: primary then fallbacks for the fast tier. Unset inherits CHAT_MODEL and its fallbacks.", default: "", key: "chatModelFast" },
    { name: "CHAT_MODEL_STRONG", doc: "CSV: primary then fallbacks for the strong tier. Unset inherits CHAT_MODEL and its fallbacks.", default: "", key: "chatModelStrong" },
    {
      name: "CHAT_REFERENCE_CITATION_MODELS",
      doc: "Models prompted for reference-style citations. A literal list of models measured clean for the format, independent of CHAT_MODEL_STRONG, so swapping the strong tier never asks an unmeasured model for it. Every model accepts both formats; see docs/plans/reference-citations.md.",
      default: "openai/gpt-5.6-luna,openai/gpt-5-mini",
      key: "chatReferenceCitationModels",
    },
    { name: "CHAT_TEMPERATURE", doc: "Sampling temperature of the conversationalist. Judges stay at 0.", default: "0.3", key: "chatTemperature" },
    {
      name: "CHAT_MAX_OUTPUT_TOKENS",
      doc: "Ceiling per completion request. It stops a runaway generation, not a long answer: exhaustive governance answers need well over 4096.",
      default: "16000",
      key: "chatMaxOutputTokens",
    },
    {
      name: "CHAT_MAX_ITERATIONS",
      doc: "Hard cap on tool rounds. Every round replays the full context, so round count drives latency.",
      default: "4",
      key: "chatMaxIterations",
    },
    { name: "CHAT_MAX_ITERATIONS_STRONG", doc: "Tool-round cap for the strong tier, never below CHAT_MAX_ITERATIONS.", default: "6", key: "chatMaxIterationsStrong" },
    {
      name: "CHAT_TOOL_RESULT_MAX_CHARS",
      doc: "Budget for one tool result fed back to the model, so one broad call cannot fill the context.",
      default: "30000",
      key: "chatToolResultMaxChars",
    },
    {
      name: "CHAT_CONTEXT_WINDOW_TOKENS",
      doc: "Window the context meter and compaction use: the smallest model in the deployed routing chains, because a failover sends the same context. Change it with the chains.",
      default: "200000",
      key: "chatContextWindowTokens",
    },
    {
      name: "CHAT_SUMMARY_MODEL",
      doc: "Compacts a thread's prefix at 90% of the window. Its output is replayed for the rest of the thread, so it is pinned rather than following CHAT_MODEL. \"\" turns compaction off.",
      default: "openai/gpt-5.6-luna",
      key: "chatSummaryModel",
    },
    { name: "CHAT_SUMMARY_TIMEOUT_MS", doc: "Ceiling on the compaction call.", default: "60000", key: "chatSummaryTimeoutMs" },
    {
      name: "CHAT_TITLE_MODEL",
      doc: "Writes 3-6 word conversation titles after assistant turns 1, 4 and 10; a manual rename freezes the title. \"\" turns titling off and keeps the first 60 characters of the opening message.",
      default: "google/gemma-4-31b-it",
      key: "chatTitleModel",
    },
    {
      name: "CHAT_TITLE_TIMEOUT_MS",
      doc: "Ceiling on the titling call, which runs after the response closes, so it costs no latency. On timeout the existing title stays.",
      default: "20000",
      key: "chatTitleTimeoutMs",
    },
    {
      name: "CHAT_EXTERNAL_SUBAGENT_MODEL",
      doc: "Isolated MSC sub-agent. Unset falls back to CHAT_VERIFIER_MODEL; \"\" returns the deterministic brief without a model call.",
      default: "",
      key: "chatExternalSubagentModel",
    },
    { name: "CHAT_EXTERNAL_SUBAGENT_TIMEOUT_MS", doc: "Ceiling on the MSC sub-agent call.", default: "15000", key: "chatExternalSubagentTimeoutMs" },
    {
      name: "CHAT_CAPTURE_CONTENT",
      doc: "Prompt and response text on PostHog $ai_generation events. On unless 0, which keeps only token, latency and cost metadata.",
      default: "1",
      key: "chatCaptureContent",
    },
    {
      name: "CHAT_JEV_MODEL",
      doc: "Jev model for callers that name none of their own. It is not a kill switch; each Jev lane has its own variable.",
      default: JEV,
      key: "chatJevModel",
    },
  ],
};
