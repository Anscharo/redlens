-- A collection's generated group name and one-line summary. `summary_hash` is
-- the hash of the doc ids (and prompt version) they were written for, so a
-- collection whose docs change is simply regenerated on its next read.
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS summary_label TEXT,
  ADD COLUMN IF NOT EXISTS summary_text  TEXT,
  ADD COLUMN IF NOT EXISTS summary_hash  TEXT;
