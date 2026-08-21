import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The guard is a self-contained CLI (env in, exit code out), so these tests
// run it for real with fixture Playwright JSON reports and assert the streak
// file + exit code — locking the behavior the scheduled workflow relies on.

const SCRIPT = path.join(__dirname, "check-canary-skips.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canary-skips-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function report(status: string, file = "e2e/preview.spec.ts"): string {
  const p = path.join(dir, `report-${status}-${path.basename(file)}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({
      suites: [
        {
          file,
          specs: [
            {
              title: "previews an atlas PR canary",
              tests: [{ status, annotations: status === "skipped" ? [{ type: "skip", description: "no eligible PR" }] : [] }],
            },
          ],
        },
      ],
    }),
  );
  return p;
}

function run(env: Record<string, string>): { code: number; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

describe("check-canary-skips", () => {
  const streak = path.join(dir, "streak/counter");

  it("increments the streak and warns on a scheduled skip", () => {
    const r = run({ REPORT_FILE: report("skipped"), STREAK_FILE: streak, EVENT_NAME: "schedule" });
    expect(r.code).toBe(0);
    expect(fs.readFileSync(streak, "utf8").trim()).toBe("1");
    expect(r.out).toContain("::warning::");
    expect(r.out).toContain("no eligible PR");
  });

  it("does not increment on a dispatch skip", () => {
    const r = run({ REPORT_FILE: report("skipped"), STREAK_FILE: streak, EVENT_NAME: "workflow_dispatch" });
    expect(r.code).toBe(0);
    expect(fs.readFileSync(streak, "utf8").trim()).toBe("1");
  });

  it("fails the run once the scheduled streak reaches MAX_STREAK", () => {
    fs.writeFileSync(streak, "5\n");
    const r = run({ REPORT_FILE: report("skipped"), STREAK_FILE: streak, EVENT_NAME: "schedule", MAX_STREAK: "6" });
    expect(r.code).toBe(1);
    expect(fs.readFileSync(streak, "utf8").trim()).toBe("6");
    expect(r.out).toContain("::error::");
  });

  it("resets the streak on any execution — a failed run still proves the canary ran", () => {
    for (const status of ["expected", "unexpected"]) {
      fs.writeFileSync(streak, "6\n");
      const r = run({ REPORT_FILE: report(status), STREAK_FILE: streak, EVENT_NAME: "schedule" });
      expect(r.code).toBe(0);
      expect(fs.readFileSync(streak, "utf8").trim()).toBe("0");
    }
  });

  it("fails loudly on a missing report or a report without the preview spec", () => {
    expect(run({ REPORT_FILE: path.join(dir, "nope.json"), STREAK_FILE: streak, EVENT_NAME: "schedule" }).code).toBe(1);
    const r = run({ REPORT_FILE: report("skipped", "e2e/history.spec.ts"), STREAK_FILE: streak, EVENT_NAME: "schedule" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("no preview.spec.ts test");
  });
});
