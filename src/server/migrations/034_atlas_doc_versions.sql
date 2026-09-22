-- Upstream's per-document version record: which STATE of each document
-- (body + title + doc number, as one fingerprint) was live at which commit.
--
-- A preview of a repo that shares no git history with nga main — every private
-- mirror, since nga main is squash-merged — can only be compared against live
-- nga main, so everything upstream changed since the fork last synced shows up
-- as the fork's change (measured: a two-week-stale mirror with NO changes of its
-- own shows 945 "changed" documents). These rows let the fork's CONTENT find the
-- upstream commit it was last in sync with: a document's version is live over
-- [its row's commit_seq, the next row's commit_seq), and the sync point is the
-- commit the fork's documents agree with most. No shared ancestry needed.
--
--   doc_id       the document's uuid
--   commit_seq   position in the submodule's full log — the same numbering as
--                atlas_history.commit_seq, so the two can be joined
--   commit_sha   full 40-hex sha (a preview fetches the upstream tree at it)
--   fingerprint  scripts/lib/doc-fingerprint.mjs over the CLEANED content, the
--                same value a built docs.json yields; NULL = removed here
--
-- Not atlas_history.content_hash (declared in 001, never written): history only
-- has rows where it has events, and since the consolidated layout a renumbering
-- inside one bucket file produces no event at all.
--
-- Written by scripts/required/build-doc-versions.mjs, which keeps its own cursor
-- here — so the first run after this migration backfills the whole history by
-- itself, with no manual step.
CREATE TABLE IF NOT EXISTS atlas_doc_versions (
  doc_id       UUID NOT NULL,
  commit_seq   INT  NOT NULL,
  commit_sha   TEXT NOT NULL,
  fingerprint  TEXT,
  PRIMARY KEY (doc_id, commit_seq)
);

CREATE INDEX IF NOT EXISTS atlas_doc_versions_seq ON atlas_doc_versions(commit_seq);
