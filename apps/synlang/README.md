# Atlas → SYNLANG: the A.0.1.1 Definitions

An experiment answering one question: **can part of the Sky Atlas be encoded in
SYNLANG?** This folder encodes the 56 terms defined in **A.0.1.1 Definitions**
(`c7d62f28-1d64-4632-8cd8-4f2b44c51bba`) as a SYNLANG Space and shows what the
engine then answers beyond a text search over the prose.

SYNLANG here is the language documented at docs.synlang.org and executed by the
Noemar engine (`archon-research/noemar`, the `synlang` Python package) — a homoiconic
S-expression reasoning language: facts, `(= lhs rhs)` rewrite rules, `$var` pattern
queries, typed declarations, protocols. It is **not** the arXiv:2507.21067 "SynLang"
that `docs/research/synlang-wiki.md` evaluated in August; that paper is a dialogue
convention with no fact/rule constructs. Same name, unrelated artifact.

Everything in this folder is self-contained and off the `pnpm build` chain.

## The answer, in three tiers

| Tier | What | How | Verdict |
|---|---|---|---|
| **1. Structure** | term symbol, display name, alias, defining doc (UUID), content hash, section membership, the *mentions* graph between definitions | generated deterministically by `gen_definitions.py` from `docs.json` | **encodes fully** — 56 terms, 8 aliases, 125 `mentions` edges, byte-identical on rerun |
| **2. Taxonomy + stated facts** | the class tree the definitions describe — Prime and Executor Agents (`3c18e6a7-95b8-44e9-8da6-1eadf3fdd356`), Executors split into Operational and Core Council (`ac514975-66ad-4b43-8f76-42cac5ca599d`), AD and Facilitator as kinds of Alignment Conserver (`8ea04ed4-7075-45e6-b6ed-a52b7506f4a8`, `912e0161-3448-470f-9cf6-d1a26d76acab`) — the six Scopes (`f30e56f9-da71-44bc-ab3b-9b13348794fe`), plus the numbers, address and duties those texts state | hand-curated in `atlas/definitions-curated.synlang`, every fact `; cites <uuid>` | **encodes with curation** — and the engine then *derives* answers no fact states, e.g. `(subclass-of operational-executor-agent agent)` |
| **3. Prose** | what "Universal Alignment" *means* | carried verbatim as a string in `(definition …)` | **string data, not semantics** — the same interpretive residue `synlang-wiki.md` §2 found resists any notation |

The new evidence versus the August report is tier 2: with a real engine the structural
tiers are *queryable and checkable* (transitive closure, closed-world empties, content
hashes for staleness) — the axis that report never tested because the thing it evaluated
could not execute anything.

## Layout

```
gen_definitions.py                 stdlib-only generator: docs.json → atlas/definitions.synlang
atlas/definitions.synlang          GENERATED — 56 terms (committed on purpose, see Conventions)
atlas/definitions-curated.synlang  hand-written taxonomy + structured facts, each ; cites <uuid>
atlas/rules.synlang                tabled transitive closure, lookup and glossary rules
main.synlang                       entrypoint: the !(…) queries that answer "can we?"
tests/definitions.test.synlang     self-contained (test …) blocks for the rule shapes
smoke.py                           loads the real data through the library and asserts (needs the engine)
lint.py                            engine-free syntax + shape check (runs today)
synlang.toml                       project manifest (sources, entrypoint, [tests])
```

## What a term looks like

```synlang
;; A.0.1.1.17 — Alignment Conserver (AC)
(: alignment-conserver Term)
(term alignment-conserver "Alignment Conserver")
(alias alignment-conserver "AC")
(defined-at alignment-conserver "94a451ce-100c-4ff5-8d53-65953938ecde")
(defined-in alignment-conserver atlas-preamble-definitions)
(content-hash alignment-conserver "6c517d71…")
(definition alignment-conserver "Alignment Conservers (ACs) are external entities that …")
(mentions alignment-conserver the-atlas)
```

Flat facts only, so `synlang check` stays clean of V003 (non-flat fact) warnings. The
engine's own idiom for "documentation on a symbol" is `(@doc sym (description "…"))`;
switching `definition` to that is a one-line change in the generator if wanted.

## Engine

