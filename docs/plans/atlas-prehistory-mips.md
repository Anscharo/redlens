# Atlas pre-history: MIPs → Powerhouse → next-gen-atlas

Status: RESEARCH → MEASURED (2026-06-24; recovery + identity probes 2026-06-25;
genesis HTML recovered + MIP→v2 governance seam dated 2026-06-25; facilitator
accounts folded in 2026-07-01; **MIP→genesis→current lineage measured end-to-end
2026-07-06 — see `pre-git-history.md`, now the implementation plan**). Companion
to `html-era-history.md`. Question investigated: the `Sky Atlas.html` "first
commit" is not the true beginning of the Atlas — what came before, and should we
extend document history further back than the HTML era?

**Answer: yes, there is a real pre-history in at least three earlier strata — and
the key follow-up questions are now settled by measurement:**
- **The MIP→HTML switch is a dated governance act with a recovered genesis.** The
  **Atlas v2 Upgrade Poll (#25010, 2024-09-02, Atlas Axis)** kicked the Atlas off
  the MIP system onto the single HTML file, and pinned that *originally uploaded*
  `Sky Atlas.html` to **IPFS** (CID
  `bafkreih7mbj4npqhxeprzk7sahpqjrajmxursaenzqgxdw5uo7sz554os4`, on Sky's own
  pinata gateway). It still resolves — **693 KB, 890 docs** (the earlier "≈1,068"
  counted `<dfn>` occurrences, which include cross-reference citations — Gate-1
  audit 2026-07-06): the exact Atlas v2 genesis, ~9 months before the git root. So
  the severed era now has a hard content anchor at *both* ends: genesis
  (2024-09-02, 890 docs) → first git commit (2025-05-28, 4,019 docs), a ~4.5×
  expansion the forum cycles narrate.
- **The severed *git* history is gone — a repo re-init, not a force-push.** The
  current repo's GitHub `created_at` is **2025-05-28** (same day as `4e931dfd`), so
  the 2024-09 `makerdao/next-gen-atlas` (127 commits by Dec 2024) was re-created
  fresh that day; its objects are unrecoverable publicly (no pre-truncation fork,
  raw HTML not in Wayback). **But** the era's change history is reconstructable from
  the **forum Atlas Edit Weekly Cycle proposals** (continuous back to **2024-09-13**),
  now bracketed by the two exact HTML snapshots above.
- **Powerhouse UUIDs ≠ #117 UUIDs**: early-Powerhouse had its own (now dead) UUID
  namespace; the live portal today mirrors the repo's #117 space exactly (10 370 /
  10 370). So **#117 stays the canonical anchor** for `html-era-history.md` — no
  change needed there.

Details and a tiered recommendation below.

## Lineage measured (2026-07-06) — Tier 3 is cheap and it works

The genesis HTML was fetched (693,633 B, sha256-verified against the CID digest,
parses with the *unchanged* htmlhist converter: 890 nodes, 10 sections, scopes
`A.0`–`A.5`), `sky-ecosystem/mips` was
cloned, and the full MIP → genesis → `4e931dfd` → current-uuid chain was measured
(prototypes + data: `scripts/aux/atlas-history/{recovered,prototypes}/`):

- **Scope map**: A.0←MIP101, A.1←MIP113, A.2←MIP106, A.3←MIP104, A.4←MIP107,
  A.5←MIP108. The v1→v2 renumbering is **not** mechanical ("2.x → A.2.x" was
  wrong): scope order changed, content moved across artifacts (GSM Pause Delay:
  MIP113 §10.1 → A.1.9). **Content matching (8-word shingle containment) is the
  bridge**, and it produces clean §-level citations (many at containment 1.0).
- **Of today's 10,370 docs: 613 predate genesis; 179 trace to MIP text**
  (containment ≥0.25; +79 title-hit-only curation candidates). Genesis→root
  bridges 756/890 (85%) with the existing `matchNodes`; 134 genesis docs died in
  the severed era (29 MIP-traceable — a datable graveyard).
- **Per-section MIP dates are recoverable**: `git log --reverse -S<title>` dated
  160/160 matched sections, 2023-02 → 2024-08 — "Proposed in MIP" events get
  real dates, not one blanket ratification date.
- **Era-1 change history exists if ever wanted**: 626 commits across the six
  artifacts (MIP113 alone 313, 2023-02-09 → 2024-09-05; repo froze 3 days after
  genesis).

