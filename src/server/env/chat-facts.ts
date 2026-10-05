import { JEV } from "./chat.ts";
import type { EnvGroup } from "./types.ts";

export const chatFacts: EnvGroup = {
  title: "Chat: facts, routing and /teach",
  note: "Facts and the similarity lanes are documented in src/server/facts/CLAUDE.md. Re-run a lane's eval before moving its margin.",
  vars: [
    { name: "CHAT_PREFETCH", doc: "The fact registry. 0 turns off every fact at once.", default: "1" },
    {
      name: "CHAT_FACT_SIMILARITY",
      doc: "The on-device embedding lane for every consumer: features, census routing, tier routing and the promised-tool guard. 0 leaves only the regex lanes.",
      default: "1",
    },
    {
      name: "CHAT_FACT_SIMILARITY_MARGIN",
      doc: "Features lane threshold, permissive by design. Raise it (0.0, 0.15) to inject the guide less often.",
      default: "-0.05",
    },
    {
      name: "CHAT_CENSUS_SIMILARITY_MARGIN",
      doc: "Census routing threshold, set where labeled and real-traffic false fires are both zero. Lower it only after `pnpm eval:census` with DATABASE_URL set.",
      default: "0.4",
    },
    {
      name: "CHAT_COMPLEXITY_SIMILARITY_MARGIN",
      doc: "Tier router's similarity threshold. Raise it to escalate less, lower it to send more whole-corpus questions to the strong tier.",
      default: "0.25",
    },
    {
      name: "CHAT_ANNOUNCEMENT_SIMILARITY_MARGIN",
      doc: "Promised-tool guard threshold, at the zero-false-fire point.",
      default: "0.25",
    },
    {
      name: "CHAT_PREFETCH_JUDGE_MODEL",
      doc: "One Jev request before the first token, feeding tier routing, census routing and the /teach filter. \"\" turns it off and every lane runs its fallback.",
      default: JEV,
    },
    {
      name: "CHAT_PREFETCH_JUDGE_DEADLINE_MS",
      doc: "Wall-clock cap on that judgement; a miss falls back to the regex and similarity lanes.",
      default: "600",
    },
    {
      name: "CHAT_SMALLTALK_JUDGE_MODEL",
      doc: "Final gate on skipping the audit for pure conversation. \"\" turns the bypass off and every turn is audited.",
      default: JEV,
    },
    { name: "CHAT_TEACH", doc: "/teach notes: the command, the miss hint, injection and the system-prompt section. 0 turns all four off.", default: "1" },
    { name: "CHAT_TEACH_MAX_PER_DAY", doc: "Notes one user may teach in a day.", default: "40" },
    {
      name: "CHAT_TEACH_REVIEW_MODEL",
      doc: "Reviews a /teach note for gibberish. Unset: the first CHAT_MODEL_STRONG model, else CHAT_MODEL. \"\" keeps only the heuristic.",
    },
    { name: "CHAT_TEACH_REVIEW_TIMEOUT_MS", doc: "Ceiling on that review.", default: "15000" },
  ],
};
