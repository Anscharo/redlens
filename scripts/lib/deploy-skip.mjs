// Decide whether a PR's changed paths should trigger a Railway deploy / E2E.
//
// Markdown is skipped unless the Vite/Bun app actually bundles it (`?raw`
// import). Skills, CLAUDE.md, plans, and the rest of docs/ do not ship in the
// image, so a skills-only PR must not spin up a PR environment (or wait on
// Playwright against it). Non-markdown paths always deploy.

/** Repo-relative markdown files imported with `?raw` under src/ (excluding tests). */
export const APP_READ_MARKDOWN = Object.freeze([
  "PRIVACY.md",
  "docs/crossview/concepts-audit.md",
  "docs/crossview/concepts.md",
  "docs/risk-assessment-rubric.md",
  "patch-notes.md",
]);

export function normalizeRepoPath(file) {
  return String(file)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

export function isMarkdownPath(file) {
  return normalizeRepoPath(file).toLowerCase().endsWith(".md");
}

export function isAppReadMarkdown(file) {
  return APP_READ_MARKDOWN.includes(normalizeRepoPath(file));
}

/** True when this changed path should trigger a Railway deploy / E2E. */
export function isDeployRelevant(file) {
  const norm = normalizeRepoPath(file);
  if (isMarkdownPath(norm)) return isAppReadMarkdown(norm);
  return true;
}

/**
 * Skip Railway/E2E when every changed path is non-app markdown.
 * An empty list is NOT a skip — unknown file sets must still deploy.
 */
export function shouldSkipDeploy(files) {
  if (!Array.isArray(files) || files.length === 0) return false;
  return files.every((f) => !isDeployRelevant(f));
}

/**
 * Railway `environment` values look like:
 *   "Redline Atlas / redlens-pr-292"    (service-name-pr-N — current)
 *   "Redline Atlas / pr-85d143-128"     (random slug + PR number — older)
 *   "redlens-pr-292"
 */
export function prNumberFromRailwayEnv(envName) {
  const slug = String(envName).split("/").pop()?.trim() ?? "";
  const m = /pr-(?:[a-f0-9]+-)?(\d+)$/i.exec(slug);
  return m ? Number(m[1]) : null;
}

/** gitignore-style watchPatterns: everything except markdown, plus app-read md. */
export function railwayWebWatchPatterns() {
  return ["**", "!**/*.md", ...APP_READ_MARKDOWN];
}

/**
 * Worker image bundles no markdown, and nothing under apps/web — it runs the
 * atlas pipeline and syncs Postgres; there is no browser bundle in it. Its one
 * stake in that package is the manifest, which the workspace install needs to
 * resolve the lockfile, so that single file is re-included.
 *
 * A dependency change cannot sneak past this: it moves pnpm-lock.yaml too, and
 * the lockfile is matched by `**`.
 */
export function railwayWorkerWatchPatterns() {
  return ["**", "!**/*.md", "!apps/web/**", "apps/web/package.json"];
}
