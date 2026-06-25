# Atlas pre-history: MIPs → Powerhouse → next-gen-atlas

Status: RESEARCH (2026-06-24; recovery + identity probes 2026-06-25). Companion
to `html-era-history.md`. Question investigated: the `Sky Atlas.html` "first
commit" is not the true beginning of the Atlas — what came before, and should we
extend document history further back than the HTML era?

**Answer: yes, there is a real pre-history in at least three earlier strata — but
two follow-up questions are now settled by measurement:**
- **The severed HTML pre-history is large (≥127 commits by Dec 2024).** The raw
  git objects/HTML are unrecoverable publicly (GC'd from GitHub, no pre-truncation
  fork, not in Wayback, live portal mirrors the current repo) — recovering the
  *source* needs a cooperative dump. **However, the severed era's change history
  is publicly reconstructable** from the **forum Atlas Edit Weekly Cycle
  proposals**, which run continuously back to **2024-09-13** with narrated,
  UUID-tagged per-cycle edits — likely good enough for the reader/chat consumers.
- **Powerhouse UUIDs ≠ #117 UUIDs**: early-Powerhouse had its own (now dead) UUID
  namespace; the live portal today mirrors the repo's #117 space exactly (10 370 /
  10 370). So **#117 stays the canonical anchor** for `html-era-history.md` — no
  change needed there.

Details and a tiered recommendation below.

## TL;DR lineage

| Era | What | Where | Format | Identity | Dates |
|---|---|---|---|---|---|
| **1. Atlas-as-MIP** | The Atlas *was* **MIP101** ("Maker Atlas Immutable Alignment Artifact"); scopes were sibling MIPs (MIP102–MIP113) | `makerdao/mips` (now `sky-ecosystem/mips`) | MIP-style **markdown** | MIP no. + section no. (top-level `0`–`6`), **no UUIDs** | MIP101 edited **2023-02-09 → 2024-08-12** (54 commits); mips repo frozen 2024-09-05 |
| **2. Atlas v2 / "Next-Gen Atlas"** | "a single file containing all Atlas Documents as a nested tree" (MIP101's own description of its successor) — the HTML file. Rendered on the Powerhouse portal | `makerdao/next-gen-atlas` + `sky-atlas.powerhouse.io` | **HTML** single file; Powerhouse DB | doc_no `A.x`; **Powerhouse UUIDs** (e.g. `fcd23442-…`) already present | live & edited by early 2025 (AEP-1 ratified 2025-02-24) |
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

### Our "first commit" is a truncation, and the pre-history is gone from GitHub

- `git rev-list --max-parents=0 HEAD` → `4e931dfd` is a **true root** (no
  parents), message literally `"first commit"`, 2025-05-28.
- Commit `1c32644a` (referenced by AEP-1) is **absent locally** and returns
  **HTTP 422 "No commit found"** from the GitHub API even authenticated (`gh
  api repos/sky-ecosystem/next-gen-atlas/commits/1c32644a…`). The
  `makerdao → sky-ecosystem` org rename is a transparent redirect to the *same*
  repo, so this is not an org-move artifact — the pre-2025-05-28 history was
  **force-discarded / re-initialized** and garbage-collected. It is not
  recoverable through normal GitHub repo access.
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
  referenced. IPFS gateways (`ipfs.io`, `gateway.pinata.cloud`) appear only as
  content links, not as an atlas-snapshot CID.

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

## Should we extend history before the HTML era? — tiered take

The "true beginning" is **not** `4e931dfd`. Three strata exist before era 3b;
they differ sharply in value and in how cleanly they splice onto the existing
plan. Each is a fresh **repo + format + identity** boundary, so each needs its
own seed match — but the backward-threading + content-matching machinery in
`html-era-history.md` (§4) generalizes to all of them.

**Tier 1 — recover the severed HTML pre-history (era 3a). Highest value, now
blocked on cooperation.** Same format (HTML, same single file, same `A.x`
numbering) and same authoring cadence (AEP-1..11 ⇒ ~monthly edits back to ~Jan
2025), so it would splice onto era 3b with the *existing* HTML converter and **no
new boundary type** — just more commits (≥127 by Dec 2024). The raw git
objects/HTML files are unrecoverable from public sources (GC'd from GitHub, no
pre-truncation fork, not in Wayback as file content, not on the live portal).
**But** the era's *change history* is reconstructable from the **forum Atlas Edit
Weekly Cycle proposals** (continuous back to 2024-09-13 — see "Forum recovery
source"): public, dated, narrated, UUID-tagged. For reader/chat (human-language
history, not byte diffs) that may suffice without the git objects. To recover the
literal source, the only route is **asking Sky / Powerhouse / Atlas-Axis** for the
pre-truncation repo / a Powerhouse export.

**Tier 2 — Powerhouse operation-log export. The real prize if a contact exists.**
The earlier "is Powerhouse the identity anchor?" question is **resolved: no** —
its early UUID space is dead and the live portal mirrors the repo (above). But
Powerhouse document-models keep a **full internal operation history** (every edit
as an operation, far finer-grained than git commits). If Sky/Powerhouse can
export the Atlas document-model's operation log, that is potentially a *better*
history source than git for **all** eras — richer granularity, native doc
identity, and likely reaching back to the 2024 Powerhouse era. Access-gated, so
pursue only via a contact; do not block the html-era plan on it.

**Tier 3 — MIPs-era markdown (era 1). Defer; treat as its own era if pursued.**
`makerdao/mips` is fully available (no recovery needed), but it's a **different
repo, different format** (MIP-style markdown, top-level `0`–`6` numbering, scopes
as separate MIP files) and **different identity** (MIP/section numbers, no
UUIDs). Splicing it is a second cross-format, cross-repo bridge whose structural
gap (separate MIP docs → unified HTML tables) is *larger* than the HTML→md gap.
High effort, 2023-era depth. Only worth it if there's explicit appetite for
"what did the Atlas say when it was first ratified."

## Open questions to resolve before any pre-HTML build

1. ~~**Recoverability of era 3a** via Wayback/IPFS/forks~~ — **resolved: no.**
   GC'd from GitHub, no pre-truncation fork, raw HTML not in Wayback. Only a
   cooperative dump from Sky/Powerhouse/Atlas-Axis remains.
2. ~~**UUID provenance** — Powerhouse vs #117~~ — **resolved: different spaces.**
   #117 is the canonical anchor; the early-Powerhouse UUIDs are dead. No change to
   the html-era plan's anchor.
3. **How far back is worth it** for the three consumers (reader / radar / chat).
   Chat benefits most from depth; reader/radar mostly want continuity through
   #117, which era 3b already provides. → Likely **don't block** on pre-3b.
4. **Is a Powerhouse operation-log export obtainable** (Tier 2)? The single
   highest-leverage follow-up — it could supersede the git-based history entirely,
   but needs a Sky/Powerhouse contact.
5. **One outreach decision**: do we ask the Sky/Powerhouse/Atlas-Axis team for the
   pre-truncation repo + the Powerhouse op-log, or accept era 3b as the floor?
