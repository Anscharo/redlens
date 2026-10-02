import type { EnvGroup } from "./types.ts";

export const openrouter: EnvGroup = {
  title: "OpenRouter and semantic search",
  vars: [
    {
      name: "OPENROUTER_API_KEY",
      doc: "Model and embedding calls (chat, Jev, sync:embeddings, query embeds). Unset: semantic search is empty and lexical search still works.",
      default: "",
      example: "",
      key: "openrouterApiKey",
    },
    {
      name: "OPENROUTER_MANAGEMENT_KEY",
      doc: "Provisioning key for the account credits endpoint behind the chat's shared commons meter (OpenRouter → Settings → Provisioning Keys). The model key is rejected there. Unset: no commons meter and no shared-pool gate.",
      default: "",
      example: "",
      key: "openrouterManagementKey",
    },
    {
      name: "OPENROUTER_BASE_URL",
      doc: "API base. An empty value also falls back to the default, so a blank variable never sends calls to api.openai.com.",
      default: "https://openrouter.ai/api/v1",
      key: "openrouterBaseUrl",
    },
    {
      name: "OPENROUTER_APP_KIND",
      doc: "eval files the process's spend under \"Sky Atlas Redline Evals\". Entry points under scripts/eval/ get it automatically; any other eval needs it set.",
    },
    { name: "EMBED_MODEL", doc: "Embedding model. Its dimension is fixed by the database migration, not by env.", default: "qwen/qwen3-embedding-8b", key: "embedModel" },
    { name: "EMBED_BATCH", doc: "Texts per embeddings request in sync:embeddings.", default: "50" },
    {
      name: "EMBED_REQUEST_TIMEOUT_MS",
      doc: "Ceiling on one embed attempt, so a hung provider socket cannot park a call. Below about 20 s it cuts healthy batches mid-backoff. docs/DEPLOYMENT.md covers a dead provider.",
      default: "120000",
    },
    {
      name: "SEMANTIC_MIN_SCORE",
      doc: "Cosine floor for semantic hits, so a query with few true matches does not fill top slots with unrelated neighbours.",
      default: "0.3",
      key: "semanticMinScore",
    },
    {
      name: "SEMANTIC_EMBED_TIMEOUT_MS",
      doc: "Ceiling on the query-time embed; past it the search answers lexical-only. Provider p95 is 5-10 s, so a lower cap degrades many chat turns.",
      default: "10000",
      key: "semanticEmbedTimeoutMs",
    },
    { name: "QUERY_EMBED_CACHE_SIZE", doc: "In-process LRU of query embeddings. 0 disables it.", default: "512", key: "queryEmbedCacheSize" },
  ],
};
