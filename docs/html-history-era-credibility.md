 ---
  # How the HTML-era atlas history is built — and why you can trust it

  In one line: For the 79 commits before the markdown migration (#117, 2025‑11‑21) — when the atlas was a single Sky Atlas.html file with no document IDs — we reconstruct a per‑document, per‑commit change history that
  threads continuously into the modern (UUID‑keyed) history.

  ## The hard part

  Pre‑#117 documents are table rows, not headings, and carry no stable identity: ~60% have no parseable document number, and temporary names collide hundreds of times (Parameters appears 129×). The only ground‑truth
  identity anywhere is the set of real UUIDs minted at the #117 migration. So the whole problem is: given identity at the end, recover each document's identity backward through 79 commits of edits, renames, and renumbers.

  ## How it's built (offline, once)

  1. Deterministic conversion. Each commit's HTML → markdown via a single pinned converter. Because every diff compares converted‑markdown(N) vs (N−1) through the same converter, conversion artifacts cancel — only genuine
  prose changes survive. The bar is determinism, not fidelity.
  2. Thread backward from the anchor. Real UUIDs exist only at #117, so we seed there and carry identity backward in time, so errors decay away from ground truth instead of compounding toward it.
  3. Tiered content matching. Cheapest‑first: exact content hash (99.6% of pairs), then structural key, then order‑preserving alignment within sibling groups, then fuzzy. A confident, uncontended match is taken; an
  uncertain one is flagged, never guessed. At the seed, where many sibling rows share boilerplate prose that differs only by chain/instance ("Base USDC Deposit Maximum" vs "Unichain USDC Deposit Maximum"), a title tiebreak
  separates content‑tied candidates by matching the row's title — overriding the content pick only on a clear margin, so an already‑exact content match is never regressed.
  4. Events + lineage. A forward pass emits added/modified/moved/removed with real line‑diffs — identical in shape to the markdown era — plus a per‑doc "seam" record (kept/split/merged) so a doc's #117 lineage is
  followable.
  5. Frozen once. Computed offline and frozen to a checked‑in artifact; never recomputed, so a future converter tweak can't silently rewrite history.

  ## Why it's trustworthy

  - Reproducible by construction. No randomness; synthetic IDs are deterministic hashes. Same commit + converter + recorded decisions → byte‑identical result.
  - Nothing is lost. Every document at every commit produces an event by construction; content is conserved across the migration (~89% prose survival; ~0 genuinely new/deleted at the seam — a reorganization, not
  creations/deletions).
  - Cross‑validated. Mid‑era deaths counted by threading (853) match a separate structural scan (~852) — two unrelated methods agree.
  threads continuously into the modern (UUID‑keyed) history.

  ## The honest limits — and how they're closed

  Threading identity backward through near‑identical sibling documents (one "Reward Payments" doc per instance) is inherently ambiguous. We do not paper over this.
  - What changed at each commit is ~99% confident — content is provably accounted for.
  - Which document owns each change is **measured at 98.7% (change‑aware) / 95.6% (strict identity)** weighted across all ~7,400 decisions — not estimated. The audit (`pnpm htmlhist:audit --live`) stratified‑samples each
  decision type, has an LLM judge each on the same evidence the matcher used, and reports per‑batch accuracy with a 95% Wilson interval. The two headline numbers differ only in how they treat swaps between **byte‑identical**
  documents (the same boilerplate stub under two instances): the strict number counts them as identity errors, the change‑aware number does not — because swapping identical content yields identical change‑history, so it
  cannot produce a wrong or missing change. The big pools (the seed: ~6,700 decisions) measure ~100%; the residual concentrates in a small flagged‑ambiguous tail (~300 decisions, ~80% correct).
  - Every uncertain decision is surfaced, not hidden. The flagged‑ambiguous tail is where real missed threads live (a doc edited in place that the tiered matcher couldn't confidently re‑link); an LLM proposes resolutions (the
  instance name is in the prose), a human confirms, and each decision is recorded so it stays reproducible.

  ## Bottom line

  A deterministic, frozen, fully‑tested pipeline that provably loses no content and threads the overwhelming majority of documents correctly and automatically. The residual identity uncertainty — small, bounded,
  concentrated — is measured, surfaced, and verified rather than assumed away.