**There is currently no way to install the engine.** The `synlang` package is not on
PyPI, `archon-research/noemar` is private, and docs.synlang.org offers nothing
downloadable. So the files here are written to the documented syntax (the reference
pages for expressions, fact shapes, functions and symbols; the projects and testing
guides) and checked by `lint.py`, a stdlib script that proves what can be proved without
an engine:

```bash
python3 apps/synlang/lint.py
```

- every file parses as balanced S-expressions with closed strings — the generator's
  escaping is exercised on all 56 definitions;
- every `(= lhs rhs)` rule obeys the documented variable rule (V001);
- every class named by `subclass-of` / `instance-of` is declared first;
- every `!(…)` head in `main.synlang` is defined by some source (the run-time view of V007);
- per-head fact counts.

It is a checker for the shapes this project uses, not a SYNLANG implementation: it has
no evaluator, so it neither runs a query, nor derives a closure, nor confirms the
string-escape convention the engine actually expects.

## Run (once an engine exists)

Needs Python 3.10–3.14 (Homebrew `python3.14` works; system 3.9 does not).

```bash
python3.14 -m venv apps/synlang/.venv
apps/synlang/.venv/bin/pip install <synlang wheel or checkout>
apps/synlang/.venv/bin/synlang run apps/synlang            # every !(…) in main.synlang
apps/synlang/.venv/bin/synlang test apps/synlang/tests     # rule-shape tests
apps/synlang/.venv/bin/python apps/synlang/smoke.py        # asserts on the real data
apps/synlang/.venv/bin/synlang check apps/synlang           # static validators
```

`synlang check` validates each file in isolation, so `main.synlang`'s queries over heads
defined in `atlas/*.synlang` report **V007** there by design (the projects guide says so);
the queries resolve at run time once every source is loaded. The gate is `run` + `test` +
`smoke.py`, not a clean `check`.

## Regenerate

```bash
apps/synlang/.venv/bin/python apps/synlang/gen_definitions.py
# --source public/docs.json | <url>   (default: local artifact if present, else the public endpoint)
# --section <uuid>                    (default: A.0.1.1's; any of the 9 Definitions sections works)
# --out <path>
```

Output is sorted by doc_no with no timestamps, so a rerun at the same `atlasCommit` is
byte-identical; the header records the commit, and every term carries its `contentHash`,
so drift shows up as a diff, never silently.

### Generator rules worth knowing

- **Slug**: title minus its trailing parenthetical, lower-cased, non-alphanumerics → `-`
  (`Alignment Conserver (AC)` → `alignment-conserver`, alias `AC`). Collisions with each
  other or with SYNLANG reserved/builtin symbols fail the run.
- **Mentions**: every other term's display name (case-insensitive) or alias (case-sensitive
  — `AC`/`AD`/`PRO` are too short to match loosely), whole-word, optional plural suffix.
  Longest match first with span consumption, so `Operational Executor Agent` does not
  also register `Executor Agent` and `Agent`. Known limit: inflections other than a
  plural (`universally aligned` vs `Universal Alignment`) are not matched.
- **Strings**: C-style escaping (`\\`, `\"`, `\n`); the docs do not specify escape rules,
  so the parse round-trip in verification is what proves it.

## Conventions

- **The generated file is committed.** This is a deliberate exception to the repo rule
  that atlas-derived artifacts are built, not committed: it is small, off the build chain,
  carries its `atlasCommit`, and *is* the thing to read.
- **Citations.** Every curated fact carries `; cites <full uuid>` inline. Doc numbers appear
  only in comments — UUIDs are the identity.
- **Only what A.0.1.1 says.** The curated layer encodes relations the definitions state in
  their own text; it does not import rules from elsewhere in the atlas.

## Verification status

- [x] generator deterministic — two runs byte-identical (`cmp`)
- [x] 56 terms / 8 aliases / 125 edges match the section's 56 `[Core]` children
- [x] `lint.py` — all sources parse; rules pass the V001 shape; classes declared before use; every query head defined
- [ ] engine parse round-trip of the generated strings (`synlang check atlas/definitions.synlang`) — **no engine available**
- [ ] `synlang run` — derived closure answers, alias resolution, closed-world empty — **no engine available**
- [ ] `synlang test` — 5 rule-shape tests — **no engine available**
- [ ] `smoke.py` — 11 assertions on the real data — **no engine available**

The unchecked items are exactly the claims this README does not make: that the engine
accepts the string escaping and derives the closures as written. The syntax follows the
documentation; the semantics are unproven until an engine can run it.
