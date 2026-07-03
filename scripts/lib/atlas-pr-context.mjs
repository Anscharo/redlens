// The editorial description of a commit's change, for the HTML-era curation LLM. Each atlas commit
// is a PR; the PR title + its linked "Atlas Edit Weekly Cycle Proposal" forum thread spell out the
// specific edits ("Update Sky Direct Exposures — …", "Add Public Dashboard Requirement — …"). That
// human intent is a strong threading signal: an "Update X" is a continuation of X, an "Add Y" is a
// birth. OFFLINE curation tooling only — this feeds the queue/prompt, never the shipped artifact.
//
// Shares ONE cache with the modern history builder (scripts/required/build-history.mjs):
// `.cache/github-prs/<number>.json`, a single committed record shape used pre- and post-markdown —
//   { number, title, body, author, url, commentCount, reviewCount, approvalCount, summary? }
// The html-era curation additionally needs `summary` (the linked forum edit-list, else the stripped
// PR body). build-history writes records without it; we backfill `summary` in place on first read.
// Read-through DISK cache so a re-run never re-fetches; any network/gh failure degrades to null.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const prUrl = (pr) => `https://github.com/sky-ecosystem/next-gen-atlas/pull/${pr}`;
const stripHtml = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

function ghPr(pr, repo) {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", String(pr), "--repo", repo, "--json", "title,body,author,comments,reviews,url"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 },
    );
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

// The forum edit-list when the body links a thread, else the stripped PR body.
function deriveSummary(body) {
  const forumUrl = (body || "").match(/https:\/\/forum\.sky\.money\/t\/[^\s)"']+/)?.[0];
  return (forumUrl && forumThread(forumUrl)) || stripHtml(body) || "";
}

// Returns the unified PR record { number, title, body, author, url, …counts, summary }, or null when
// there's no PR / the fetch failed. Cached by PR number under `cacheDir` (.cache/github-prs). A record
// build-history cached without `summary` is backfilled in place on first read here.
export function fetchPrContext(pr, repo, cacheDir) {
  if (!pr) return null;
  const cacheFile = path.join(cacheDir, `${pr}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const rec = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (rec.summary === undefined) {
        rec.summary = deriveSummary(rec.body);
        fs.writeFileSync(cacheFile, JSON.stringify(rec, null, 2));
      }
      return rec;
    } catch { /* fall through to refetch */ }
  }
  const meta = ghPr(pr, repo);
  if (!meta) return null;
  const rec = {
    number: pr,
    title: meta.title || "",
    body: meta.body ?? "",
    author: meta.author?.login ?? null,
    url: meta.url || prUrl(pr),
    commentCount: meta.comments?.length ?? 0,
    reviewCount: meta.reviews?.length ?? 0,
    approvalCount: (meta.reviews ?? []).filter((r) => r.state === "APPROVED").length,
    summary: deriveSummary(meta.body),
  };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(rec, null, 2));
  return rec;
}
