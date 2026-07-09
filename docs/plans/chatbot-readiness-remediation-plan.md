# Chatbot Readiness Remediation Plan

**Source assessment:** [`docs/chatbot-readiness-assessment.md`](../chatbot-readiness-assessment.md)  
**Plan date:** 2026-07-09  
**Goal:** Convert the readiness assessment's findings into an implementation roadmap that makes high-value Atlas chatbot queries reliably answerable, while preserving honest declines for data that does not exist in the Atlas.

## Executive summary

The assessment separates failures into two categories: missing or incomplete Atlas data, and retrieval/synthesis failures caused by the current chat tool surface. The fastest path to better answers is not primarily a larger model; it is to expose the graph and history in aggregated, chat-sized shapes so the model can retrieve complete evidence within the six-round harness.

This plan therefore prioritizes:

1. **Bulk graph and history tools** so relationship maps, multisig reviews, history trends, and known event references are retrievable in one to three calls.
2. **Server-side curated reports** that reuse existing frontend rollup logic and return model-ready evidence with provenance.
3. **Data hygiene and temporal enrichment** so sparse event references, unnamed instances, and parse gaps are handled before the model sees the data.
4. **Prompt and evaluation guardrails** so the bot distinguishes Atlas reporting from facilitator/governance rulings and declines when the Atlas is silent.
5. **Upstream/supplemental data decisions** for gaps that cannot be solved in code, especially empty payment Active Data and spell execution history.

## Readiness targets

| Target | Current blocker | Planned fix | Success definition |
|---|---|---|---|
| Transfer/payment records | Atlas mostly names where transfers or payments should be recorded, but actual event rows are sparse or silent | `atlas_search`, active-data/report tooling, targeted transfer-reference extraction | Bot finds the relevant recording locations and says clearly when the Atlas does not contain transaction rows, amounts, hashes, or dates. |
| Multisig security review | Complete data exists but requires too many calls | `atlas_report({ kind: "multisigs" })` | One report returns every multisig, threshold, signer grouping, purpose, modifying authorities, and provenance. |
| Primitive structure | Computable but no aggregation tool | `atlas_report({ kind: "primitive_matrix" })` | Bot can distinguish universal agent lifecycle primitives from optional reward/pioneer primitives. |
| Organizations and roles | Graph data exists but exhaustive map exceeds round budget | `atlas_edges`, actors report | Bot can enumerate orgs, relationship edges, and individual/role caveats without N+1 traversal. |
| History trends and quarterly timeline | Raw history only; no grouping; history window is shorter than two years | `atlas_history_stats` | Bot states the actual earliest history date, returns monthly/quarterly trends, and avoids claiming unavailable two-year coverage. |
| Distribution reward payouts | Active Data docs are empty upstream | Active Data population detection, upstream issue, optional supplemental source | Bot names eligible structures and clearly says payout records are unpopulated unless supplemental data is available. |
| Adjudication-style rate questions | Model may overrule instead of reporting text | prompt policy, eval cases | Bot cites governing rules, presents ambiguity, and says facilitator rulings are out of scope. |
| ask-atlas reliability | Hardcoded tool prefix | Server-name tolerant tool binding | Agent works regardless of MCP server registration name. |

## Phase 0 — Stabilize the tool layer

### 0.1 Add `atlas_edges`

**Purpose:** Replace N+1 graph traversal for queries that need all edges of a type.

**Proposed schema**

```ts
type AtlasEdgesInput = {
  edge_type?: string;
  from_type?: string;
  to_type?: string;
  from_slug?: string;
  to_slug?: string;
  include_docs?: boolean;
  limit?: number;
  offset?: number;
};
```

**Response shape**

```ts
type AtlasEdgeResult = {
  total: number;
  limit: number;
  offset: number;
  edges: Array<{
    edge_type: string;
    from: { id: string; slug?: string; type: string; name: string };
    to: { id: string; slug?: string; type: string; name: string };
    meta: Record<string, unknown>;
    provenance?: Array<{ doc_no?: string; title?: string; node_id?: string }>;
  }>;
};
```

**Implementation notes**

