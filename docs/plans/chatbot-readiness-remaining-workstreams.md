# Chatbot Readiness — Remaining Workstreams Plan (#7–#12)

**Parent:** [`chatbot-readiness-remediation-plan.md`](./chatbot-readiness-remediation-plan.md).
**Scope:** the workstreams beyond the report tooling. #5/#6 (shared builders + `atlas_report` kinds) are covered separately in [`atlas-report-remaining-kinds.md`](./atlas-report-remaining-kinds.md); `multisigs` + `primitive_matrix` already shipped. This doc details the six remaining implementation-table rows (#7–#12), which currently exist only as one-line entries.

Effort legend: **S** ≤ half a day · **M** 1–2 days · **L** multi-day · **Process/Product** non-code.

---

## #9 — ask-atlas server-prefix tolerance · **S** · do first (quick, independent)

**Problem (confirmed):** `.claude/agents/ask-atlas.md` hardcodes the MCP server name:
- line 11 — `tools:` lists `mcp__redline-atlas__atlas_describe`, `…_search`, … (9 tools);
- line 32 — prose: "All tools live under `mcp__redline-atlas__`."

If the server is registered under any other name, the agent's tool bindings break.

**Plan:**
- Prefer capability discovery / a configurable prefix over the hardcoded literal. Options: (a) a wildcard/loosened `tools:` binding if the agent runner supports it; (b) parameterize the prefix via config the agent template reads; (c) at minimum, document the coupling and add a single source-of-truth constant.
- Rewrite the prose (line 32) to not assert a fixed prefix.
- **Smoke test:** register the MCP server under an alternate name and assert the agent still resolves its tools (mirrors the existing MCP smoke test).

**Depends on:** the agent-runner's tool-binding contract (check whether non-literal bindings are supported before committing to option a).

---

## #8 — ruling-vs-reporting system-prompt policy · **S** · do first (quick, independent)

**Problem:** `src/server/system-prompt.ts` has no policy distinguishing *reporting what the Atlas says* from *issuing a governance ruling*. For eligibility / payment-rate / dispute questions the model may overrule instead of citing text.

**Plan:** add a policy block to the system prompt:
- For eligibility, payment-rate, or dispute questions: cite the Atlas rule text + provenance.
- Present competing readings when the governing text is ambiguous.
- State plainly when the Atlas is silent.
- Do **not** issue a facilitator/governance ruling — say the relevant facilitator must decide.

**Verification:** pairs with #10 — add adjudication eval cases (referral-code, facilitator-rate) that must produce cite-or-decline, not a ruling. Until #10 exists, spot-check manually.

**Adjacent tuning (Phase 3.1/3.2, not separate table rows):** after report tools land, revisit the round budget (6 → 10–12 for synthesis only, gated on telemetry for rounds-used / truncation) and model tiering (route adjudication / security-review / history-trend synthesis to a stronger model, observable in logs). Treat as tuning once #6 + #10 are in place — do not raise defaults blind.

---

## #7 — entity/edge `first_seen` enrichment · **M/L** · do alongside `transfers`

**Enabler:** answers "since when" questions (pioneer status dates, relationship start dates) and supplies `transfers` its date-provenance labels.

**Data available (confirmed):** `atlas_history` (migration `001_init_atlas.sql`) has `doc_id`, `commit_seq`, `committed_at`. So `first_seen` for a provenance doc = the earliest `committed_at` / `MIN(commit_seq)` for that `doc_id` — a query over an existing table, **no new ingest infra**.

**Plan:**
- During build/sync, map each entity/edge → its provenance doc(s) → first-added history date. Store `first_seen` + `first_seen_source` on graph attributes or a server-side lookup table.
- **Labeling rule (load-bearing):** prefer an explicit date stated in content; use `first_seen` only as a derived fallback and label it as such (`date_source: "content" | "first_seen"`). This is the same guard `transfers` needs.

**Risks:** derived dates mistaken for explicit ones (mitigate with the label); provenance docs that were renamed/moved across history (use `doc_id`/UUID, not doc_no — `commit_seq` gives exact topological order).

**Depends on:** the `atlas_history` table being populated (it is, via the history sync). Blocks accurate `transfers` dates.

---

## #10 — golden-question evaluation harness · **M** · BLOCKED on assessment recovery

**Blocker (confirmed):** the source assessment `docs/chatbot-readiness-assessment.md` referenced by the parent plan is **absent from the repo** (only the remediation plan survives). The golden query list + adjudication questions must be recovered or reconstructed before the harness has inputs.

**Plan:**
- **Step 0:** recover/reconstruct the query set — from the assessment if it can be retrieved (git history / a worktree / the original session), else re-derive from the parent plan's Readiness-targets table + acceptance criteria (both enumerate the answerable-query classes).
- Convert to regression tests. Each run captures: model + prompt version, Atlas commit/manifest SHA, tool calls + truncation metadata, final answer, grader outcome (`answered` / `partial` / `honest_decline` / `hallucinated` / `truncated` / `tool_failure`).
- Rubric expectations by query class (data-complete / needs-interpretation / Atlas-silent / empty-shells / exceeds-history-window) — mirror the parent plan's §4.2 table.
- **Gate:** run on every atlas bump + server RC; block promotion on hallucination regressions for silent-data questions (esp. referral-code).

**Depends on:** the tool surface being mostly stable (#6 kinds landed), and #8 (adjudication cases need the policy to test against).

---

## #11 — upstream empty Active Data issue · **Process** · anytime

**Plan:**
- File a next-gen-atlas issue listing the empty Distribution Reward Payment Active Data docs and the expected row fields (reward period, payee, payment address, amount paid, tx hash, tx date). The `active_data` report's shell-detection (see sibling plan) produces this list directly — file after that lands, or hand-enumerate now.
- Decide whether Soter-controlled payout data exists outside the Atlas.

**Bot behavior until fixed:** say payout *structures* exist but *records* are unpopulated; never invent amounts; offer the exact Active Data docs needing population + their expected fields. (This is enforced by the `active_data` + `transfers` `populated: false` flags + the #8 silence policy.)

---

## #12 — supplemental spell/payout sources · **Optional L** · product decision

Spell-titled Atlas docs define process + rosters, not execution records. Near-term behavior is an honest decline (backed by #8). Longer term, add a **separate, provenance-tagged** on-chain spell-execution / payout source **only if** the product needs execution history in the chatbot — and never present supplemental data as Atlas-native.

**Decision owners / trigger:** product. No code until the decision is made.

---

## Recommended order

1. **#9 + #8** — S, independent, immediate wins (prefix tolerance + prompt policy).
2. **#7** — pair with `transfers` (it needs the date labels); no point before transfers is on deck.
3. **#10** — after tool kinds stabilize and #8 lands; **Step 0 (recover the assessment) gates everything else here.**
4. **#11** — file once `active_data` shell-detection produces the doc list (or hand-enumerate anytime).
5. **#12** — product decision; no engineering until then.

## Cross-cutting open questions

- **#10 inputs:** can the original assessment be recovered, or do we reconstruct from the plan? (Determines #10 start.)
- **#7 storage:** graph attributes vs a server-side lookup table — pick based on whether the FE also needs `first_seen` (server-only → lookup table is simpler).
- **#9 binding:** does the agent runner support non-literal / configurable tool prefixes, or is documentation + a constant the ceiling?
