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
  // "stale" is worker-heartbeat age (`synced_at` vs ATLAS_STALE_SECONDS), not a
  // bad snapshot. /api/health stays 200 so a stale tick never restart-loops a
  // live container; waiting cannot make an old heartbeat fresh. Accept it when
  // the structural fields above already passed.
  //
  // "syncing" with the two shas AGREEING is the same shape of non-problem. With
  // liveSha === dbSha the only remaining path to that status is
  // needsStoreHydrate (freshness.ts): this container has not yet pulled the
  // published bundle out of atlas_artifacts. That is true of EVERY cold boot —
  // storeHydratedSha starts null and is set only by the updater's first
  // successful hydrate, whose first tick is scheduled a whole interval (30s)
  // after boot and then backs off 30s → 60s → 120s → … per refusal, so a
  // container that loses the race with the worker's publish is parked well past
  // this gate's 120s budget. Nothing the suite exercises is affected: the shas
  // match, the index is fully loaded, and /api/atlas/:sha/:name hydrates its
  // bundle from the store on demand (atlas-static.ts). Waiting here only waits
  // on the updater's own bookkeeping, and the timeout is a false red.
  //
  // "syncing" with the shas DIVERGED is a genuine wait — the app is serving an
  // older atlas than the database — and stays blocking; the sha comparison
  // above reports that case in its own right. Still wait/fail on stuck,
  // schema_behind, degraded, or an unknown status.
  const status = health.status ?? "";
  const shasAgree = Boolean(health.atlas_sha && health.db_sha && health.atlas_sha === health.db_sha);
  if (status !== "ok" && status !== "stale" && !(status === "syncing" && shasAgree)) {
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
