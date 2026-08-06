# The Constraints Wiki: A Frontier-Model Commentary Layer for the Chatbot

*Research report + proof of concept, 2026-08-06. Companion reports: [frozen-constraints.md](frozen-constraints.md) (the constraint catalog this builds on), [synlang-wiki.md](synlang-wiki.md) (why formal re-encoding failed and what survived). Seed entries below were authored by Fable and verified against the live atlas at commit `441313ab`.*

## The idea, sharpened

Have a frontier model (Fable, GPT Sol) write **commentary** on the atlas — not a re-encoding of its text, but the layer a good annotated legal code adds on top of statutes: what connects to what, which numbers govern which questions, where the traps are, what an empty registry means. The chatbot consumes the commentary as a **map**; the atlas stays the only ground truth it cites.

This is the answer-shaped version of what the frozen-constraints research produced. That report is written for humans; a wiki entry is written for the *answering model at retrieval time*: dense, declarative, one claim per sentence, a UUID after every claim, and explicit "when answering X, do Y" guidance. It attacks the chatbot failure modes we've actually measured or designed around:

| failure mode | wiki mechanism |
|---|---|
| wrong-doc retrieval, extra retrieval rounds | topic briefs that say where rules live and which doc is canonical |
| overclaiming on scaffolding ("the atlas has a Lawyer Registry") | liveness notes citing the empty doc itself — grounded abstention |
| template blindness (generalizing one agent's params to another) | cluster commentary on the 8×15 template |
| subtle misreads ("Immutable docs can never change") | misreading notes for documented traps |
| ungrounded numbers | practice note: exact value + UUID or don't state it |

Why now / why cheap: the substrate is the **frozen cohort** — 5,593 docs that have never been semantically modified. Commentary over glacial text is write-once; staleness is detectable in code (anchor content hashes + the mod-counts predicate that defined the cohort).

## Entry format

Authored as markdown (versioned in git — this is human/LLM-authored content, unlike the ephemeral atlas artifacts), validated and compiled to a deterministic `public/wiki.json`:

```
{
  id:          slug,                  // deterministic; sha-derived if an opaque ID is ever needed
  kind:        topic-brief | cluster-commentary | misreading-note | practice-note,
  liveness:    settled | scaffold | mixed,
  status:      draft | locked,        // locked = second-family audit passed
  anchors:     [uuid…],               // docs this entry is ABOUT (attach targets)
  cites:       [uuid…],               // every doc cited in the body
  body:        prose with {uuid} citations,
  misreadings: [string…],
  sourceHashes: { uuid: contentHash } // parser sha256(raw) per anchor — the staleness tripwire
}
```

**Integrity rules (deterministic, build-time — same spirit as the censuses):**
1. Every `{uuid}` must exist in `docs.json`; entries with dead citations fail validation.
2. Every quoted phrase must appear verbatim in the cited doc (the `ungroundedQuotes` check, applied at build time instead of chat time).
3. An entry whose anchor's contentHash has drifted is flagged stale — a `[drift]`-style warning the healer surfaces; the entry stays served but its `[W]` header gains a `STALE` marker until re-reviewed.
4. Full 36-char UUIDs only. (The PoC below already caught why: a truncated UUID from the research report, extended by guesswork, pointed at nothing.)

**Authoring pipeline (mirrors the html-era curation two-family lock):** one frontier family authors (Fable), a different family audits every claim against the anchor docs (GPT Sol), `status: locked` only on agreement; disagreements stay `draft` with the dispute noted. Regeneration only on anchor drift — for this corpus, rarely to never.

## Seed entries (PoC — authored by Fable, status: draft, second-family review pending)

All citations below were verified verbatim against atlas commit `441313ab` (this session or the frozen-constraints verification pass).

---

### W1 · where-rules-live
`kind: topic-brief` · `liveness: settled` · anchors: the six Scope roots

The atlas is partitioned by scope, and the partition is a retrieval map. Governance process — amendment cycles, delegates, the Executive Process, Sky↔Agent relations — lives in A.1. The generic model of primitives (status vocabulary, lifecycle, registries) lives in A.2; A.2 also holds ecosystem security (multisig rules) and the Resilience Fund. Risk parameters and capital rules live in A.3. Operational efficiency (budgets, GovOps mechanics) lives in A.4. Per-agent law lives in A.6, one artifact subtree per Prime Agent, all instantiating one template. A.0 holds the definitional frame (Universal Alignment {9f953b73-566e-4428-a9d2-e179513c3371}, Incentive Slack {133c6032-0082-4644-a3d5-87bcf5b30249}, Endgame State {8a57b601-aec4-49dc-bf34-383c63da11de}).

**Answering guidance:** for "how does X get changed" start in A.1; for "what does status Y mean" start in A.2.2; for a number, A.3 (ecosystem-wide) or the agent's A.6 subtree (agent-specific); for "what may agent Z do", Z's own artifact — never another agent's.

---

### W2 · hierarchy-and-precedence
`kind: topic-brief` · `liveness: settled` · anchors: {37c79482-…}, {a6996fe3-…}, {535cd1c9-…}, {26cac5a1-…}

Sky Core is supreme; agent law is subordinate law. Sky Core "retains ultimate 'root-level' authority over Agents via Executive Vote" {37c79482-b6b3-4055-82ce-169d1da98022}. Agents may not take governance actions that would undermine root control {a6996fe3-6018-4241-aae9-bca7eb0fefb5}. Every agent artifact carries the mirror clause — it "cannot be edited in any way that violates the Sky Core Atlas", enforced by the Operational Facilitator {535cd1c9-1d4d-42e3-bb44-6c128690dd2d}. The same shape holds on-chain: Liquidity Layer `DEFAULT_ADMIN_ROLE` is fully controlled by Sky Governance via the Agent Proxy {26cac5a1-6313-4aff-952c-70eb84513815}. Where an agent artifact and the Sky Atlas disagree, the Sky Atlas version prevails (A.1.14.2.3.1).

**Misreadings prevented:** treating agent token-holder governance as sovereign; assuming an artifact clause can carve out an exception to Sky Core.

---

### W3 · immutable-is-not-immutable-yet
`kind: misreading-note` · `liveness: settled` · anchors: {a324e17e-…}

"Immutable" is a document *category*, not a current property. Immutable Documents "remain modifiable by the governance processes specified elsewhere in the Atlas" until the Endgame State is reached; only then do they "become fully immutable, i.e., they can never be changed" {a324e17e-56c9-4d35-b4fa-75593d852f15}. They are identified structurally: at most three layers deep in the document tree.

**Answering guidance:** "can an Immutable Document be changed?" → yes, today, through normal governance; the permanence is conditional on Endgame State (defined at {8a57b601-aec4-49dc-bf34-383c63da11de}). Contrast with the genuinely irreversible entrenchments in W5.

---

### W4 · amendment-ladder
`kind: topic-brief` · `liveness: settled` · anchors: weekly/monthly cycle docs, agent Root Edit docs

Three distinct tracks change atlas text; identify the track before answering.

1. **Sky Core weekly cycle**: Prime submits Atlas Edit drafts by Monday 23:59 UTC {461272f0-e9ae-43df-9571-4be49a2286c7}; Core GovOps formats and submits the following Monday {07d1ed44-c457-49b9-a054-50e26aa70acc}; SKY holders decide by Thursday {afeaa98f-b8f5-48d9-adb2-8ceed287667d}; minimum participation 480M SKY equivalents {863b3e56-76c5-4448-b2b0-3b5e2d26a3fa}.
2. **Monthly cycle (AEPs)**: final text frozen 7 days before formal submission {b9da67b6-4cc2-4bd9-b6ec-900cd855fa64}; a blocked AEP cannot be resubmitted unamended {523bfc8f-2d8a-4364-8307-7f9a7a764fd6}; an AEP cannot contain language blocking other AEPs in the same cycle {530fe959-2d16-4475-84ba-09a8ba3f66bb}; **there is no Monthly Governance Cycle in December** {6c0810e2-390d-4efb-8b31-f36a7f6e1a05}.
3. **Agent Root Edit** (template-instantiated once per Prime Agent — cite the asked-about agent's own instance, e.g. Launch Agent 7's {fd43ac8d-5461-46e6-8902-4526ef677e3a}): ≥1% of circulating agent-token supply to propose, plus a Sky Forum post → Operational Facilitator 7-day alignment review {d21854da-165b-455d-893c-147db514d31c} → 3-day Snapshot poll, ≥10% participation, 50% in favor {0c0209b7-fe8c-4d94-8daa-00057bb135cf}. Spark adds a parallel 7-day Spark Risk Council review in which silence advances the proposal {f55b35ba-1013-4a86-a874-feda7d750e45}.

**Misreadings prevented:** quoting Sky Core thresholds for an agent Root Edit question (or vice versa); assuming December works like any other month.

---

### W5 · entrenchments
`kind: topic-brief` · `liveness: settled` · anchors: {6ff424a3-…}, {cc60f445-…}, {85121142-…}

A short, closed list of things governance has made irreversible — the correct source for "can this be undone?" answers. Token emissions beyond Genesis Supply are "permanently disabled" and cannot be reverted by Spark Governance; the only override is Sky-held, under Risk Capital violation {6ff424a3-cb63-4eba-9966-771179ffa3ce}. Removing a Nested Contributor requires dual SKY+SPK votes for three years after 2025-06-04 {cc60f445-1ed9-479e-9b44-00de9884a7b5}. The Upkeep Rebate Primitive "is not possible to deactivate" — the only primitive with no off switch, even by token vote {85121142-aa54-4957-b0e1-8f4294512c7e}.

**Answering guidance:** anything *not* on this list should be presumed changeable through the W4 ladder — say which track applies.

---

### W6 · spell-review-isolation
`kind: topic-brief` · `liveness: settled` · anchors: the four prohibition docs

Spell reviewers are isolated from authorship by four separate prohibitions: no directly committing code {952d9bdc-1298-49b5-a52f-11ab480a82b7}; no indirect contribution via pull requests {d3a48eb5-278e-4417-aae5-94b4ee7cf4ea}; no merging — only the Spell Crafter may merge {83f1374d-aa42-4f1d-bea2-5326b578a2af}; and no post-deployment suggestions {357b6485-46fd-442a-ad6e-8ddff5ca4f7f}.

**Misreadings prevented:** summarizing this as one rule ("reviewers don't write code") and missing that PR-mediated contribution and post-deployment input are *separately* banned — questions often probe exactly those edges.

---

### W7 · numeric-constitution
`kind: practice-note` · `liveness: settled` · anchors: the ~100 parameter docs (see frozen-constraints §1.4)

Governance numbers live in single, settled docs — one parameter, one doc, one exact value (e.g. the Capital Ratio, 8.75% {4a1d377d-eb0e-481a-a447-9ff3630b8787}). Rate limits are declared per value-flow as (maxAmount, slope) pairs, ~103 docs in A.6 alone; unboundedness is always declared explicitly (`Unlimited`, `N/A`), never implied by absence.

**Answering guidance:** state the exact value with its UUID or don't state it. Never round ("about 9%"), never generalize a rate limit across agents — each agent's flow has its own doc. If retrieval hasn't produced the number's doc, retrieve it before answering; a stated number without its doc in evidence will (correctly) fail verification. The full parameter table is in frozen-constraints §1.4; production entries must carry each full UUID.

---

### W8 · a6-template
`kind: cluster-commentary` · `liveness: settled` · anchors: A.6.1.1 subtrees

A.6 is one schema instantiated eight times: every Prime Agent artifact is a vector over 15 primitive types at fixed doc_no slots; ~60% of the text is verbatim-identical boilerplate; the identity layer is late-bound (one subtree never names its agent at all). Structural consequences: every instance carries an audit-trail trio (Initial Planning + Operational GovOps Review + Artifact Edit Proposal repositories); every value flow carries a declared rate limit (W7); every primitive has pre-built Suspended/Failed buckets before any suspension ever happened. Customization is permitted but fenced — "Any extensions must remain fully aligned with the requirements specified in the Sky Core Atlas" — and as of the frozen snapshot no agent has used it: "[No customization presently.]" {917307b6-ec3f-4b5f-b517-3f561c2cfe9a}.

**Answering guidance:** for "what are agent X's rate limits / governance thresholds", fetch X's *own* subtree slot — identical wording in another agent's artifact is evidence about the template, not about X. For "do any agents customize the template", the fence doc's own text is the grounded answer: none presently.

---

### W9 · scaffolding-liveness
`kind: misreading-note` · `liveness: scaffold` · anchors: the empty registries and placeholder docs

Roughly 15% of the frozen text mass is scaffolding — containers the atlas committed to but never filled — and the empty docs themselves are citable evidence. "There are no active legal counsels in the Lawyer Registry" {e1f72c98-e3f7-43b5-857c-82294abbbe09}. The List Of Current Integrators contains a lead-in and zero entries {efbe7903-a76e-40f0-a440-56e463283157}. 30 "List Of …" registries corpus-wide are empty (26 of them frozen A.6 payment registries); 52 of 132 frozen Global Activation Status switches are `Inactive`; ~47 docs defer their content to "a future iteration". Transitionary measures fill some gaps explicitly: emergency-response multisigs are exempt from minimum signer/threshold requirements "pending the development of specific threshold requirements" {55f1c795-0653-4dda-9f05-b3068d2608e3}.

**Answering guidance:** a document existing FOR a thing never implies the thing is populated or active. When a registry is empty, answer "none — and the atlas says so" citing the empty doc: that is a *grounded abstention*, strictly better than either overclaiming or an evidence-free "I don't know". When a rule is a transitionary measure, say so — it announces its own obsolescence condition.

---

### W10 · lifecycle-position-is-state
`kind: cluster-commentary` · `liveness: settled` · anchors: {d3908a6c-…}, A.2.2.1.3 status docs

A primitive instance "must always have exactly one" status value {d3908a6c-a5b4-40d3-a982-89ad606a24d9}; the canonical vocabulary is atlas-fixed (Instance: Active | Suspended | Completed; Primitive Global Activation: Active | Inactive | Completed; the "In Progress Invocations" tier is spelled InProgress). Lifecycle transitions are expressed as *subtree relocations* — successful invocations move under Active Instances, failed ones archive — so a document's tree position is part of the state encoding.

**Answering guidance:** use the canonical status words verbatim (never "pending", "paused", or other synonyms); when history shows a doc moved subtrees, read it as a state transition, not a reorganization.

---

### W11 · epistemic-meta-rules
`kind: practice-note` · `liveness: settled` · anchors: {e5a96bad-…}, {5a4e1225-…}, {453cd0ba-…}, {49f808e6-…}

The atlas regulates its own interpretation, and these meta-rules are the correct answer to "what happens when the atlas is silent or ambiguous". Chesterton's Fence: changes must not be made unless the reasoning behind the current state is understood {e5a96bad-0b8d-4cac-afda-d1bd41d6bcb0}. The Tenth Man Mandate: unanimous decisions must be red-teamed {5a4e1225-6151-4eb0-ae6b-5644f15b1b12}. "Extrapolated" is a defined term: a Facilitator inferring a necessary course of action from the Spirit of the Atlas when explicit guidance is absent {453cd0ba-534c-45b3-8cb2-0154e579c3cd}. And discretion defaults closed: where it is ambiguous whether an Executor Agent may directly update an artifact, it "must err on the side of not making any changes" and route through a Root Edit {49f808e6-f82d-4ac4-882f-9878fdb998f0}.

**Answering guidance:** don't invent an answer for a gap the atlas deliberately left — describe the meta-rule that governs who fills the gap and how. This is the atlas's own model: bounded discretion anchored to the Spirit of the Atlas, not rule-completeness.

---

## Wiring into the chatbot

Phased, cheapest-first; each phase independently shippable and measurable.

**Phase 0 — eval-only A/B (no product code).** Inject the seed entries into the system prompt behind a flag in the eval harness; measure against baseline. This is also the context-side test of the "model that already knows the atlas answers faster" hypothesis (the Gemma post-training ladder, step one): if standing structural knowledge doesn't reduce retrieval rounds or improve verification pass rate here, weights wouldn't have either.

**Phase 1 — attach-on-hit (the real integration).** Build `anchor → entry` lookup from `wiki.json` at index load. When `atlas_get`/`atlas_search`/`atlas_query` results include an anchor doc, append the entry to the tool result under a labeled banner:

```
[W:scaffolding-liveness | commentary — secondary source; cite the atlas docs it points to]
```

Cap attachments (≤2 per tool result, dedupe per conversation). No schema change, no embeddings, no new search leg — `Indexes` grows one map, `tools.ts` grows one append step. Entries reach both the answerer *and* the verifier (they ride the transcript into `evidenceFromTranscript`), so a claim like "the Lawyer Registry is empty" is supported by evidence that itself cites `{e1f72c98-…}`.

**Phase 2 — searchable commentary (only if Phase 1 measures well).** Own table (`wiki_entries` + embedding rows) with a third leg in the RRF merge, or a dedicated `atlas_wiki` tool for topic briefs. Deliberately **not** synthetic rows in `atlas_doc_meta` — the semantic leg JOINs embeddings→doc_meta (`search.ts`), and polluting the doc table would leak commentary into counts, reports, and exports.

**Verifier contract.** Commentary is a map, not ground truth: claims about *what the atlas says* must cite `{uuid}` atlas docs; a `[W:…]` label may support navigational/interpretive claims only. The existing `[E0]` schema-evidence pattern is the template for how the verifier is told about a trusted secondary block. The build-time integrity checks (§ Entry format) mean every quote inside a served entry has already passed the verbatim check.

## Measurement

Reuse the chat reliability harness. Metrics per arm (baseline vs Phase 0/1): retrieval rounds per answer, verifier `computeOverall` pass rate, wrong-doc citation rate, unsupported-number rate, latency, tokens per turn. The question sets that should differentiate: "who can change what" (W2/W4/W5), agent-parameter lookups (W7/W8), registry/liveness questions (W9), atlas-is-silent questions (W11).

## Phase 0 results (run 2026-08-06)

`pnpm eval:wiki-ab` — 14 queries × 2 arms through the full production stack (`runVerifiedChat`; chat + verifier gemma-4-31b-it, advisor claude-haiku-4.5), card ≈ 1.7K tokens, report in `.cache/eval-wiki-ab.json`. One run per cell, verifier flaked to `unverified` on 7/14 in *both* arms, and the semantic search leg dropped out intermittently (embed timeouts) — treat everything below as directional, not significant.

**Deterministic metrics: a wash, with a real token cost.** Rounds mean 2.00 both arms; fabrications 0 both arms; latency 30.1s → 33.1s; mean input tokens 27.6K → 37.3K (**+35%** — the card rides every loop iteration, so 1.7K becomes ~10K/turn amplified).

**Rubric-graded substance (the real signal): the eval turned out to be a measure of *false-absence* answers.** Across 28 runs the dominant failure was a model confidently claiming the atlas doesn't contain something it does:

- `atlas-silence` — base spent 5 rounds and shipped "the Atlas does not appear to provide explicit guidance" **with a pass badge**; the meta-rules exist (W11's anchors). The wiki arm found `Interpretation Of The Spirit Of The Atlas` in **1 round** and answered correctly. Clearest wiki win.
- `spark-root-edit` — base answered from the *generic* A.2.2 Root Edit docs and concluded "the atlas does not list the specific numerical voting thresholds … for the Spark Agent" — wrong (1% / 7-day OF review / 3-day, ≥10%, 50% Snapshot live in Spark's own subtree). The wiki arm went hunting Spark's own docs per W4 — the right move — but exhausted `maxIterations` and shipped an **empty answer**.
- `keel-rate-limit` — base shipped empty (loop exhaustion); wiki shipped "the Sky Atlas does not contain a USDS minting rate limit for Keel" **with a pass badge** — wrong: `{568f6fae-4680-4090-8eee-fe0b8e920155}` sets maxAmount 10,000 USDS, slope 10,000/day. (Embed timeouts had degraded search to lexical-only during these runs.)
- `agent-customizations` — wiki win: cited the fence doc's "[No customization presently.]" verbatim; base hedged "no evidence found" off another agent's copy of the doc.
- `lawyer-registry` — both produced the grounded abstention citing the empty doc; wiki got there in 1 round vs 2.
- Ties on december-cycle, emissions-entrenchment, immutable-docs-change, capital-ratio, reviewer-pr (both arms correct); base slightly more complete on integration-boost-vendors and spell-history.

**New failure mode the card introduced:** citation-format contamination — the wiki `immutable-docs-change` answer copied the card's bare-UUID style (`[a324e17e-…]`) instead of the mandated `[Title](/atlas/uuid)` links, drawing a verifier fail on an otherwise richer-and-correct answer. A v2 card must present UUIDs in the exact link syntax answers are required to use.

**Systemic findings worth more than the A/B itself:**

1. **The absence hole**: three confidently-wrong "the atlas doesn't say" answers, two wearing pass badges. Absence claims are currently verified against search coverage, not against reality. The fix is already designed: the §3.1 parameter table as `[E-const]` standing evidence — Keel's `568f6fae` in a deterministic table turns "not in the atlas" into a hard fail — plus W9's rule that abstentions must cite the doc that proves the silence.
2. **Verifier flake**: 50% `unverified` from gemma-as-verifier strengthens the pending "wire in verifier-slices" item.
3. **Loop exhaustion ships empty answers**: both arms produced `""` as a final answer after burning `maxIterations` on retrieval — the orchestrator should force a best-effort compose instead.
4. **Embed timeouts** (4s cap) silently degraded retrieval to lexical-only in ~⅓ of runs — worth a provider-health look before any further evals.

**Phase 0 verdict:** the card demonstrably fixes the navigational failures it was designed for (W11, W8, W9 queries) and avoided shipping one misinformation answer, at +35% input tokens, one new format-contamination bug, and no help against the biggest measured problem (false absences), which needs the deterministic parameter table, not more prose. Recommended: fix the absence hole and empty-answer bug first (they affect production today), then rerun with a v2 card — trimmed to W1/W8/W9/W11 plus track-pointers, link-syntax citations — before any Phase 1 wiring.

## Risks and mitigations

| risk | mitigation |
|---|---|
| Second source of truth drifts from the atlas | anchors' contentHash tripwire; healer surfaces stale entries; entries are `STALE`-marked, not silently served |
| Commentary hallucination poisons answers | citation-only claims; build-time UUID + verbatim-quote validation; two-family lock before `status: locked` |
| Interpretation ossifies (commentary opinion read as law) | `[W]` banner marks it secondary; verifier contract restricts what `[W]` can support; prefer quotes over paraphrase in bodies |
| Token bloat per turn | attach cap + per-conversation dedupe; entries are 120–220 words by construction |
| Authoring cost | one-time over a glacial corpus; regeneration only on anchor drift |

## Verdict

This is the strongest form of the "wiki" idea to survive the SynLang investigation: no notation, no re-encoding — **interpretation, navigation, and trap-marking, written by a frontier model once, verified in code forever after**. It composes cleanly with the other survivors (parameter table §3.1, liveness tags §3.2, template rollup §3.4 of synlang-wiki.md): W7 is the prose face of the parameter table, W9 of the liveness tags, W8 of the template rollup. Recommended next step: Phase 0 eval A/B with the eleven seed entries as-is.
