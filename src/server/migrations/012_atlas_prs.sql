-- Normalize PR header/review metadata out of atlas_history without changing
-- history output. atlas_history keeps its legacy PR columns during the
-- transition; readers prefer those columns and only fall back to atlas_prs when
-- a legacy field is null. A later contract migration can drop the duplicates
-- after dual-write + backfill have been verified in production.
CREATE TABLE IF NOT EXISTS atlas_prs (
  pr_number      INT PRIMARY KEY,
  title          TEXT,
  url            TEXT,
  author         TEXT,
  review_count   INT,
  approval_count INT,
  comment_count  INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO atlas_prs (
  pr_number,
  title,
  url,
  author,
  review_count,
  approval_count,
  comment_count
)
SELECT
  pr_number,
  MAX(pr_title) FILTER (WHERE pr_title IS NOT NULL),
  MAX(pr_url) FILTER (WHERE pr_url IS NOT NULL),
  MAX(pr_author) FILTER (WHERE pr_author IS NOT NULL),
  MAX(review_count) FILTER (WHERE review_count IS NOT NULL),
  MAX(approval_count) FILTER (WHERE approval_count IS NOT NULL),
  MAX(comment_count) FILTER (WHERE comment_count IS NOT NULL)
FROM atlas_history
WHERE pr_number IS NOT NULL
GROUP BY pr_number
ON CONFLICT (pr_number) DO UPDATE SET
  title = COALESCE(EXCLUDED.title, atlas_prs.title),
  url = COALESCE(EXCLUDED.url, atlas_prs.url),
  author = COALESCE(EXCLUDED.author, atlas_prs.author),
  review_count = COALESCE(EXCLUDED.review_count, atlas_prs.review_count),
  approval_count = COALESCE(EXCLUDED.approval_count, atlas_prs.approval_count),
  comment_count = COALESCE(EXCLUDED.comment_count, atlas_prs.comment_count),
  updated_at = now();

CREATE OR REPLACE VIEW atlas_pr_metadata_conflicts AS
SELECT
  pr_number,
  COUNT(DISTINCT pr_title) FILTER (WHERE pr_title IS NOT NULL) AS title_variants,
  COUNT(DISTINCT pr_url) FILTER (WHERE pr_url IS NOT NULL) AS url_variants,
  COUNT(DISTINCT pr_author) FILTER (WHERE pr_author IS NOT NULL) AS author_variants,
  COUNT(DISTINCT review_count) FILTER (WHERE review_count IS NOT NULL) AS review_count_variants,
  COUNT(DISTINCT approval_count) FILTER (WHERE approval_count IS NOT NULL) AS approval_count_variants,
  COUNT(DISTINCT comment_count) FILTER (WHERE comment_count IS NOT NULL) AS comment_count_variants
FROM atlas_history
WHERE pr_number IS NOT NULL
GROUP BY pr_number
HAVING COUNT(DISTINCT pr_title) FILTER (WHERE pr_title IS NOT NULL) > 1
    OR COUNT(DISTINCT pr_url) FILTER (WHERE pr_url IS NOT NULL) > 1
    OR COUNT(DISTINCT pr_author) FILTER (WHERE pr_author IS NOT NULL) > 1
    OR COUNT(DISTINCT review_count) FILTER (WHERE review_count IS NOT NULL) > 1
    OR COUNT(DISTINCT approval_count) FILTER (WHERE approval_count IS NOT NULL) > 1
    OR COUNT(DISTINCT comment_count) FILTER (WHERE comment_count IS NOT NULL) > 1;
