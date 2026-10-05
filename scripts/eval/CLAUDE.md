# Chat evals and bakeoffs

Each `pnpm eval:*` script measures one chat or retrieval decision against labeled data and writes its results to `.cache/eval-*.json`. The lanes these bakeoffs tune are described in `src/server/facts/CLAUDE.md`; the full harness is in `docs/chat-system.md` §12.

Every entry point in `scripts/eval/` is attributed to "Sky Atlas Redline Evals" on OpenRouter. An eval script placed anywhere else needs `OPENROUTER_APP_KIND=eval` (root CLAUDE.md, Conventions).

The similarity bakeoffs fit their threshold on half the labeled set and report on the other half. With `DATABASE_URL` set they also check real chat messages for false fires; run that check against production data before lowering a shipped margin, because a margin fitted on labeled data alone has fired on open-ended real requests.

```bash
pnpm eval:retrieval  # grouping / embed-model / reranker bakeoff → .cache/eval-retrieval.json (tfidf without a key; --backend openrouter for neural)
pnpm eval:embed-latency # query-embed round trip per model (p50/p90, the OpenRouter host each call reached; `model@Host` pins one host) → .cache/eval-embed-latency.json. Pairs with `eval:retrieval --sample-scope` for quality; results in docs/research/embedding-model-comparison.md
pnpm eval:facts      # features fact trigger: regex vs on-device similarity vs the hybrid, 241 labeled questions → .cache/eval-facts.json. --embed adds the similarity arms.
pnpm eval:census     # census routing (1 of 10 slugs, not fire/no-fire): regex vs rankPrototypeSets vs the hybrid, 202 labeled questions → .cache/eval-census.json
pnpm eval:complexity # tier router: does a whole-corpus question reach the STRONG tier by regex alone or also by similarity? 180 labeled questions → .cache/eval-complexity.json. Its shipped margin has no real-traffic check yet.
pnpm eval:announce   # promised-tool guard: should chat-loop.ts retry a round that announced a lookup and called no tool? Scores answers, not questions; 144 labeled cases → .cache/eval-announce.json
pnpm eval:verifier   # grades the refutation-only verifier against saved turns; --models a,b,c compares verifier models
pnpm eval:slices     # per-slice verifier model bakeoff
```
