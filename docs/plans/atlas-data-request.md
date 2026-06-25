# Data request — early Sky Atlas history (for handoff)

*Short note to forward to a Sky / Powerhouse / Atlas-Axis contact. Plain language,
no project internals.*

---

**What we're building.** A community Sky Atlas reader that shows the full edit
history of each Atlas document over time — including through the change from the
old HTML Atlas to the current Markdown one.

**The gap we hit.** The public `sky-ecosystem/next-gen-atlas` GitHub repo only
goes back to a "first commit" on **28 May 2025**. Everything before that was
re-initialized away — the earlier history is gone from GitHub (and from every
fork). But we know the Atlas was already live and being edited well before then
(the repo had ~127 commits by Dec 2024, and the Powerhouse portal was rendering
it by Aug 2024). We'd like to recover that earlier history.

**What would help, in order of usefulness:**

1. **A copy of the old `next-gen-atlas` repository from before 28 May 2025** —
   ideally a full git clone or bundle (or just having the old commit history
   restored). Anyone who cloned it in late 2024 / early 2025 likely still has it
   locally.

2. **A Powerhouse export of the Atlas document's edit history** — if the Atlas
   document model on Powerhouse keeps an operation/revision log, an export of
   that log would be even better than git, and may reach back further (into the
   2024 Powerhouse era).

3. **Any saved snapshots of the old `Sky Atlas.html` file** from before 28 May
   2025 — individual file copies, or an IPFS link/CID if one was pinned.

**Why it matters.** With any one of these we can show readers a continuous,
accurate document history through the HTML→Markdown migration, instead of it
starting abruptly in mid-2025.

Even a rough pointer (who ran the migration, who maintained the old repo, or who
operates the Powerhouse instance) would let us follow up. Thanks!