⇒ The old "Tier 3: defer, high effort" rating is obsolete — the cross-format
bridge that made it look expensive is validated and cheap. The **origin feature**
("Proposed in MIP N" / "Present at genesis") is specced in `pre-git-history.md`.

## TL;DR lineage

| Era | What | Where | Format | Identity | Dates |
|---|---|---|---|---|---|
| **1. Atlas-as-MIP** | The Atlas *was* **MIP101** ("Maker Atlas Immutable Alignment Artifact"); scopes were sibling MIPs (MIP102–MIP113) | `makerdao/mips` (now `sky-ecosystem/mips`) | MIP-style **markdown** | MIP no. + section no. (top-level `0`–`6`), **no UUIDs** | MIP101 edited **2023-02-09 → 2024-08-12** (54 commits); mips repo frozen 2024-09-05 |
| **2. Atlas v2 / "Next-Gen Atlas"** | "a single file containing all Atlas Documents as a nested tree" (MIP101's own description of its successor) — the HTML file. Rendered on the Powerhouse portal | `makerdao/next-gen-atlas` + `sky-atlas.powerhouse.io` | **HTML** single file; Powerhouse DB | HTML: doc_no `A.x`, **no UUIDs**; Portal: **algorithmic UUIDs** (e.g. `fcd23442-…`) | **v2 upgrade poll #25010 (2024-09-02)**; genesis HTML on IPFS; AEP-1 2025-02-24 |
| **3a. HTML era (severed)** | earlier HTML history of the same file | `makerdao/next-gen-atlas` pre-truncation | HTML | doc_no `A.x` | before 2025-05-28 — **discarded** |
| **3b. HTML era (recoverable)** | the 79 commits we can see | `sky-ecosystem/next-gen-atlas` | HTML | doc_no `A.x` | 2025-05-28 → 2025-11-20 |
| **4. Markdown era** | #117 migration onward | same repo | `Sky Atlas.md` | **uuid4** minted at #117 | 2025-11-21 → |
| **5. Atomized era** | #236 onward | same repo | `content/**/document.md` | uuid (carried) | 2026-05-05 → |

`html-era-history.md` covers eras 3b→5. This doc is about 1, 2, and 3a.

## Evidence

### The Atlas was a MIP (era 1)

- **MIP101 = "Maker Atlas Immutable Alignment Artifact"** (status ACCEPTED), in
  markdown in `makerdao/mips`. Its top sections — `0: Definitions`, `1: The
  Atlas`, … `6: The Accessibility Scope` — are the **same scopes** as the HTML
  atlas (Governance / Support / Stability / Protocol / Accessibility), with the
  same decimal nesting (`2.6.1.1`). The HTML era just prepends the scope letter
  (`A.`), so `2.x` → `A.2.x`. Content is continuous and traceable across the
  boundary; the numbering was transformed.
- Scope artifacts were **sibling MIPs**: MIP102–MIP113 (all still present in the
  repo), e.g. MIP113 "Governance Scope Bounded Mutable Alignment Artifact."
  MIP101.md was edited across **2023-02-09 → 2024-08-12** (54 commits); the
  `makerdao/mips` repo is **not archived** but went quiet on **2024-09-05** —
  right as the Powerhouse render came online (archived 2024-08-29). So the
  handoff MIP101 → next-gen-atlas is **contiguous (~Aug–Sep 2024)**, not a gap.
- **MIP101 itself names its successor:** *"Atlas v2, which is a version of the
  Atlas that no longer relies on the legacy MIP system, and consists of a single
  file that contains all Atlas Documents as a nested tree … when the Atlas v2
  upgrade happens, all MIPs and legacy Atlas MIPs are deleted and their
  functionality fully replaced by Atlas v2."* That single-file nested tree is
  exactly the `Sky Atlas.html` we parse — so the HTML atlas **is** Atlas v2, and
  the MIPs are its explicitly-deprecated predecessor.

### Facilitator accounts (2026-07-01) — MIP consolidation, portal breadcrumbs, repo-privacy explanation

Two governance facilitators (Retro, plus a second unnamed contact) supplied
context that refines and partly resolves open items above:

- **MIP count had an intermediate compression step.** Retro recalls the
  MIP-era Atlas as **~12 scope MIPs (his own "(?)")**, which matches
  MIP102–MIP113 (verified present, above), later **compressed to 5 or 6 MIPs**
  before the final 2024-09-02 unification into the single Atlas v2 HTML file.
  This middle step isn't in our evidence yet — we've only confirmed
  MIP102–MIP113 exist as files, not whether/when some were merged into others
  before the v2 cutover. **Needs verification:** diff `makerdao/mips` history
  for MIP102–113 for a merge event in the 2024 window, and reconcile the
  resulting count (5, matching the five Scopes, or 6, matching five Scopes +
  MIP101) against Retro's recollection.
- **Possible orphaned "still active" legacy MIPs.** Retro flagged an
  unresolved cleanup: some legacy MIPs may still be formally marked
  active/accepted in the MIPs system despite being superseded by Atlas v2 — a
  housekeeping gap, not a content gap. Relevant if Tier 3 is pursued: don't
  assume a MIP's on-repo presence means its governance status was ever closed
  out — check each one directly.
- **The MIP portal already breadcrumbs sources.** Per Retro, the MIP portal
  (the MIPs-era analog of today's atlas reader) links each MIP back to its
  GitHub file, forum thread(s), and voting/polling record. If Tier 3 is
  pursued, this removes most of the by-hand enumeration work the HTML era
  needed (`forum-severed-era-history.md` §1) — the MIP portal is a ready-made
  per-MIP index of `{repo, forum, poll}`.
- **A named human source for era 1.** Retro named **Blimpa (Endgame)** as "the
  last MIP editor still around from early Core Unit days with full hands-on
  context" — the strongest lead yet for Tier 3 (and possibly Tier 2) outreach;
  see open question 5.
- **The severed-repo re-init has a mundane explanation.** A second facilitator
  said the pre-truncation `next-gen-atlas` repo was made private after
  **sensitive info leaked into it**, and that its replacement "should have all
  the same stuff minus sensitive info" — i.e. **no atlas-content loss is
  expected**, only the deliberately-removed sensitive material. This lines up
  with our independent finding that the repo was re-created (not
  force-pushed) exactly on 2025-05-28 (`created_at` same day as `4e931dfd`).
  **This downgrades the expected value of Tier 1's "recover the
  pre-truncation repo" ask** — per this account there's likely nothing
  atlas-relevant in it beyond what the genesis snapshot + forum reconstruction
  already give us, only content someone deliberately chose to withhold. It
  does not affect the Powerhouse op-log ask (Tier 2), a different,
  presumably-clean source. `atlas-data-request.md` updated accordingly.
- **IPFS usage is otherwise rare in this ecosystem.** A facilitator noted the
  only other IPFS usage he's aware of is **"LFW's Random Handover Stuff."**
  Worth a quick look in case it holds relevant historical/handover context,
  but treat as a minor lead, not a load-bearing one — our own IPFS recovery
  (genesis HTML, poll docs) already stands on its own on-chain-verified
  footing.

### Atlas v2 predates our repo, with UUIDs already in place (era 2 / 3a)

- The first-commit tree of `sky-ecosystem/next-gen-atlas` already contains
  **`Atlas Edit Proposals/AEP-1…AEP-11.md`** — the monthly Atlas-edit cycle.
  **AEP-1** is dated *proposed 2025-01-29, ratified 2025-02-24* — months before
  our "first commit" (2025-05-28).
- AEP-1 links edits to **`github.com/makerdao/next-gen-atlas/blob/1c32644a…/Sky
  Atlas/Sky Atlas.html`** (an HTML atlas commit using `A.1.x` numbering) **and**
  to **`sky-atlas.powerhouse.io/A.1.10.1.6_…/fcd23442-3728-4dda-88d7-…`** — i.e.
  the Powerhouse portal already had the atlas rendered **with UUIDs** in early
  2025, well before the #117 uuid4 minting.

### The MIP → v2 switch is a dated governance act (#25010, 2024-09-02)

The handoff is not inferred — it is a single forum post. **"Atlas v2 Upgrade -
Poll Request" (#25010, 2024-09-02, Atlas Axis / Le_Bateleur)** requests the
Governance Facilitators to run the poll that ratifies Atlas v2, and is the primary
source for the whole transition:

- **The v1→v2 structural change, in the authors' words:** Atlas v1 was *the Atlas
  Immutable Alignment Artifact + five separate Bounded Mutable Alignment Artifacts
  (one per Scope)* — six artifacts. Atlas v2 **unifies all six into one file**; the
  five Scopes become sets of Articles, each with Sections, Primary Documents, and
  the new modular **Supporting Documents**.
- **The two canonical genesis forms:** (1) the static HTML on
  `github.com/makerdao/next-gen-atlas`, "optimized for verifiability … will not
  change during the review period," and (2) the `sky-atlas.powerhouse.io` Portal.
  The post states the **content is identical** between them; only the **document
  identifiers differ** — the GitHub repo uses "Atlas Axis' temporary, pared-down
  document numbering scheme" (the `A.x` doc_nos, no UUIDs — verified 0 in the
  genesis HTML), while the Portal IDs are "algorithmically generated." This is
  primary-source confirmation of the **three distinct identity spaces**: repo
  doc_no → Portal algorithmic UUID → #117 uuid4.
- **What changed from v1 (the MIP content delta):** the post enumerates provisions
  *amended or removed* in three buckets — **placeholder logic** (DAO Toolkit,
  Budgets/Milestones standardization, Star provisions, Facilitator
  Scope-Assignment…), **early-stage logic** (NewChain, FacilitatorDAOs, Core AI
  System…), and **obsolete logic** (Core Unit MIPs, Special Purpose Fund, the Core
  Units framework). This is the authors' own summary of the final-MIP → first-atlas
  difference.
- **Per-document MIP provenance lived in the Portal, not the file.** The post
  describes `View Provenance` links mapping each v2 doc back to its v1/MIP source —
  but those are a **Powerhouse Portal** feature; the static HTML carries **zero**
  `View Provenance` links (verified in both the genesis and first-commit HTML). So
  the document-level MIP→v2 map is a Powerhouse-export ask (Tier 2 / data request),
  not recoverable from the HTML.

### Genesis recovered — the true Atlas v2 "version 0" (2024-09-02)

The IPFS CID from #25010
(`bafkreih7mbj4npqhxeprzk7sahpqjrajmxursaenzqgxdw5uo7sz554os4`) resolves to the
**original `Sky Atlas.html`** (693 KB, `<title>Sky Atlas</title>`). Measured against
the git root:

| | genesis (2024-09-02, IPFS) | first commit `4e931dfd` (2025-05-28) |
|---|---|---|
| `<h1>` sections | 10 | 11 |
| doc rows (parsed) | 890 | 4,019 |
| `<dfn>` occurrences (incl. cross-ref citations) | 1,070 | 4,785 |
| bytes | 693 K | 2.07 M |

Same format, same `A.x` doc_no scheme, no UUIDs — so it splices onto era 3b with
the *existing* HTML converter. Its sections (*Scopes, Articles, Sections & Primary
Docs, Type Specifications, Annotations, Tenets, Scenarios, Scenario Variations,
Needed Research, Active Data*) already carry the supporting-document taxonomy
designed on the forum in late 2023 (see "Design genesis"). The severed era is the
~4.4× growth between these two snapshots. **This partly self-serves data-request
item #3** — the genesis snapshot is now in hand; only the *intermediate* commits
still need a cooperative dump.

### Design genesis (2023 GAIT era) — where the document types came from

The v2 taxonomy was not invented at launch; it was designed in the open on the
forum a year earlier, during the **GAIT** ("Governance AI Tools") working-group
phase led by **Atlas Axis / Endgame Edge**. The key thread, **"Proposal for
Structuring the Atlas & GAIT Data Creation" (#22895, 2023-11-23)**, proposes the
supporting-document types the live atlas still uses, with renames that land exactly
in the genesis sections above:

- proposed **`Function`** → shipped as **Type Specification**
- proposed **`FacilitatorDAO Action Tenets`** → genesis **Tenets** → today **Action Tenet**
- proposed **`Annotations`** → **Annotation**; **Scenarios / Scenario Variations** survived as-is
- proposed **`Chapter`** (a Section container) → **never shipped**
- it retires the older **`Element Analysis`** / **`Action Example`** types (gone)

This stratum is **design rationale, not document history** — there are no per-doc
diffs to recover. Its value is provenance (why the types exist) and context for the
chat consumer. Enumerate it via the Atlas Axis author timeline, not a tag (the
`governance-ai-tools` tag holds only 6 threads): `#22569` Data Flywheel, `#22596`,
`#22733` Synthesis, `#22895`, `#23125` "Atomized Sections & the Immutability
Problem", `#23001` "Crafting the Atlas" are the core design series.

### Our "first commit" is a truncation, and the pre-history is gone from GitHub

- `git rev-list --max-parents=0 HEAD` → `4e931dfd` is a **true root** (no
  parents), message literally `"first commit"`, 2025-05-28.
- Commit `1c32644a` (referenced by AEP-1) is **absent locally** and returns
  **HTTP 422 "No commit found"** from the GitHub API even authenticated (`gh
  api repos/sky-ecosystem/next-gen-atlas/commits/1c32644a…`). The repo's GitHub
  **`created_at` is 2025-05-28T19:33:58Z** — the same day as `4e931dfd`. So the
  current repo *object* was **created fresh that day**: the 2024-09
  `makerdao/next-gen-atlas` (which #25010 links to, and which Wayback shows at 127
  commits by Dec 2024) was deleted and re-created, **not** force-pushed in place (a
  force-push would not move `created_at`); it was later renamed/transferred to
  `sky-ecosystem` (the `makerdao → sky-ecosystem` redirect). The pre-2025-05-28
  history died with the prior object — hence the 422, and no fork predates the root.
  Not recoverable through normal GitHub access.
- **The severed history is large.** The Wayback snapshot of the
  `makerdao/next-gen-atlas` landing page on **2024-12-25 shows "127 Commits"**;
  the Powerhouse render `sky-atlas.powerhouse.io` was archived as early as
  **2024-08-29**. So the discarded HTML-era history is *bigger* than the 79
  commits we can currently see (≥127 by Dec 2024, more by the May 2025 re-init) —
  and in the **same HTML format**, so recovering it would roughly multiply the
  HTML-era depth.

### Probe results (2026-06-25) — automated recovery is exhausted

We tried every public route to recover era 3a / verify identity:

- **Severed commits are GC'd everywhere, and no fork retains old history.** All
  **22 forks** were checked: every one **contains our root `4e931dfd` and has
  zero commits dated before 2025-05-28** (GitHub `until=` filter). The earliest
  fork is `adamgfraser/next-gen-atlas` at **2025-05-28T20:56Z** — Adam Fraser
  (who performed the migration) forking ~8 h *after* his own re-init commit the
  same day. `1c32644a` → 422 on the repo *and* every fork. The whole fork network
  descends from the truncated history; none predates it.
- **Wayback has the chrome, not the content.** Only GitHub *landing pages* (Dec
  2024, Mar 2025) and the portal's JS chunks were captured. The **raw HTML blob
  was never archived** (no `raw.githubusercontent.com/.../Sky Atlas.html`
  captures), and the Powerhouse doc pages are client-rendered so their per-doc
  content/UUIDs aren't in Wayback either.
- **The live Powerhouse portal is not a historical source.** It is now a
  client-rendered mirror of the *current* repo (see identity result below).
- **No public Powerhouse data API surfaced.** The portal inlines its data in the
  page payload (~6 MB RSC); no `switchboard`/`graphql`/`reactor` host is
  referenced. *(Superseded re: IPFS — the **genesis HTML CID is public in #25010**
  and resolves; see "Genesis recovered." The portal's per-doc content is still
  client-rendered and not separately archived.)*

⇒ **Era-3a recovery now requires cooperation, not scraping.** The only remaining
routes: ask **Sky / Powerhouse / Atlas-Axis** for the pre-truncation repo or a
**Powerhouse operation-log export** (Powerhouse document-models retain a full
internal operation history — potentially the richest source of all, but
access-gated), or a specific **IPFS CID** for an old `Sky Atlas.html` if someone
has one.

### Identity result (2026-06-25) — Powerhouse UUIDs ≠ #117 UUIDs (question resolved)

Decisively answered, from two directions:

- **Historically separate.** The early-2025 Powerhouse UUID for doc A.1.10.1.6
  (`fcd23442-3728-…`, from the AEP-1 link) appears in **neither** the #117
  markdown **nor** the live portal. The *same doc* was minted a **different**
  uuid4 at #117 (`2ef63f36-5550-…`). The HTML file itself never carried UUIDs
  (0 in the entire HTML era). So early-Powerhouse had its **own** UUID namespace,
  abandoned at the migration.
- **Today Powerhouse mirrors the repo exactly.** The live portal payload contains
  **10 370 UUIDs, and all 10 370 are identical to the current repo's** (100%
  overlap, 0 portal-only). Powerhouse is now downstream of GitHub and adopted the
  repo's #117 uuid4 space.

