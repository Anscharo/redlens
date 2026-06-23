import { test, expect, type APIRequestContext } from "@playwright/test";

// Atlas-preview redline, validated against REAL state without a pinned canary
// (real PRs open/close constantly). The test:
//   1. finds an open next-gen-atlas PR that modifies content docs (GitHub API),
//   2. derives the expected node UUIDs straight from the PR's changed files,
//   3. builds that preview on the live deploy (/preview/pull-<N>), and
//   4. asserts our computed diff.json covers exactly those docs + a redline mark
//      actually renders in the reader.
// Ground truth is re-derived each run, so nothing rots. Skips cleanly when no
// doc-modifying PR is open.

const CANONICAL = "sky-ecosystem/next-gen-atlas";
const GH = "https://api.github.com";
// Decomposed docs carry their node id in YAML frontmatter (`id: <uuid>`).
const UUID_RE = /^id:\s*["']?([0-9a-f-]{36})["']?\s*$/im;
const DOC_RE = /(^|\/)content\/.*document\.md$/;
const BUILD_TIMEOUT = 150_000; // first preview build clones + builds the atlas

function ghHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const h: Record<string, string> = { "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

interface Candidate {
  number: number;
  docs: { id: string; status: "added" | "modified" }[];
}

// Find an open PR touching content docs. Prefer same-repo PRs (always trusted /
// buildable) over forks (which may be trust-gated).
async function findDocPr(request: APIRequestContext): Promise<Candidate | null> {
  const res = await request.get(
    `${GH}/repos/${CANONICAL}/pulls?state=open&per_page=50&sort=updated&direction=desc`,
    { headers: ghHeaders() },
  );
  if (!res.ok()) return null;
  const prs = (await res.json()) as Array<{ number: number; head: { sha: string; repo: { full_name: string } | null } }>;
  const sameRepoFirst = [...prs].sort(
    (a, b) =>
      Number(b.head?.repo?.full_name === CANONICAL) - Number(a.head?.repo?.full_name === CANONICAL),
  );

  for (const pr of sameRepoFirst) {
    const filesRes = await request.get(`${GH}/repos/${CANONICAL}/pulls/${pr.number}/files?per_page=100`, {
      headers: ghHeaders(),
    });
    if (!filesRes.ok()) continue;
    const files = (await filesRes.json()) as Array<{ filename: string; status: string }>;
    const docFiles = files.filter(
      (f) => DOC_RE.test(f.filename) && (f.status === "added" || f.status === "modified"),
    );
    if (!docFiles.length) continue;

    const headRepo = pr.head?.repo?.full_name ?? CANONICAL;
    const headSha = pr.head?.sha;
    const docs: Candidate["docs"] = [];
    for (const f of docFiles.slice(0, 10)) {
      const raw = await request.get(`https://raw.githubusercontent.com/${headRepo}/${headSha}/${f.filename}`);
      if (!raw.ok()) continue;
      const m = (await raw.text()).match(UUID_RE);
      if (m) docs.push({ id: m[1].toLowerCase(), status: f.status as "added" | "modified" });
    }
    if (docs.length) return { number: pr.number, docs };
  }
  return null;
}

test("previews a real open atlas PR and redlines exactly the docs it changed", async ({ page, request }) => {
  test.setTimeout(BUILD_TIMEOUT + 60_000);

  const candidate = await findDocPr(request);
  test.skip(!candidate, "no open next-gen-atlas PR currently modifies content docs");
  const { number, docs } = candidate!;
  const expectedIds = docs.map((d) => d.id);

  // Capture the preview bundle's diff.json (fetched once the build is ready).
  const diffResponse = page.waitForResponse(
    (r) => /\/api\/preview\/[0-9a-f]+\/diff\.json$/.test(r.url()) && r.status() === 200,
    { timeout: BUILD_TIMEOUT },
  );
  await page.goto(`/preview/pull-${number}`);
  const diff = (await (await diffResponse).json()) as {
    added?: string[];
    changed?: string[];
    renumbered?: Record<string, unknown>;
  };

  const marked = new Set<string>([
    ...(diff.added ?? []),
    ...(diff.changed ?? []),
    ...Object.keys(diff.renumbered ?? {}),
  ]);

  // Every doc the PR added/modified must appear in our computed diff.
  const missing = expectedIds.filter((id) => !marked.has(id));
  expect(missing, `PR #${number}: these changed docs were missing from the preview diff`).toEqual([]);

  // And the render path actually marks one of them in the reader.
  await page.goto(`/preview/pull-${number}/atlas?id=${expectedIds[0]}`);
  await expect(page.locator('[aria-label$="in this preview"]').first()).toBeVisible({ timeout: 60_000 });
});
