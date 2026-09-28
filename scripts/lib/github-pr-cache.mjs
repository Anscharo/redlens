// Read-through disk cache of next-gen-atlas pull-request metadata: one record
// per PR at .cache/github-prs/<number>.json. Every atlas commit is a PR, so the
// PR title/body/author and its review counts are the editorial description of
// that commit — history rows carry them, and the HTML-era curation tooling
// threads documents with them.
//
// The records are COMMITTED, because the two readers that need them cannot
// always fetch: `pnpm dev`'s preflight runs build:history on a machine that may
// be offline, and the canary job runs it with no atlas PR access at all. A
// missing record is not fatal anywhere — it degrades to a history row without
// PR metadata — so the cache is filled by whoever has `gh` and a token, and the
// hourly atlas bump (.github/workflows/atlas-update.yml) commits what it fetched.
//
// The committed records serve local dev and CI only. .dockerignore keeps all of
// .cache out of the images except .cache/etherscan, so the Railway worker fetches
// its own records with its own GITHUB_TOKEN on every cycle.
//
// The record shape is shared with scripts/htmlhist/atlas-pr-context.mjs, which
// adds one field (`summary`, the linked forum edit-list) and backfills it in
// place on first read. Write the eight fields below and nothing else.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PR_CACHE_DIR = path.join(ROOT, ".cache/github-prs");
export const ATLAS_REPO_SLUG = "sky-ecosystem/next-gen-atlas";

/** The PR number an atlas commit subject ends with, e.g. "… (#294)" → 294. */
export function extractPrNumber(message) {
  const m = message.match(/\(#(\d+)\)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

/** The cached record for one PR, fetching it once when absent. Returns null
 *  when the fetch fails, so a caller without `gh` still completes. */
export async function fetchPr(prNum) {
  const cacheFile = path.join(PR_CACHE_DIR, `${prNum}.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }

  console.error(`  fetching PR #${prNum}…`);
  try {
    const raw = execSync(
      `gh pr view ${prNum} --repo ${ATLAS_REPO_SLUG} --json title,body,author,comments,reviews,url`,
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
    const pr = JSON.parse(raw);
    const data = {
      number: prNum,
      title: pr.title,
      body: pr.body ?? "",
      author: pr.author?.login ?? null,
      url: pr.url,
      commentCount: pr.comments?.length ?? 0,
      reviewCount: pr.reviews?.length ?? 0,
      approvalCount: (pr.reviews ?? []).filter((r) => r.state === "APPROVED").length,
    };
    fs.mkdirSync(PR_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    return data;
  } catch (e) {
    console.error(`  warning: could not fetch PR #${prNum}: ${e.message}`);
    return null;
  }
}