**Consequence for `html-era-history.md`:** **#117 is confirmed as the canonical
anchor** for the current UUID identity — there is no shortcut from Powerhouse,
and the backward content-threading (§4) remains necessary and correct. The dead
early-Powerhouse UUID space could only ever serve as an *auxiliary within-era key*
if era 3a is recovered; it does not map to current UUIDs by value.

### Forum recovery source (2026-06-25) — the missing era IS narrated, publicly

Searching `forum.skyeco.com` (Discourse) surfaced the single best recovery lead:
**the Atlas Edit Weekly Cycle proposals run continuously back to 2024-09-13**
(`#25083`) — i.e. they blanket the *entire* severed era (≈Sep 2024 → 2025-05-28)
and keep going through today. Each proposal is a structured, dated, attributed
post that contains, per cycle:

- **The human-language edits themselves** — a summary list plus detailed
  before/after content per change (e.g. `#25590`, 2024-11-25, is 73 KB covering
  eleven edit sets). This is *exactly* "the human-language diff is the product"
  (`html-era-history.md` §1), authored by the editors — no converter needed.
- **Powerhouse doc UUIDs** in the links (e.g.
  `sky-atlas.powerhouse.io/A.1.4.9_Adjudication_Process/45b9378d-…`). These are
  the **early-Powerhouse namespace** (verified absent from both the current repo
  and the live portal — 4/4 sampled), so they're a stable *within-severed-era*
  identity key, bridged to #117 UUIDs only by content.
