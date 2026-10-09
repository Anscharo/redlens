-- Set once the PR-environment worker has copied the development database's PAU
-- and on-chain tables (src/server/pr-env/copy.ts), so the copy runs once per
-- environment. Empty everywhere else.
CREATE TABLE IF NOT EXISTS pr_env_copy_state (
  id         INT PRIMARY KEY CHECK (id = 1),
  copied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