- Build on the existing graphology graph used by current traversal tools.
- Resolve endpoint display names and types in the handler so the model does not need follow-up `entity` calls.
- Page large result sets and include `total` so the model knows whether it has complete coverage.
- Default to chat-safe limits and require explicit pagination for broad edge scans.

**Unlocks:** organization map, roles/positions, multisig signer sweep, duplicate edge inspection, and broad scans for known transfer-reference edges if present.

### 0.2 Add `atlas_history_stats`

**Purpose:** Let the model answer trend and timeline questions with grouped history instead of raw event streams.

**Proposed schema**

```ts
type AtlasHistoryStatsInput = {
  since?: string;
  until?: string;
  bucket?: "month" | "quarter";
  group_by?: Array<"doc_type" | "scope" | "change_kind" | "review_status" | "pr_author">;
  include_top_docs?: boolean;
  include_prs?: boolean;
  limit?: number;
};
```

**Response requirements**

- Always include `earliest_available_date` and `latest_available_date`.
- Return bucketed counts and top-changed docs with doc numbers/titles.
- When the requested window predates available history, include a warning field rather than silently truncating.

**Unlocks:** Atlas history trends, quarterly timeline, realistic framing of requests for two years of history.

### 0.3 Apply a chat-sized tool result budget

**Purpose:** Prevent a single tool call from consuming most or all of the model context.

**Implementation notes**

- Keep the MCP-wide `MAX_RESULT_CHARS` behavior for external MCP clients.
- Add a chat transport budget, initially `CHAT_TOOL_RESULT_MAX_CHARS=30000` with an env override.
- Surface truncation metadata: `truncated: true`, `returned_chars`, `next_offset` where applicable.
- Prefer structured pagination over raw truncation for tools that support `limit`/`offset`.

**Unlocks:** more predictable six-round behavior; fewer context blowouts on broad searches or gets.

### 0.4 Fix known extraction gaps and graph noise

**Scope**

- Re-check transfer extraction against the current Atlas and keep only well-provenanced event references; do not imply full ledger coverage.
- Name unnamed instance entities from agent + instance context, such as `Spark — Integration Boost`, instead of generic names like `Integration Boost Primitive`.
- Collapse or clearly label per-month authorization duplicate edges.
- Ensure ambiguous names such as `Redline` are disambiguated in search/entity responses.

**Success checks**

- Build produces no known transfer parse warnings, or the remaining warnings are documented as Atlas prose that does not encode event rows.
- Integration boost roster contains named vendors without unnamed primitive pollution.
- Transfer report distinguishes recurring authorization docs from unique token movement events.

## Phase 1 — Add curated report tools

### 1.1 Introduce `atlas_report`

**Purpose:** Serve model-ready reports that are too expensive for the LLM to assemble interactively.

**Proposed schema**

```ts
type AtlasReportInput = {
  kind:
    | "rewards"
    | "active_data"
    | "multisigs"
    | "transfers"
    | "primitive_matrix"
    | "actors";
  include_provenance?: boolean;
};
```

**Report kinds**

#### `rewards`

- Distribution Reward and Integration Boost instances by agent/integrator.
- Partner/vendor names, primitive subtype, and relevant ICD parameters.
- Empty/unpopulated payout record flags.
- Provenance docs for the rule and Active Data locations.

#### `active_data`

- All Active Data docs with population status.
- Detect shell docs whose content ends at introductory text with no rows.
- Include a `populated: false` reason so the bot can explain the limitation.

#### `multisigs`

- All multisigs with chain, address, threshold, signer count, purpose, signer orgs/individuals, and signer-modification authorities.
- Group signer overlap and threshold patterns for security review.
- Include purpose and provenance doc IDs.

#### `transfers`

- Search-first report over Atlas locations that mention transfer/payment recording obligations and any well-provenanced `funds_transfer` references that exist.
- For actual event references, include sender, recipient, asset, amount, status, date, source doc, and whether date is content-derived or `first_seen` derived when those fields are present.
- For silent recording locations, return `populated: false` with the expected fields, such as reward period, payee, payment address, amount paid, transaction hash, and transaction date.
- Avoid presenting authorizations, schemas, payment-address records, or process instructions as completed transfer events.

#### `primitive_matrix`