- Occasional **Notion** page/block IDs (`notion.so/1aff2ff0…`, and `…|0db3af…`
  compound v8 IDs) — the edits were drafted in **Notion**. A possible deeper
  source if anyone has access to the Sky/Atlas-Axis Notion workspace.

Caveats: these are *proposed* edits (pre-ratification), so they approximate —
not byte-equal — what landed; they give per-cycle prose diffs, not full per-commit
document state (reconstruct state by replaying, or cross-reference Powerhouse).
The 40-hex SHAs that appear in some posts are **not** next-gen-atlas commits
(422) — they're spell/contract hashes, not a commit-recovery path.

**Net recovery picture:** the raw severed *git commits / HTML files* are
unrecoverable from public sources, **but the severed era's change history is
substantially reconstructable from the forum proposals** — a public, dated,
narrated, UUID-tagged log going back to Sep 2024. For the reader/chat use cases
(which want human-language history, not byte diffs) this may be *good enough* on
its own, without recovering the git objects at all.

### On-chain governance records (2026-06-25) — a permanent, content-addressed index

Every Atlas Edit cycle and AEP was **ratified by an on-chain governance vote**, and
Sky governance **content-addresses what is voted on** — so the cycle history is
indexed on a substrate that *cannot* be garbage-collected like the GitHub repo was.

