-- Pre-git origin events (plan docs/plans/pre-git-history.md): 'added'-shaped rows with
-- era IN ('mip', 'genesis', 'severed') need somewhere to point at their external source —
-- the mips-repo section on GitHub, or the genesis IPFS gateway snapshot. The human-facing
-- label itself reuses the existing `summary` column (e.g. "Proposed in MIP104 §14.3",
-- "Present at Atlas v2 genesis"); this is the one new field, the link target.
--   source_url — external reference for a reconstructed pre-git event. NULL for every
--                git-derived era (html, markdown); populated only for mip/genesis rows.
-- Nullable + ADDITIVE: existing rows and the existing upsert path are unaffected.
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS source_url TEXT;
