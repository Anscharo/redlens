-- Fork-preview trust + takedown levers.
-- blocked_at: admin takedown — a blocked sha resolves as not-found and its
--   bundle is evicted on next access. Takedown = UPDATE previews SET blocked_at = now() WHERE sha = '…'.
-- trust_tier: computed fork-owner trust at build time ('trusted'|'known'|'unknown');
--   NULL for canonical/PR previews. Drives the tiered daily-quota pools.
ALTER TABLE previews ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS trust_tier TEXT;
