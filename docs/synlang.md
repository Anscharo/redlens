# SynLang for an Atlas-oriented chatbot

A short, practical report for a developer building a chatbot that answers questions from the Sky
Atlas and must (a) reason precisely, (b) show which Atlas text backs each conclusion, and
(c) **refuse to answer when the Atlas doesn't actually say** — confident-sounding wrongness is the
worst outcome here.

SynLang (from the 2025 preprint *SynLang and Symbiotic Epistemology*, arXiv:2507.21067) is a small
grammar for making an AI's reasoning **structured instead of prose**. We don't need all of it. We
need three of its ideas, and they map exactly onto the three requirements above.

## Background — where SynLang comes from

SynLang ("Symbiotic Syntactic Language") is a single-author working paper by Jan Kapusta —
*SynLang and Symbiotic Epistemology*, arXiv:2507.21067, July 2025. It is a preprint, not a
peer-reviewed standard, and it ships **no reference implementation** — so using it means adopting a
small grammar ourselves, not pulling in a library.

What the paper actually provides is that grammar: roughly 40 BNF rules (its Appendix B) for writing
an AI's reasoning as **structured lines instead of prose** — above all, *one claim per line, each
carrying a confidence* (and, in our use, the source it rests on). That is the whole reason it's
useful here: it's a compact, teachable convention we can prompt — or fine-tune — an AI to follow, so
its conclusions come out **decomposed, individually rated, and grounded** rather than as one
confident paragraph. Structured that way, an unsupported claim becomes something code can catch
instead of something a reader has to trust. We adopt only a lean subset of the grammar, not the whole
protocol — see the Architect lens for where the line is.

---

## The idea in one picture

Instead of the model returning a paragraph, it returns a **block** where every claim is a separate
line carrying *how sure it is* and *which Atlas doc backs it*. That turns the answer from something
only a human can read into something **code can check before the user sees it**.

### Example — a question the Atlas *can* answer

Real rule: **A.2.11.1.3.2.1.1.2.2.1 "Emergency-Response Multisig Threshold Exception"**
> "…a Multisig whose sole capability is an emergency-response function … that cannot move, custody,
> or allocate assets, is not subject to the minimum signer or signing-threshold requirements
> specified in [A.2.11.1.3.2.1.1.2.1]."

```
#ATLAS_ANSWER                                       ← task kind (label; useful for logging/routing)
@AtlasChatbot                                       ← which agent answered (label)
=== Q: "Is an emergency-freeze multisig subject     ← the user's question, preserved as context
       to the standard signer thresholds?" ===
> No — an emergency-response-only multisig is exempt.   ← the headline answer
TRACE_FE:                                           ← the reasoning, one claim per line:
  - exemption: emergency-only multisigs that cannot move/custody/allocate are "not subject to
    the minimum signer or signing-threshold requirements" (confidence=0.95)
    [55f1c795 · A.2.11.1.3.2.1.1.2.2.1]             ← quoted span + the UUID it came from
R: Plain                                            ← output format
```

What each part does:
- **`> headline`** — the answer in one line.
- **`TRACE_FE`** — the "why", decomposed. Each line is *one* claim, so each can be judged on its own.
- **`(confidence=0.95)`** — the model's certainty for *that claim*, 0–1. Precision instead of a vibe.
- **`[55f1c795 · A.2.11…]`** — the Atlas UUID + doc_no the claim quotes. This is the load-bearing
  bit: it lets the server verify the quote against `docs.json` rather than trusting the model.

### Example — a question the Atlas *cannot* answer

Same rule, different question. The Atlas says specific thresholds are *"pending the development"* —
so there is **no** number to give.

```
=== Q: "What is the minimum number of signers for an emergency-response multisig?" ===
> The Atlas does not currently specify a minimum.
TRACE_FE:
  - not_defined: specific threshold requirements are "pending the development"; the standard
    thresholds are exempted as a transitionary measure (confidence=0.90)
    [55f1c795 · A.2.11.1.3.2.1.1.2.2.1]
ABSTAIN: no Atlas provision defines a numeric minimum for this multisig class
R: Plain
```

Note two things: the abstention is itself **grounded** (the Atlas literally says it's undefined, so
we cite that), and `ABSTAIN` is **our extension, not core SynLang** — see caveats.

---

## How the server uses the block (the flow)

Plain language: the model must attach a quote + UUID + confidence to every claim; the server
independently checks each quote really appears in that Atlas doc; if any claim can't be verified,
or nothing confident was found, the bot **abstains and says so** instead of guessing.

```text
block  = model(question, retrieve(question))          # LLM returns a SynLang block, not prose
claims = parse(block).TRACE_FE

for c in claims:                                      # verify grounding IN CODE, not on trust
    doc = docs_json[c.uuid]                            # the cited Atlas node
    c.grounded = doc and normalize(c.quote) in normalize(doc.content)

if claims.empty or any(not c.grounded) or min(c.confidence) < FLOOR:
    return abstain("The Atlas does not support a confident answer",
                   show=[c for c in claims if c.grounded])   # still show what WAS grounded
else:
    return answer(block.headline, citations=[c.uuid for c in claims])
```

