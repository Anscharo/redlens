import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyRuns, readChangedFiles } from "../scripts/aux/e2e-gate.mjs";

const done = (conclusion: string, html_url = "https://example.test/run") => ({
  status: "completed",
  conclusion,
  html_url,
});
const running = () => ({ status: "in_progress", conclusion: null });

describe("classifyRuns", () => {
  it("waits when Railway has not deployed the commit yet", () => {
    expect(classifyRuns([]).verdict).toBe("wait");
    expect(classifyRuns(undefined).verdict).toBe("wait");
  });

  it("passes on a successful run", () => {
    expect(classifyRuns([done("success")]).verdict).toBe("pass");
  });

  it("fails on a failed run once nothing is in flight", () => {
    const result = classifyRuns([done("failure")]);
    expect(result.verdict).toBe("fail");
    expect(result.runUrl).toBe("https://example.test/run");
    expect(classifyRuns([done("timed_out")]).verdict).toBe("fail");
    expect(classifyRuns([done("startup_failure")]).verdict).toBe("fail");
  });

  // Railway emits a deployment_status per service and per environment, so one
  // commit gets several runs. `skipped` is the job-level `if:` rejecting a
  // non-success / non-PR event; `cancelled` is same-sha concurrency. Neither
  // tested the app, so neither may settle the verdict. A delayed success for
  // an older SHA of the same PR env is a different workflow run (different
  // head_sha) — this classifier never sees it.
  it("keeps waiting through skipped and cancelled siblings", () => {
    expect(classifyRuns([done("skipped")]).verdict).toBe("wait");
    expect(classifyRuns([done("cancelled")]).verdict).toBe("wait");
    expect(classifyRuns([done("skipped"), done("cancelled")]).verdict).toBe("wait");
  });

  it("lets a success anywhere clear an earlier failure", () => {
    expect(classifyRuns([done("failure"), done("success")]).verdict).toBe("pass");
    expect(classifyRuns([done("success"), done("failure")]).verdict).toBe("pass");
  });

  it("does not call a failure final while a newer run is still in flight", () => {
    expect(classifyRuns([done("failure"), running()]).verdict).toBe("wait");
    expect(classifyRuns([done("skipped"), running()]).verdict).toBe("wait");
  });
});

describe("readChangedFiles", () => {
  it("returns [] for a missing file, which fails open (no skip)", () => {
    expect(readChangedFiles(path.join(os.tmpdir(), "redlens-no-such-diff.txt"))).toEqual([]);
  });

  it("reads one repo-relative path per line, ignoring blanks", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-gate-")), "changed.txt");
    fs.writeFileSync(file, "CLAUDE.md\n\n  docs/plans/x.md  \n");
    expect(readChangedFiles(file)).toEqual(["CLAUDE.md", "docs/plans/x.md"]);
  });
});
