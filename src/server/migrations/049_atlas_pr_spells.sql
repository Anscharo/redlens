-- The spells an atlas pull request names in its title, or in a body that is not
-- a list of edits (src/lib/atlasPrSpell.ts `prSpellRefs`): a JSON array of
-- "YYYY-MM-DD", "--MM-DD" where the PR wrote no year, and "thread:YYYY-MM-DD"
-- for a linked upcoming-spell forum thread (the thread's date, never the PR's
-- spell). NULL = the PR record
-- has not been read yet; [] = read, it names no spell. The worker's pr-spells
-- tick step fills it (src/server/history/pr-spells.ts); the history API joins it
-- onto each change the PR made.
ALTER TABLE atlas_prs ADD COLUMN IF NOT EXISTS spell_refs JSONB;
