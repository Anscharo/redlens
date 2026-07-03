// The editorial description of a commit's change, for the HTML-era curation LLM. Each atlas commit
// is a PR; the PR title + its linked "Atlas Edit Weekly Cycle Proposal" forum thread spell out the
// specific edits ("Update Sky Direct Exposures — …", "Add Public Dashboard Requirement — …"). That
// human intent is a strong threading signal: an "Update X" is a continuation of X, an "Add Y" is a
// birth. Read-through DISK cache so a re-run never re-fetches; any network/gh failure degrades to
// null (curation still works, just without this context). OFFLINE curation tooling only — this
// feeds the queue/prompt, never the deterministic shipped artifact.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const stripHtml = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

function ghPr(pr, repo) {
  try {
    const out = execFileSync("gh", ["pr", "view", String(pr), "--repo", repo, "--json", "title,body"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });
    return JSON.parse(out);
  } catch { return null; }
}

// Discourse exposes any topic as JSON at `<url>.json`; the first post's `cooked` HTML is the proposal.
function forumThread(url) {
  try {
    const jsonUrl = url.replace(/[#?].*$/, "").replace(/\/$/, "") + ".json";
    const out = execFileSync("curl", ["-sL", "--max-time", "20", jsonUrl], { encoding: "utf8", maxBuffer: 1 << 24 });
    return stripHtml(JSON.parse(out).post_stream?.posts?.[0]?.cooked || "") || null;
  } catch { return null; }
}

// Returns { pr, title, summary } (summary = the forum edit-list when linked, else the PR body),
// or null when there's no PR / the fetch failed. Cached by PR number under `cacheDir`.
export function fetchPrContext(pr, repo, cacheDir) {
  if (!pr) return null;
  const cacheFile = path.join(cacheDir, `${pr}.json`);
  if (fs.existsSync(cacheFile)) { try { return JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { /* refetch */ } }
  const meta = ghPr(pr, repo);
  if (!meta) return null;
  const forumUrl = (meta.body || "").match(/https:\/\/forum\.sky\.money\/t\/[^\s)"']+/)?.[0];
  const summary = (forumUrl && forumThread(forumUrl)) || stripHtml(meta.body) || "";
  const ctx = { pr, title: meta.title || "", summary };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(ctx, null, 1));
  return ctx;
}