- **Poll *creation* carries the content, on-chain.** The creation emitter
  **`0xF9be8F0945acDdeeDaA64DFCA5Fe9629D0CF8E5D`** takes
  `createPoll(start, end, string multiHash, string url)` (selector `0xd54a8176`).
  **In the severed era it has 120 such txs — each with an IPFS `multiHash` + a GitHub
  raw URL — of which 21 are Atlas Edit polls** (weekly Sep–Nov 2024, the monthly AEP
  experiment Feb–Apr 2025, weekly again to 2025-05-12). Verified end-to-end: the
  2025-02-10 tx carries `QmeTDMyssxJJF6vYE3DcD8KFoNdBTwfPSvuvcyM5Ci2Ws9` + the URL to
  `…/makerdao/community/…/polls/Atlas Edit Monthly Cycle Proposal (AEP-1)….md` —
  matching AEP-1.md's `…/polling/QmeTDMys…`. The poll markdown holds `title`,
  `summary`, `discussion_link` (forum), `start/end_date`, vote options, and body
  links to the edited atlas docs **with Powerhouse UUIDs** (e.g. `A.1.10.2-430185a5-…`).
- **Vote tallies sit on a second emitter.** `Voted(voter, pollId, optionId)` events
  land on **`0xD3A9FE267852281a1e6307a1C37CDfD76d39b133`** (verified ContractName
  `PollingEmitter`) — the permanent per-voter tally + timing.