This one gate delivers all three requirements:
1. **Precise reasoning** — confidence + one-claim-per-line, not a paragraph.
2. **Shows how the Atlas backs it** — every claim carries the quoted span and its UUID; the UI
   renders them as citations.
3. **Catches insufficiency / hallucination** — a claim whose quote isn't actually in the cited doc
   fails `c.grounded` and cannot survive. "Confident-sounding wrongness" is caught by code, not
   believed. If nothing grounds, the bot abstains.

---

## Developer lens — what you actually build

1. **System prompt**: include the small grammar and the hard rule — *every claim in `TRACE_FE` must
   carry a verbatim quote, its source UUID, and a confidence; if you can't, don't claim it.*
2. **Parser**: read the block into `{ headline, claims[], abstain? }`.
3. **Grounding check**: for each claim, confirm the quote is a substring of `docs_json[uuid].content`.
   RedLens already does this pattern — see `src/server/chat/verify/verifier-slices.ts`
   ("code-validated evidence spans"). Reuse it; don't reinvent it.
4. **Abstention gate**: ungrounded or below the confidence floor → return the explicit "Atlas is
   insufficient" answer, not a guess.
5. **Render**: citations + a certainty indicator. RedLens already has `Sources.tsx` (clickable doc
   chips) and `VerifyBadge.tsx` — wire the block into those.

## Architect lens — where it sits, and how big

- **It's an internal contract, not a UI format.** SynLang lives *between the model and the verifier*.
  The user never sees a block — they see compiled citations + a verify/confidence badge. Boundary:
  model → (SynLang) → verifier → (compiled) → UI.
- **It slots onto the existing chat pipeline** with no new subsystem: `atlas_query` retrieves →
  model emits the block → the verifier validates spans → `Sources`/`VerifyBadge` render. The only
  genuinely new piece is the **abstention gate**, which is a small policy layer.
- **Take the lean subset, not the whole protocol.** For a single chatbot you need exactly three
  things: per-claim **confidence**, evidence **binding** (quote + UUID), and an explicit
  **abstain** verdict. Skip SynLang's multi-agent machinery (`COT`/`CTX`, trace inheritance,
  confidence-propagation, `FEEL`) unless you later fan out into multiple agents (e.g. a panel of
  verifiers) — that's the only case where the rest of the protocol earns its keep.
- **Nice alignment**: abstaining under uncertainty mirrors the Atlas's own stance — e.g. an Executor
  Agent facing ambiguity "must err on the side of not making any changes" (A.1.14.2.7.2.1.1). A bot
  that refuses to over-reach is behaving the way the Atlas tells its own agents to.

## Caveats (don't get burned)

- **No library exists.** SynLang is a single-author preprint. "Adopting SynLang" means *you* own and
  maintain the grammar. Keep it tiny.
- **`ABSTAIN` is your extension**, not core SynLang. Fine — just don't pretend it's standard.
- **A real quote is not a *sufficient* quote.** The grounding check proves the span exists, not that
  it fully justifies the answer (the model can cite a real sentence that doesn't settle the
  question, or omit a contradicting one). So keep the confidence floor, and for high-stakes answers
  a second verifier pass — grounding raises the floor on wrongness, it doesn't eliminate it.
- **Blocks cost more tokens** than plain JSON for the same content. If you never render confidence or
  validate spans, the structure is pure overhead — the value is entirely in the verifier that reads
  it.

---

## Appendix A — Grammar inventory

Every element of SynLang v1.2.0 (from the BNF in App. B of arXiv:2507.21067), plus the one local
extension we added. *Means* = what it stands for / does; *Role* = how it fits into the grammar.

| Group | Element | Means | Role in the grammar (one sentence) |
|---|---|---|---|
| **Header** | `#TASK` | Task label | Required first constituent of a block, preceding the `@AGENT`, context, and body lines; its value is a free-form, author-defined identifier (no fixed vocabulary), e.g. `#ATLAS_ANSWER`, `#VALIDATE`. |
| | `@AGENT` | Addressee / agent | Names who the block is from or for — the routing label. |
| | `=== … ===` | Context | Frames the situation, or preserves the user's question verbatim. |
| **Body** | `>` | Query | The single main question or instruction. |
| | `>>` | Factor | A supporting consideration under the query. |
| | `>>>` | Sub-factor | A detail nested under a factor. |
| **Reasoning** | `TRACE:` | Reasoning patterns | Lists, as short labels, the high-level strategies the agent applied. |
| | `TRACE_FE:` | Trace — Factor Explanations | The detailed reasoning: one claim per line, each ending in a confidence. |
| | `- x: … (confidence=0.94)` | A reasoning step | One claim plus its 0–1 certainty — the atom the whole format is built around. |
| **Control** | `MOD:` | Modify | Redirects or refines how the agent reasons. |
| | `ONLY:` | Restrict | Limits the answer to the listed sources/inputs. |
| | `PREFER:` | Prefer | Weights the listed inputs or interpretations higher. |
| | `-!` | Soft exclude | Down-weights or omits an input. |
| | `-!!` | Hard exclude | Forbids an input entirely. |
| | `//` | Comment | A human note, ignored by the machine. |
| **Presentation** | `FEEL:` | Tone | Sets the attitude of the output (e.g. cautious, investigative, urgent). |
| | `R:` | Response type | Chooses the output format: Plain, Structured, Table, JSON, Bulletpoint, or Code. |
| **Coordination** | `COT:` | Coordination hand-off — **not** "chain of thought," despite the letters | Delegates a sub-task to another agent: `COT: <id> -> @agent: "task"`. |
| | `CTX:` | Context transfer | Carries the reasoning + confidences alongside a hand-off, tagged with the same `COT` id. |
| **Extension (ours)** | `ABSTAIN:` | No-answer verdict | Signals the Atlas is insufficient — added by us for the chatbot; **not** in the paper. |