- Matrix of agent × primitive subtype presence.
- Classify universal vs optional primitive subtypes using all known agents as denominator.
- Include counts and missing-agent lists.

#### `actors`

- Organizations by type and relationship edges.
- Individuals captured as entities, with caveat that prose-only mentions are not exhaustive.
- Role/position summary derived from typed edges and recognized relationship semantics.

### 1.2 Share frontend rollup logic with the server

The assessment notes that useful rollups already exist in frontend-oriented modules. Refactor those modules into pure shared library code when necessary, then have both the UI and chat server import the same logic.

**Design constraints**

- No React dependencies in report builders.
- Deterministic output from `docs.json`, `graph.json`, and history tables.
- Include provenance fields by default for model-facing output.
- Unit-test report builders with fixture graphs so changes to extraction logic do not silently alter answer quality.

## Phase 2 — Temporal enrichment and data remediation

### 2.1 Stamp entities and edges with `first_seen`

**Purpose:** Make "since when" questions answerable without forcing the model to join graph results to history manually.

**Implementation approach**

- During build or sync, map each entity/edge provenance doc to its first-added history date.
- Store `first_seen` and `first_seen_source` on graph attributes or in a server-side lookup table.
- Prefer explicit dates in content over `first_seen`; use `first_seen` only as a derived fallback and label it clearly.

**Unlocks:** pioneer status dates and relationship start dates where the Atlas lacks explicit dates; transfer dates only when the Atlas contains an actual event reference.

### 2.2 Address empty Active Data upstream

**Actions**

- File an upstream next-gen-atlas issue listing the empty Distribution Reward Payment Active Data docs and the expected row fields.
- Decide whether Soter-controlled payout data exists outside the Atlas.
- If supplemental data is ingested, keep it provenance-tagged as supplemental and never present it as Atlas-native.

**Bot behavior until fixed**

- Say that payout structures exist but payout records are unpopulated.
- Avoid inventing amounts.
- Offer the exact Active Data docs that need population and the fields they say should be recorded.

### 2.3 Keep spell execution out-of-scope unless a supplemental source is added

The assessment indicates that spell-titled Atlas docs define process and rosters, not execution records. Near-term behavior should be an honest decline. Longer term, add a separate on-chain spell execution source only if the product needs execution history in the chatbot.

## Phase 3 — Harness, prompt, and model improvements

### 3.1 Adjust round budget after report tools land

- Keep six rounds for simple lookup queries.
- Consider 10–12 rounds for complex synthesis only after chat-sized budgets and curated reports prevent runaway context usage.
- Add telemetry for tool rounds used, truncation events, and answer failures before raising defaults globally.

### 3.2 Add model tiering for synthesis-heavy questions

- Keep the current default model for fact lookup and short reports.
- Route adjudication-style questions, security review, and history trend synthesis to a stronger model when available.
- Make model tier selection observable in logs and eval outputs.

### 3.3 Add ruling-vs-reporting system prompt policy

Add a policy block to the chat system prompt:

- For eligibility, payment-rate, or dispute questions, cite the Atlas rule text and provenance.
- Present competing readings when the governing text is ambiguous.
- State when the Atlas is silent.
- Do not issue a facilitator or governance ruling; say that the relevant facilitator must decide.

### 3.4 Fix ask-atlas tool prefix mismatch

- Remove hardcoded `mcp__redline-atlas__*` assumptions from the `ask-atlas` agent definition.
- Prefer capability discovery or configurable server prefixes.
- Add a smoke test using an alternate MCP server registration name.

## Phase 4 — Golden-question evaluation harness

### 4.1 Convert the assessment into regression tests

Use the readiness assessment's query list and adjudication questions as a golden set. Each run should capture:

- Model and prompt version.
- Atlas commit/manifest SHA.
- Tool calls and truncation metadata.
- Final answer.
- Grader outcome: `answered`, `partial`, `honest_decline`, `hallucinated`, `truncated`, or `tool_failure`.

### 4.2 Define rubric expectations

| Query class | Required behavior |
|---|---|
| Data exists and is complete | Answer with provenance and no missing major records. |
| Data exists but requires interpretation | Cite evidence, present caveats, avoid overclaiming. |
| Atlas is silent | Say the Atlas does not specify; do not infer or hallucinate. |
| Data exists only as empty shells | Identify the shells and say values are unpopulated. |
| Request exceeds history window | State exact available history window and answer only within it. |

