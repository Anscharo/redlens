# Archived plans

Influential, completed plans kept for historical record — not active guidance. Spent one-off
prompts and superseded/rejected designs are not archived; they're deleted.

For the **active** design docs that describe how the live system works, see the parent
`docs/plans/` directory. For the chat system specifically, the canonical descriptive doc is
[`docs/chat-system.md`](../../chat-system.md) — the three chat plans below were folded into it
and archived on 2026-08-21.

| File | Why kept |
|------|----------|
| `railway-mcp-phase.md` | **Completed phase** — scope doc for migrating the MCP server from Cloudflare Workers to Railway. A significant architectural move; kept as the record of that migration's intent and boundaries. Implementation details now live in `src/server/`. |
| `chatbot-plan.md` | **Founding architecture plan** for the whole chat system — the Cloudflare→Railway single-origin thesis, the in-memory-indexes-vs-Postgres split, the deploy=sync design, the embeddings-as-a-best-effort-lane rationale, and the `change_type` vocabulary (`modified`→`content`, `moved`→`structural`) that `history.ts`/`history-db.ts` still follow. Heavily drifted as a description (Qwen3 default, 180-min rate window, summary-based compaction) — read it for intent only. |
| `chat-reliability-harness.md` | **Completed design** for the verifier/advisor harness: why verification is post-answer and never gates, why advisor triggers are computed from free signals, why exactly one recovery cycle, and the `message_checks` schema rationale. Superseded on the verifier itself — the single-prompt audit it describes was replaced by the four concurrent slices in 2026-08. |
| `chat-staged-delivery.md` | **Completed decision** (2026-08-06) to add a staged delivery mode alongside streaming, with the perceived-latency trade it accepts. Live shape now in `docs/chat-system.md` §8; the open staged-vs-streaming A/B is tracked in `CLAUDE.md`. |