Three *rules* ride on `COT`/`CTX` rather than being lines of their own: **context preservation** (a
hand-off keeps its id), **trace inheritance** (the receiving agent appends to `TRACE_FE` instead of
starting over), and **confidence propagation** (confidences compose and decay across hand-offs).
These three, plus `COT`/`CTX`, are the only genuinely protocol-level part of the grammar — and they
only do anything when more than one agent is involved. Everything above them is, for a single agent,
a labeling convention around the one real atom: a claim with a confidence and a source.

---

## Appendix B — this report's own claims, in SynLang

Dogfooding the format — the report's main claims, scored the way the chatbot would score an answer.
Confidence follows the evidence *source*; the tag in `[...]` says where each claim is grounded and
therefore how much to trust it:

- `[spec]` — read first-hand from the SynLang paper (arXiv:2507.21067, incl. the BNF in App. B)
- `[atlas@93f7f49]` — fetched live from the Atlas via `atlas_get` this session
- `[claude.md]` — asserted in the project's CLAUDE.md (documentation, *not* re-verified against code)
- `[subagent]` — reported by an exploration/atlas subagent (secondhand; not personally read)
- `[web]` — web search/fetch
- `[judgment]` — a design opinion, not a checkable fact

```
#SELF_ASSESS
@ReportAuthor
=== Claims made in docs/synlang.md, scored for grounding ===
> The lean-subset recommendation is sound; two supporting claims are secondhand and worth a check.
TRACE_FE:
  - no_native_conflict: SynLang's grammar has no precedence / abstention / if-then construct
    (confidence=0.95) [spec]
  - lean_subset: for one chatbot, confidence + evidence-binding + abstain is the useful part;
    the rest is for multi-agent (confidence=0.80) [judgment]
  - rule_text: the Emergency-Response Multisig rule text, doc_no and UUID quoted are exact
    (confidence=0.97) [atlas@93f7f49]
  - atlas_says_undefined: that rule leaves the numeric threshold "pending the development",
    so the insufficiency example is real, not invented (confidence=0.95) [atlas@93f7f49]
  - existing_span_check: verifier-slices.ts does "code-validated evidence spans" we can reuse
    (confidence=0.60) [claude.md]        # described in docs — I did NOT open the file
  - existing_ui: Sources.tsx + VerifyBadge.tsx render citations + a verify badge
    (confidence=0.80) [subagent]
  - atlas_caution_parallel: an Executor Agent under ambiguity "must err on the side of not
    making any changes" (A.1.14.2.7.2.1.1) (confidence=0.75) [subagent]
  - no_library: SynLang has no reference implementation; you own the grammar
    (confidence=0.85) [web]              # absence of evidence, not proof of absence
  - decay_wrong: SynLang's confidence-decay-on-handoff is wrong for a governance sign-off
    (confidence=0.80) [judgment]
COT -> @Developer: "verify existing_span_check by reading verifier-slices.ts before relying on reuse"
ABSTAIN: token-overhead is asserted qualitatively only — no measurement was taken
R: Plain
```

How to read it:
- **Trust as-is (≥0.9, first-hand):** the grammar has no conflict/abstain construct, and the Atlas
  example (text, UUID, "pending the development") is exact — both read directly.
- **Double-check before building (≤0.6):** `existing_span_check` is the weakest link — it repeats
  CLAUDE.md's description of `verifier-slices.ts` without the file having been opened. The `COT`
  line flags exactly that; if that module doesn't validate spans as described, developer-plan step 3
  needs its own implementation.
- **Secondhand but likely (0.75–0.80):** the UI components and the `A.1.14.2.7.2.1.1` parallel came
  from subagents — probably right, cheap to confirm.
- **Abstained:** no token measurement was taken, so no number is put on the overhead — the exact
  behaviour the report asks the chatbot to have.

The point of the appendix: this is the format doing its job on its own author. The two lowest-scored
lines are the ones to verify first — the value proposition applied reflexively.
