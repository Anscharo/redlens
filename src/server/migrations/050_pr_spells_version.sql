-- Which parser read each PR's spell_refs (src/lib/atlasPrSpell.ts
-- SPELL_REFS_VERSION): the pr-spells step reads a PR again whenever the parser
-- reads PRs differently, keeping the old answer until then. NULL = read before
-- the version was recorded.
ALTER TABLE atlas_prs ADD COLUMN IF NOT EXISTS spell_refs_version INT;

-- The atlas commit the pr-spells step last gave history rows their PR numbers
-- at: it reads the git log again only after the atlas moved.
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS pr_backfill_sha TEXT;