- **Content is dual-hosted + durable.** Poll docs live in
  `makerdao/community/governance/polls/*.md` (a non-truncated public repo — an
  earlier code-search "0 matches" was a false-negative) **and** are IPFS-pinned by
  the `multiHash`; either resolves the exact text.
- **IPFS pinning here is a standing archival practice** (forum #21513), not ad-hoc:
  the poll-doc CIDs trace a continuum — **`hernandoagf/ipfs-sync`** (GovAlpha-era; a
  1,743-file CID→filename manifest mirroring `makerdao/community` polls to Pinata,
  last synced **2024-01-12**) → a **Powerhouse-maintained IPNS aggregator** of forum
  IPFS content (`k51qzi5uqu5dglo9i1zzz5t08z8s0dg5ollqti74tpjtkeqwdg1y704n83lbof`,
  Powerhouse Pinata — the Atlas/Powerhouse-era successor) → the on-chain `createPoll`
  CIDs above. The genesis HTML CID rides the same Powerhouse-Pinata pinning. That
  IPNS record is now **expired** (unresolvable; not in Wayback) → a Powerhouse-Pinata
  contact-ask (see data request), but it confirms the poll docs are redundantly
  archived beyond `makerdao/community`.
- **Executive enactment (the binding vote).** The Chief is where spells — including
  the Atlas v2 upgrade and spell-borne edits — are approved: chainlog **`MCD_ADM =
  0x929d9A14…`** (current), with the **classic Chief `0x0a3f6849…`** in the portal
  config (a Chief migration occurred — confirm which was live for a given
  severed-era date). #25010 notes the v2 HTML hash is enforced "by Sky Governance …
  similar to the controls that exist around the MIP process."

**Recovery chain (verified end-to-end):** on-chain `createPoll` calldata on
`0xF9be…` → `{date, IPFS multiHash, makerdao/community URL}` per poll → fetch the
poll markdown (IPFS or GitHub) → its `title` / `discussion_link` / atlas-doc links
(+ Powerhouse UUIDs) → cross-reference the forum proposal + AEP. This is a
**permanent, dated, content-addressed, public** index of the severed-era Atlas Edit
cycles — **self-serve, no contact needed**. It records *which* edits were ratified,
*when*, and *links to the doc + forum prose*; the literal HTML diff still comes from
the genesis/forum reconstruction (or the recovered genesis snapshot).

## Should we extend history before the HTML era? — tiered take

The "true beginning" is **not** `4e931dfd`. Three strata exist before era 3b;
they differ sharply in value and in how cleanly they splice onto the existing
plan. Each is a fresh **repo + format + identity** boundary, so each needs its
own seed match — but the backward-threading + content-matching machinery in
`html-era-history.md` (§4) generalizes to all of them.

**Tier 0 — on-chain poll index + IPFS/GitHub poll docs. Most durable, and public.**
Independent of the GC'd git repo: severed-era `createPoll` txs (emitter `0xF9be…`)
give per poll `{date, IPFS multiHash, makerdao/community URL}` — 21 Atlas Edit polls
across 2024-09→2025-05 — and the poll docs are dual-hosted (IPFS + GitHub), each
linking to the edited atlas docs + forum thread (see "On-chain governance
records"). Best used to **timestamp, corroborate, ratify-filter, and forum-link**
the reconstruction. Self-serve; no contact needed.

**Tier 1 — reconstruct the severed HTML era (era 3a). Highest value, now partly
recovered.** Same format (HTML, same single file, same `A.x` numbering) and same
authoring cadence, so it splices onto era 3b with the *existing* HTML converter and
**no new boundary type**. We now hold **both content endpoints**: the **genesis
HTML (2024-09-02, 890 docs)** recovered from the #25010 IPFS CID, and the first
git commit (2025-05-28, 4,019 docs). The intermediate per-commit git objects are
still unrecoverable publicly (repo re-created 2025-05-28, no pre-truncation fork,
raw HTML not in Wayback), **but** the era's *change history* is reconstructable
from the **forum Atlas Edit Weekly Cycle proposals** (continuous back to 2024-09-13
— see "Forum recovery source"), now bracketed and calibratable against the two
exact snapshots. For reader/chat (human-language history) that likely suffices.
Recovering the literal intermediate commits still needs the pre-truncation repo / a
Powerhouse export from **Sky / Powerhouse / Atlas-Axis**. **Updated take
(2026-07-01):** per a facilitator account (see "Facilitator accounts" above),
the pre-truncation repo was reportedly made private over a sensitive-info leak
and its replacement should carry everything else — so that specific ask is
now low-value; treat the forum+genesis reconstruction as the likely *ceiling*
for this window, not a stand-in for a fuller recovery, and lean on the
Powerhouse op-log ask (Tier 2) instead if more depth is wanted.

**Tier 2 — Powerhouse operation-log export. The real prize if a contact exists.**
The earlier "is Powerhouse the identity anchor?" question is **resolved: no** —
its early UUID space is dead and the live portal mirrors the repo (above). But
Powerhouse document-models keep a **full internal operation history** (every edit
as an operation, far finer-grained than git commits). If Sky/Powerhouse can
export the Atlas document-model's operation log, that is potentially a *better*
history source than git for **all** eras — richer granularity, native doc
identity, and likely reaching back to the 2024 Powerhouse era. Access-gated, so
pursue only via a contact; do not block the html-era plan on it.

**Tier 3 — MIPs-era markdown (era 1). ~~Defer~~ → MEASURED VIABLE (2026-07-06);
origin events are cheap, full era-1 change history remains optional.**
`makerdao/mips` is fully available (no recovery needed). The feared cross-format
bridge (separate MIP docs → unified HTML tables) is **validated**: shingle
containment attributes 179 of today's docs to specific MIP sections with §-level
citations, and `git log -S` dates every matched section (see "Lineage measured"
above). The *origin* slice ("Proposed in MIP N") is now Phase A of
`pre-git-history.md`. What stays deferred is the *full* era-1 change history
(replaying the 626 commits into per-doc events) — real depth (2023-02 →
2024-09), same machinery, but only worth building if the origin feature creates
appetite. The facilitator leads (**MIP portal** breadcrumbs; **Blimpa** as
era-1 human context) remain relevant only for that deeper slice.

## Open questions to resolve before any pre-HTML build

1. ~~**Recoverability of era 3a** via Wayback/IPFS/forks~~ — **partly resolved.**
   The **2024-09-02 genesis HTML is recovered** (IPFS CID in #25010) and the git
   root is in hand; only the *intermediate* commits remain unrecoverable (repo
   re-init, no pre-truncation fork, raw HTML not in Wayback) — and, per a
   facilitator account (2026-07-01), likely low-value even if recovered (see
   Tier 1, "Updated take").
2. ~~**UUID provenance** — Powerhouse vs #117~~ — **resolved: different spaces.**
   #117 is the canonical anchor; the early-Powerhouse UUIDs are dead. No change to
   the html-era plan's anchor.
3. **How far back is worth it** for the three consumers (reader / radar / chat).
   Chat benefits most from depth; reader/radar mostly want continuity through
   #117, which era 3b already provides. → Likely **don't block** on pre-3b.
4. **Is a Powerhouse operation-log export obtainable** (Tier 2)? The single
   highest-leverage follow-up — it could supersede the git-based history entirely,
   but needs a Sky/Powerhouse contact.
5. **One outreach decision — now with a named contact.** Per the facilitator
   account (2026-07-01), asking for the **pre-truncation repo** itself is
   lower-value than previously thought (expected to add nothing but the
   sensitive info that was deliberately removed) — deprioritize that ask. The
   **Powerhouse op-log** export remains the high-value ask (Tier 2, a
   different/clean source). **Blimpa (Endgame)** is the concrete lead for
   era-1 (Tier 3) outreach; still need a separate Sky/Powerhouse contact for
   the op-log ask.
6. ~~**Verify the MIP consolidation step** Retro described~~ — **resolved
   (2026-07-06) from the MIP preambles.** The twelve MIP102–113 files split
   cleanly: **six Scope *Frameworks* are `Status: Obsolete`** (MIP103 Stability
   & Liquidity, MIP105 RWA Collateral, MIP109 Physical Resilience, MIP110
   Interface, MIP111 Infrastructure, MIP112 Finance) and **five Scope *BMAAs*
   + MIP101 are `Status: Accepted`** (MIP104 Stability, MIP106 Support, MIP107
   Protocol, MIP108 Accessibility, MIP113 Governance) — exactly the "six
   artifacts" poll #25010 says v2 unified, and exactly Retro's "12 → 5 or 6"
   (all twelve proposed the same day, 2023-02-06; the framework set was
   obsoleted in favor of the five BMAAs). No mid-2024 merge event needed.
7. ~~**Check for orphaned "still active" legacy MIPs**~~ — **confirmed
   (2026-07-06): the housekeeping gap is real.** All six v1 artifacts
   (MIP101/104/106/107/108/113) still read `Status: Accepted` in the frozen
   repo — none was marked Obsolete/Superseded at the v2 cutover. Treat MIP
   `Status:` fields as unreliable for supersession; the v2 poll (#25010,
   2024-09-02) is the authoritative close-out event.
