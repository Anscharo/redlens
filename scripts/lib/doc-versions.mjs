/**
 * Per-document version records, derived from upstream's history: one row each
 * time a document's fingerprint (doc-fingerprint.mjs) changes, and one with a
 * null fingerprint when it is removed. A document's version is therefore live
 * over [its row's commit_seq, the next row's commit_seq) — the intervals a
 * preview votes over to find the upstream commit a fork was last in sync with.
 *
 * Deliberately NOT read off atlas_history's events: since the consolidated
 * layout (#294) a renumbering inside one bucket file moves no path and changes
 * no body, so it produces no history event at all — and renumberings are the
 * bulk of what a stale fork shows as phantom changes.
 *
 * Pure; the walk + DB sink live in scripts/required/build-doc-versions.mjs.
 */

import { gitEntryFingerprint } from "./doc-fingerprint.mjs";

/** atlas-git-source snapshot (uuid → entry) → uuid → fingerprint. */
export function fingerprintSnapshot(snapshot) {
  const out = new Map();
  for (const [id, entry] of snapshot) out.set(id, gitEntryFingerprint(entry));
  return out;
}

/**
 * Rows for one commit: every document whose fingerprint differs from the
 * previous commit's (added or changed), and every document that disappeared.
 * Empty when the commit changed no document.
 * @param {Map<string,string>} prev @param {Map<string,string>} curr
 * @param {{ sha: string, seq: number }} commit
 */
export function versionRows(prev, curr, commit) {
  const rows = [];
  for (const [id, fp] of curr) {
    if (prev.get(id) !== fp) rows.push({ doc_id: id, commit_seq: commit.seq, commit_sha: commit.sha, fingerprint: fp });
  }
  for (const id of prev.keys()) {
    if (!curr.has(id)) rows.push({ doc_id: id, commit_seq: commit.seq, commit_sha: commit.sha, fingerprint: null });
  }
  return rows;
}
