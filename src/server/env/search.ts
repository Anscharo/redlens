import type { EnvGroup } from "./types.ts";

export const openrouter: EnvGroup = {
  title: "OpenRouter and semantic search",
  vars: [
    {
      name: "OPENROUTER_API_KEY",
      doc: "Model and embedding calls (chat, Jev, sync:embeddings, query embeds). Unset: semantic search is empty and lexical search still works.",
      default: "",
      example: "",
    },
    {
      name: "OPENROUTER_MANAGEMENT_KEY",
      doc: "Provisioning key for the account credits endpoint behind the chat's shared commons meter (OpenRouter → Settings → Provisioning Keys). The model key is rejected there. Unset: no commons meter and no shared-pool gate.",
      default: "",
      example: "",
    },
    {
      name: "OPENROUTER_BASE_URL",
      doc: "API base. An empty value also falls back to the default, so a blank variable never sends calls to api.openai.com.",
      default: "https://openrouter.ai/api/v1",
    },
    {
      name: "OPENROUTER_APP_KIND",
      doc: "eval files the process's spend under \"Sky Atlas Redline Evals\". Entry points under scripts/eval/ get it automatically; any other eval needs it set.",
    },
    {
      name: "EMBED_MODEL",
      doc: "Embedding model. Its dimension is fixed by the database migration, not by env. Every stored vector records the model that made it, so changing this re-embeds the corpus on the next sync. The query prefix, the cosine floor and the leaf rule follow the model.",
      default: "google/gemini-embedding-2",
    },
    { name: "EMBED_BATCH", doc: "Texts per embeddings request in sync:embeddings.", default: "50" },
    {
      name: "EMBED_REQUEST_TIMEOUT_MS",
      doc: "Ceiling on one embed attempt, so a hung provider socket cannot park a call. Below about 20 s it cuts healthy batches mid-backoff. docs/DEPLOYMENT.md covers a dead provider.",
      default: "120000",
    },
    {
      name: "EMBED_QUERY_PREFIX",
      doc: "Instruction prefix for QUERY embeds only; stored document vectors stay raw. Unset, it follows EMBED_MODEL: Qwen's generic retrieval instruction for a Qwen model, none otherwise (queryPrefixFor in config.ts). Changing it re-embeds nothing.",
      default: "",
    },
    {
      name: "SEMANTIC_MIN_SCORE",
      doc: "Cosine floor for semantic hits, so a query with few true matches does not fill top slots with unrelated neighbours. Unset, it follows EMBED_MODEL: each model's floor is fitted by the same rule (0.55 for gemini-embedding-2, 0.30 for qwen3-embedding-8b).",
      default: "0.55",
    },
    {
      name: "SEMANTIC_EMBED_TIMEOUT_MS",
      doc: "Ceiling on the query-time embed; past it the search answers lexical-only. Provider p95 is 5-10 s, so a lower cap degrades many chat turns.",
      default: "10000",
    },
    { name: "QUERY_EMBED_CACHE_SIZE", doc: "In-process LRU of query embeddings. 0 disables it.", default: "512" },
    {
      name: "SEARCH_SEMANTIC_RPM",
      doc: "Shared per-minute budget for the reader's meaning lane, which is public and unauthenticated. One settled search is one embedding call, so 60 carries roughly 15 people searching at once. 0 disables the gate. In process, so N replicas allow N times this.",
      default: "60",
    },
  ],
};
