// The GitHub API reads behind the E2E gate (e2e-gate.mjs): the e2e.yml runs at
// a set of commits, and the PR's open/merged state.

/** One place to shape an API request, so auth can never be half-applied. */
function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "redlens-e2e-gate",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Every e2e.yml run at any of `shas`, as one list for classifyRuns. */
export async function fetchRuns({ apiBase, repo, workflow, shas, token }) {
  const perSha = await Promise.all(
    shas.map(async (sha) => {
      const url = `${apiBase}/repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`;
      const res = await fetch(url, { headers: githubHeaders(token) });
      if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`);
      const body = await res.json();
      return Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    }),
  );
  return perSha.flat();
}

/**
 * Current state of the PR, or null when it cannot be determined. A failed read
 * is deliberately indistinguishable from "still open": the PR check is an early
 * exit from the wait, never a reason to change the verdict, so an API blip must
 * leave the gate exactly as it was.
 */
export async function fetchPullRequest({ apiBase, repo, prNumber, token }) {
  if (!prNumber) return null;
  try {
    const res = await fetch(`${apiBase}/repos/${repo}/pulls/${prNumber}`, { headers: githubHeaders(token) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