### 4.3 Gate releases

- Run the golden set on every atlas bump and server release candidate.
- Block promotion on hallucination regressions for silent-data questions, especially referral-code questions.
- Track transfer/payment silence handling plus answer completeness for multisig, primitive, actor, and history reports as Phase 0–1 tools land.

## Implementation order and owners

| Order | Workstream | Primary files/modules | Dependency | Est. size |
|---|---|---|---|---|
| 1 | Chat result budget | `src/server/chat-loop.ts`, tool execution plumbing | None | S |
| 2 | `atlas_edges` | `src/server/tool-registry.ts`, graph adapter | None | M |
| 3 | `atlas_history_stats` | history DB access, tool registry | History table availability | M |
| 4 | Extraction/data-silence fixes | graph transfer builder, Active Data population checks, instance naming logic | Build fixtures | M |
| 5 | Shared report builders | `src/lib/*Index.ts` refactor or equivalent shared modules | Graph adapter stable | L |
| 6 | `atlas_report` tool | tool registry + report builders | Report builders | M |
| 7 | `first_seen` enrichment | build/sync pipeline + graph attrs | History stats assumptions | M/L |
| 8 | Prompt policy | chat system prompt | None | S |
| 9 | ask-atlas prefix fix | agent/tool config | MCP registration contract | S |
| 10 | Eval harness | scripts/tests + golden fixtures | Tools mostly stable | M |
| 11 | Upstream Active Data issue | next-gen-atlas coordination | None | Process |
| 12 | Supplemental spell/payout sources | TBD | Product decision | Optional L |

## Acceptance criteria

The remediation is considered successful when staging can satisfy the following:

1. A transfer/payment query finds the Atlas locations where records should be kept, includes any actual event references with provenance, and clearly says when rows, amounts, hashes, or dates are absent.
2. A multisig security review query returns all multisigs and cites threshold/signer/purpose evidence.
3. A primitive structure report identifies universal and optional primitives with counts.
4. An organizations/roles/individuals query returns typed organizations, relationship edges, known individuals, and clear exhaustiveness caveats.
5. A history trends query returns bucketed monthly or quarterly statistics and states the actual available history window.
6. A distribution rewards payout query says payment records are unpopulated unless supplemental data is explicitly available, and identifies the relevant Active Data docs and expected fields.
7. Referral-code adjudication questions produce an "Atlas is silent" answer instead of a ruling.
8. Facilitator-rate questions cite rule sources and avoid issuing governance rulings.
9. Golden-question evals run in CI or release checks and record model/tool versions.
10. Chat tool responses include truncation metadata whenever a chat-sized budget is hit.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Report tools become another source of truth | Build reports from canonical artifacts and include provenance; share logic with frontend where possible. |
| Derived dates are mistaken for explicit dates | Label date source as `content` vs `first_seen` in every report. |
| Larger result sets still exceed context | Keep chat budgets, pagination, and report summaries; require follow-up for expanded detail. |
| Model still overrules on adjudication questions | Add prompt policy and hallucination-specific eval gates. |
| Upstream data remains empty | Preserve honest decline path and optionally add clearly labeled supplemental data. |
| Tool additions fragment MCP/chat behavior | Keep tools transport-agnostic and test both chat and MCP surfaces where applicable. |

## Deliverables checklist

- [ ] `atlas_edges` tool with pagination and endpoint resolution.
- [ ] `atlas_history_stats` tool with earliest/latest history metadata.
- [ ] Chat-specific tool result budget and truncation metadata.
- [ ] Transfer-reference audit, Active Data silence detection, and instance naming cleanup.
- [ ] Shared report builder modules.
- [ ] `atlas_report` tool with `rewards`, `active_data`, `multisigs`, `transfers`, `primitive_matrix`, and `actors` reports.
- [ ] Entity/edge `first_seen` enrichment.
- [ ] Ruling-vs-reporting prompt policy.
- [ ] ask-atlas server-prefix tolerance.
- [ ] Golden-question regression harness.
- [ ] Upstream Active Data issue and supplemental data decision.
