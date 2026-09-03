// The e2e readiness gate's status rule is a claim about deriveFreshnessStatus:
// blocking on "stuck" alone is equivalent to the previous ok/stale/syncing
// allowlist across every state that function can actually emit. This is the
// one test allowed to see both sides — a server-test import of e2e/health.ts.
import { describe, expect, it } from "bun:test";
import { deriveFreshnessStatus, type FreshnessInput } from "./freshness.ts";
import { readinessProblems, type HealthSnapshot } from "../../../e2e/health.ts";

const REQUIRED = "008_preview_trust.sql";
const COMMIT = "abcdef123456";
const STALE = 48 * 3600;
const STUCK = 30 * 60;

// The eight boolean axes of deriveFreshnessStatus. 2^8 = 256 states; every
// other input is a threshold or a string whose only load-bearing property is
// which side of a comparison it sits on.
const AXES = [
  "dbUnreachable",
  "schemaBehind",
  "staleHeartbeat",
  "shasDiverged",
  "needsStoreHydrate",
  "updaterDead",
  "divergedPastStuck",
  "pendingPublishPastStuck",
] as const;

function inputFor(bits: number): FreshnessInput {
  const flag = (i: number) => Boolean(bits & (1 << i));
  const shasDiverged = flag(3);
  return {
    liveSha: shasDiverged ? "old" : "abc",
    dbSha: "abc",
    ageSeconds: flag(2) ? STALE + 1 : 60,
    divergedAgeSeconds: flag(6) ? STUCK + 1 : 30,
    schemaVersion: flag(1) ? "005_doc_content.sql" : REQUIRED,
    dbReachable: !flag(0),
    requiredSchema: REQUIRED,
    staleSeconds: STALE,
    stuckSeconds: STUCK,
    pendingPublishAgeSeconds: flag(7) ? STUCK + 1 : 10,
    updaterAlive: !flag(5),
    needsStoreHydrate: flag(4),
  };
}

function snapshotFor(input: FreshnessInput, status: string): HealthSnapshot {
  return {
    status,
    atlas_sha: input.liveSha,
    db_sha: input.dbSha,
    schema: input.schemaVersion,
    required_schema: input.requiredSchema,
    db_reachable: input.dbReachable,
    docs: 11_340,
    app_commit: COMMIT,
  };
}

// Frozen copy of the pre-blocklist status rule: accept ok, stale, and syncing
// when the shas already agree; block on everything else. Structural checks
// are the same function either way, so a disagreement here is a disagreement
// on whether the suite may start.
function previousAllowlistWouldBlock(health: HealthSnapshot): boolean {
  const structural = readinessProblems({ ...health, status: "ok" }, COMMIT);
  const status = health.status;
  if (status === "ok" || status === "stale") return structural.length > 0;
  const shasAgree = Boolean(health.atlas_sha && health.db_sha && health.atlas_sha === health.db_sha);
  if (status === "syncing" && shasAgree) return structural.length > 0;
  return true;
}

describe("e2e readiness status rule vs deriveFreshnessStatus", () => {
  it("the stuck-blocklist agrees with the previous allowlist on all 256 reachable states", () => {
    const seen = new Set<string>();
    const disagreements: string[] = [];
    for (let bits = 0; bits < 256; bits++) {
      const input = inputFor(bits);
      const status = deriveFreshnessStatus(input);
      seen.add(status);
      const health = snapshotFor(input, status);
      const nowBlocks = readinessProblems(health, COMMIT).length > 0;
      const thenBlocks = previousAllowlistWouldBlock(health);
      if (nowBlocks !== thenBlocks) {
        const axes = AXES.filter((_, i) => bits & (1 << i)).join(",") || "(none)";
        disagreements.push(`bits=${bits} [${axes}] status=${status} now=${nowBlocks} then=${thenBlocks}`);
      }
    }
    expect(disagreements).toEqual([]);
    expect(seen).toEqual(new Set(["ok", "syncing", "stuck", "stale", "schema_behind", "degraded"]));
  });
});
