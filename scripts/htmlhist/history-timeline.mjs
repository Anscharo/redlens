// Temporal context for the HTML-era curation LLM (plan §10.4 timeline enrichment).
// Pure: given the already-loaded HTML commits (oldest→newest, same shape used by
// forwardTrace/runAutoCurate) and a candidate/subject's occurrence key, answers two
// questions the content/position signals can't:
//   1. When was this row's identity FIRST introduced, and when was it LAST edited
//      (up to the commit the query is scoped to)?
//   2. What did the commit that introduced/last-edited it actually say (joined
//      against the already-fetched per-commit PR/forum context)?
// Identity across hops reuses forwardTrace's independent quasi-ids (the same
// mutual-best lineage the forward∩reverse auto-resolution pass already trusts) — not
// the production backward matcher, so this stays a genuinely independent signal.

import { forwardTrace } from "./history-forward-trace.mjs";
import { contentDupCounts, occKey } from "./history-occkey.mjs";

// Build once per pipeline run (commits: [{sha, nodes}] oldest→newest). Returns:
//   idOf     — node -> quasiId (forwardTrace's identity assignment)
//   groups   — quasiId -> [{sha, node}] oldest→newest (a lineage's full occurrence history)
//   nodeByKey — occKey string -> node object, to bridge a candidate/subject key to its lineage
export function buildTimelineIndex(commits) {
  const { idOf } = forwardTrace(commits);
  const groups = new Map();
  const nodeByKey = new Map();
  for (const c of commits) {
    const dup = contentDupCounts(c.nodes);
    for (const n of c.nodes) {
      const qid = idOf.get(n);
      let g = groups.get(qid);
      if (!g) groups.set(qid, (g = []));
      g.push({ sha: c.sha, node: n });
      nodeByKey.set(occKey(c.sha, n, dup), n);
    }
  }
  return { idOf, groups, nodeByKey };
}

// The introduction commit + the last edit commit for the row at `key`, scoped to AT
// OR BEFORE that row's own commit — a candidate is always shown at a specific past
// occurrence, so edits later in its lineage (after the commit being asked about)
// aren't yet "history" from that occurrence's point of view. Returns
// { firstSeen:{sha}, lastEdit:{sha}|null } or null if the key doesn't resolve.
export function timelineFor(index, key) {
  const node = index.nodeByKey.get(key);
  if (!node) return null;
  const sha = key.split(":")[0];
  const group = index.groups.get(index.idOf.get(node));
  if (!group?.length) return null;
  const at = group.findIndex((g) => g.sha === sha && g.node === node);
  const upTo = at >= 0 ? at : group.length - 1;
  let lastEdit = null;
  for (let i = 1; i <= upTo; i++) {
    if (group[i].node.contentHash !== group[i - 1].node.contentHash) lastEdit = group[i];
  }
  return { firstSeen: { sha: group[0].sha }, lastEdit: lastEdit ? { sha: lastEdit.sha } : null };
}

// sha -> {date, pr, title, summary}, from the curation artifact's per-commit metadata
// (already fetched by build-history-curation.mjs for EVERY html commit, not just the
// ones a case references) — so enriching a timeline needs no new PR/forum fetching.
export function commitInfoIndex(dataCommits) {
  const m = new Map();
  for (const c of dataCommits || []) {
    m.set(c.sha, { date: c.date ?? null, pr: c.pr ?? null, title: c.prTitle ?? null, summary: c.changeSummary ?? null });
  }
  return m;
}

// Attach {date, pr, title, summary} to a timeline's firstSeen/lastEdit shas.
export function enrichTimeline(timeline, commitInfo) {
  if (!timeline) return null;
  const withInfo = (t) => (t ? { ...t, ...(commitInfo.get(t.sha) || {}) } : null);
  return { firstSeen: withInfo(timeline.firstSeen), lastEdit: withInfo(timeline.lastEdit) };
}
