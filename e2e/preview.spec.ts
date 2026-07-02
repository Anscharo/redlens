import { test, expect, type APIRequestContext } from "@playwright/test";

// Atlas-preview redline canary, validated against a pinned REAL PR. This is
// intentionally opt-in: open atlas PRs move/close constantly, so normal PR-gate
// e2e should not pick live external state at runtime. To run it, provide both:
//   ATLAS_PREVIEW_CANARY_PR=<number>
//   ATLAS_PREVIEW_CANARY_SHA=<current head sha>
// The test skips cleanly if the canary moved, closed, or no longer edits docs.

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
  headSha: string;
  docs: { id: string; status: "added" | "modified" }[];
}

async function loadPinnedDocPr(
  request: APIRequestContext,
  number: number,
  expectedSha: string,
): Promise<{ candidate: Candidate | null; reason?: string }> {
  const prRes = await request.get(`${GH}/repos/${CANONICAL}/pulls/${number}`, { headers: ghHeaders() });
  if (!prRes.ok()) return { candidate: null, reason: `could not load atlas PR #${number}` };

  const pr = (await prRes.json()) as {
    state: string;
    head: { sha: string; repo: { full_name: string } | null };
  };
  if (pr.state !== "open") return { candidate: null, reason: `atlas PR #${number} is ${pr.state}` };
  if (pr.head?.sha !== expectedSha) {
    return { candidate: null, reason: `atlas PR #${number} moved from ${expectedSha} to ${pr.head?.sha}` };
  }
  const headRepo = pr.head?.repo?.full_name;
  if (headRepo !== CANONICAL) {
    return { candidate: null, reason: `atlas PR #${number} is from ${headRepo ?? "unknown fork"}` };
  }

  const filesRes = await request.get(`${GH}/repos/${CANONICAL}/pulls/${number}/files?per_page=100`, {
    headers: ghHeaders(),
  });
  if (!filesRes.ok()) return { candidate: null, reason: `could not load files for atlas PR #${number}` };
  const files = (await filesRes.json()) as Array<{ filename: string; status: string }>;
  const docFiles = files.filter((f) => DOC_RE.test(f.filename) && (f.status === "added" || f.status === "modified"));
  if (!docFiles.length) return { candidate: null, reason: `atlas PR #${number} no longer modifies content docs` };

  const docs: Candidate["docs"] = [];
  for (const f of docFiles.slice(0, 10)) {
    const raw = await request.get(`https://raw.githubusercontent.com/${headRepo}/${expectedSha}/${f.filename}`);
    if (!raw.ok()) continue;
    const m = (await raw.text()).match(UUID_RE);
    if (m) docs.push({ id: m[1].toLowerCase(), status: f.status as "added" | "modified" });
  }
  if (!docs.length) return { candidate: null, reason: `atlas PR #${number} docs had no node ids` };

  return { candidate: { number, headSha: expectedSha, docs } };
}

async function currentHeadSha(request: APIRequestContext, number: number): Promise<string | null> {
  const res = await request.get(`${GH}/repos/${CANONICAL}/pulls/${number}`, { headers: ghHeaders() });
  if (!res.ok()) return null;
  const pr = (await res.json()) as { head: { sha: string } };
  return pr.head?.sha ?? null;
}

test("previews the pinned atlas PR canary and redlines exactly the docs it changed", async ({ page, request }) => {
  test.setTimeout(BUILD_TIMEOUT + 60_000);

  const canaryPr = Number(process.env.ATLAS_PREVIEW_CANARY_PR ?? "");
  const canarySha = process.env.ATLAS_PREVIEW_CANARY_SHA;
  test.skip(!canaryPr || !canarySha, "set ATLAS_PREVIEW_CANARY_PR and ATLAS_PREVIEW_CANARY_SHA to run preview canary");

  const { candidate, reason } = await loadPinnedDocPr(request, canaryPr, canarySha!);
  test.skip(!candidate, reason ?? "preview canary is not currently runnable");
  const { number, headSha, docs } = candidate!;
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

  const headAfterBuild = await currentHeadSha(request, number);
  test.skip(headAfterBuild !== headSha, `atlas PR #${number} moved during preview build`);

  const marked = new Set<string>([
    ...(diff.added ?? []),
    ...(diff.changed ?? []),
    ...Object.keys(diff.renumbered ?? {}),
  ]);

  // Every doc the PR added/modified must appear in our computed diff.
  const missing = expectedIds.filter((id) => !marked.has(id));
  expect(missing, `PR #${number} at ${headSha}: these changed docs were missing from the preview diff`).toEqual([]);

  // And the render path actually marks one of them in the reader.
  await page.goto(`/preview/pull-${number}/atlas?id=${expectedIds[0]}`);
  await expect(page.locator('[aria-label$="in this preview"]').first()).toBeVisible({ timeout: 60_000 });
});
