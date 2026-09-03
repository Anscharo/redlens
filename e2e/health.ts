export interface HealthSnapshot {
  status?: string;
  atlas_sha?: string | null;
  db_sha?: string | null;
  schema?: string | null;
  required_schema?: string | null;
  db_reachable?: boolean;
  docs?: number;
  app_commit?: string | null;
  [key: string]: unknown;
}

interface WaitOptions {
  baseUrl: string;
  expectedCommit?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
}

function commitsMatch(actual: string, expected: string): boolean {
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  return a === e || a.startsWith(e) || e.startsWith(a);
}

export function readinessProblems(health: HealthSnapshot, expectedCommit?: string): string[] {
  const problems: string[] = [];
  if (health.db_reachable !== true) problems.push("Postgres is not reachable");
  if (!health.atlas_sha) problems.push("live Atlas SHA is missing");
  if (!health.db_sha) problems.push("database Atlas SHA is missing");
  if (health.atlas_sha && health.db_sha && health.atlas_sha !== health.db_sha) {
    problems.push(`live Atlas SHA ${health.atlas_sha} does not match database SHA ${health.db_sha}`);
  }
  if (!Number.isFinite(health.docs) || Number(health.docs) <= 0) {
    problems.push(`document index is empty (${String(health.docs)})`);
  }
  if (health.schema && health.required_schema && health.schema < health.required_schema) {
    problems.push(`schema ${health.schema} is behind required ${health.required_schema}`);
  }
  // Of the six statuses freshness.ts can derive, only ONE tells this gate
  // anything the structural checks above have not already established:
  //
  //   degraded / schema_behind  db_reachable and schema already reported it,
  //                             with a message that names the actual fault.
  //   syncing (shas diverged)   the sha comparison already reported it.
  //   syncing (shas agree)      needsStoreHydrate — this container has not yet
  //                             pulled the published bundle out of
  //                             atlas_artifacts. True of EVERY cold boot: the
  //                             updater's first tick is a whole interval (30s)
  //                             after boot and backs off per refusal, so a
  //                             container that loses the race with the worker's
  //                             publish is parked past this gate's 120s budget.
  //                             Nothing the suite exercises depends on it —
  //                             /api/atlas/:sha/:name hydrates on demand.
  //   stale                     worker-heartbeat age, not a bad snapshot;
  //                             waiting cannot make an old heartbeat fresh.
  //   stuck                     the updater has failed to converge — an
  //                             un-hydratable store or a publish that never
  //                             landed. Invisible to every check above, and the
  //                             signal that caught the getArtifacts/jsonb fault
  //                             in #350. This is the one worth waiting on.
  //
  // So: block on stuck, accept the rest. Deliberately a blocklist, not an
  // allowlist of good statuses. An allowlist fails CLOSED on any status it did
  // not anticipate, which is exactly how a healthy deployment started reporting
  // a two-minute red the day needsStoreHydrate landed (5 of 8 E2E gate failures
  // between 2026-08-28 and 09-02). And the downside is bounded: this gate only
  // decides whether to START the suite — every spec still has to pass — so a
  // status this rule waves through costs a worse error message, never a missed
  // regression.
  //
  // Verified equivalent to the previous ok/stale/syncing allowlist across all
  // 256 states deriveFreshnessStatus can reach; see the status-rule test below.
  if ((health.status ?? "") === "stuck") {
    problems.push(`freshness status is ${String(health.status)}`);
  }
  if (expectedCommit) {
    if (!health.app_commit) {
      problems.push(`application commit is missing; expected ${expectedCommit}`);
    } else if (!commitsMatch(health.app_commit, expectedCommit)) {
      problems.push(`application commit ${health.app_commit} does not match expected ${expectedCommit}`);
    }
  }
  return problems;
}

export async function waitForDeployment({
  baseUrl,
  expectedCommit,
  timeoutMs = 120_000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}: WaitOptions): Promise<HealthSnapshot> {
  const target = `${baseUrl.replace(/\/$/, "")}/api/health`;
  // A URL fetch() can't parse (e.g. a scheme-less BASE_URL) never becomes
  // valid by retrying — fail immediately with the actionable message instead
  // of burning the whole timeout on "request failed: Failed to parse URL".
  try {
    new URL(target);
  } catch {
    throw new Error(
      `health URL ${JSON.stringify(target)} is not a valid URL — BASE_URL needs a scheme, e.g. https://${baseUrl}`,
    );
  }
  const started = now();
  let attempt = 0;
  let lastDetail = "no response";

  while (now() - started < timeoutMs) {
    attempt++;
    try {
      const response = await fetchImpl(target, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      const text = await response.text();
      if (!response.ok) {
        lastDetail = `HTTP ${response.status}: ${text.slice(0, 500)}`;
      } else {
        let health: HealthSnapshot;
        try {
          health = JSON.parse(text) as HealthSnapshot;
        } catch {
          lastDetail = `invalid JSON: ${text.slice(0, 500)}`;
          health = {};
        }
        const problems = readinessProblems(health, expectedCommit);
        if (problems.length === 0) return health;
        lastDetail = `${problems.join("; ")}; body=${JSON.stringify(health)}`;
      }
    } catch (error) {
      lastDetail = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    const delay = Math.min(1_000 * 2 ** Math.min(attempt - 1, 3), 8_000);
    await sleep(delay);
  }

  throw new Error(
    `deployment did not become ready after ${attempt} attempt(s) in ${timeoutMs}ms: ${target}\n${lastDetail}`,
  );
}
