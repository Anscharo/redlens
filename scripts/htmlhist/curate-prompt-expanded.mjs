// The "final escalation" prompt for the HARDEST residual HTML-era curation cases —
// the ones that survived content-similarity matching, forward-tracing, LLM cross-
// checks, and frontier-model escalation without a confident resolution. Adds a
// TIMELINE dimension (when things happened, from history-timeline.mjs) the existing
// propose prompt (src/server/history/history-curate.ts) doesn't have, and a third verdict
// ("widen") so a case where the truth isn't among the shown candidates doesn't get
// force-matched or wrongly marked "born". Pure string templating, no LLM call — this
// assembles ready-to-paste system/user text for a human/agent to run elsewhere.
// Deliberately self-contained (no import from history-curate.ts): this is exploratory
// tooling, not a wired-in pipeline stage, so it doesn't reach into that module's
// internals.

export const SYSTEM_EXPANDED = `You thread an atlas document's history across the HTML-to-markdown migration. This is the HARDEST residual tier — cases that survived content-similarity matching, forward-tracing, LLM cross-checks, and frontier-model escalation without a confident resolution. Given a NEWER (markdown-era) document and several OLDER (HTML-era) candidates, decide which candidate is its previous version — or that none of them is.

There is exactly one correct predecessor for every document that has one; it is either among the candidates shown or it is not. NEVER pick the best-of-a-bad-set candidate just because nothing better is offered, and NEVER default to "this is new" just because no candidate is fully convincing — those are different failure modes and you must tell them apart:

- "match" — one specific candidate is convincingly the predecessor.
- "born" — the newer document is genuinely new; no predecessor exists anywhere. Justify this from the change description (explicit "Added"/new-topic language) — not merely from candidate weakness.
- "widen" — a predecessor almost certainly exists (the change description says this topic was "Updated", or the document clearly continues an established topic/role) but NONE of the shown candidates is it. Say so instead of forcing a pick, so the search can look beyond this candidate set.

Content is EXPECTED to change between versions — values, wording, even a rename are normal edits, NOT evidence of a different document. Weigh evidence in this order:
1. THE CHANGE that produced the newer document (PR + forum edit-list) — "Updated X" implies a predecessor exists; "Added Y" implies born.
2. CHANGES → newer (line diff from candidate to newer doc, when available) — the true predecessor shows a small, coherent change.
3. TIMELINE — each candidate shows when it was INTRODUCED and when it was LAST HTML-EDITED before the migration, with that edit's PR/forum text; the newer document shows its own edit history SINCE the migration, if any. A candidate that was already dormant/superseded long before the migration is a red flag; a newer document whose post-migration edits describe a completely different topic than any candidate is also a red flag — against that pairing, not necessarily against a match existing elsewhere.
4. Scope + position — top-level scope (Governance, Support, Stability, Protocol, Accessibility, Agent), owning process ("under:"), breadcrumb ("path:"), neighbors ("position: … ‹THIS› …").
5. Title, subject/role, and prose, last.

A candidate may note that no other document could continue it (declining it here deletes that document's history for good) — weigh "sole home" candidates generously.

Reply ONLY JSON: {"verdict":"match"|"born"|"widen","chosenKey":"<one of the candidate keys>"|null,"why":"<short>"}. chosenKey is required (and must be one of the shown keys) only when verdict is "match"; null otherwise.`;

const clip = (text, max = 1200) => (text || "").slice(0, max);

const posLine = (ctx) => {
  if (!ctx) return "";
  const chain = [...(ctx.prev ?? []).slice().reverse(), "‹THIS›", ...(ctx.next ?? [])].join(" » ");
  const scope = ctx.scope ? `\n  scope: ${ctx.scope}` : "";
  const parent = ctx.parent ? `\n  under: ${ctx.parent}` : "";
  const path = ctx.path?.length ? `\n  path: ${ctx.path.join(" › ")}` : "";
  return `${scope}${parent}${path}\n  position${ctx.docNo ? ` ${ctx.docNo}` : ""}: ${chain}`;
};

const timelineEntry = (t) => (t ? `${t.date ?? "?"}${t.pr ? ` (PR #${t.pr}: ${t.title || ""}${t.summary ? ` — ${clip(t.summary, 400)}` : ""})` : ""}` : null);

const timelineNote = (timeline) => {
  if (!timeline) return "";
  const intro = timelineEntry(timeline.firstSeen);
  const last = timelineEntry(timeline.lastEdit);
  return (intro ? `\nINTRODUCED: ${intro}` : "") + (last ? `\nLAST HTML EDIT: ${last}` : "");
};

const postMigrationNote = (p) => {
  if (!p) return "";
  if (p.deletedAt) return `\nPOST-MIGRATION: deleted ${p.deletedAt}`;
  if (p.edits?.length) return `\nPOST-MIGRATION: ${p.edits.length} edit(s) since migration, most recent ${p.edits[0].date} — "${p.edits[0].prTitle}"`;
  return `\nPOST-MIGRATION: untouched since migration`;
};

const homeNote = (c) =>
  c.soleHome ? `\n  note: no other document lists this candidate — if not chosen here it is treated as DELETED.`
    : c.alsoClaimedBy ? `\n  note: also a candidate for ${c.alsoClaimedBy} other document(s).` : "";

// subject   = enrichSubject() output + optional {timeline} (backward-hop subjects) or
//             {postMigration} (seed-close subjects — the newer doc IS the final md doc)
// candidates = enrichCandidates() output, each optionally + {timeline}
// opts.change = {pr, title, summary} for the commit that produced the newer document
export function buildExpandedUser(subject, candidates, opts = {}) {
  const ch = opts.change;
  const changeBlock = ch && (ch.title || ch.summary)
    ? `THE CHANGE that produced the newer document${ch.pr ? ` (PR #${ch.pr})` : ""}: ${ch.title || ""}${ch.summary ? `\n${clip(ch.summary, 1400)}` : ""}\n\n`
    : "";
  const subjectExtra = timelineNote(subject.timeline) + postMigrationNote(subject.postMigration);
  const body =
    changeBlock +
    `NEWER document:\n[${subject.title}] ${clip(subject.content)}${posLine(subject.context)}${subjectExtra}\n\n` +
    `OLDER candidates (pick the one that is its previous version, or say "widen"/"born"):\n` +
    candidates
      .map((c) =>
        `key=${c.key}\n[${c.title}] ${clip(c.content)}` +
        (c.diff ? `\nCHANGES → newer:\n${clip(c.diff, 800)}` : "") +
        posLine(c.context) + timelineNote(c.timeline) + homeNote(c),
      )
      .join("\n\n");
  return body;
}
