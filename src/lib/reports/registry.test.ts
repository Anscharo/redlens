import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_GROUP_DEFS } from "./groups";
import { REPORTS } from "./registry";

const NOT_ENTRIES = new Set(["groups.ts", "registry.ts", "types.ts"]);

describe("report registry", () => {
  it("lists every entry file in this directory, under its own id", () => {
    const files = fs
      .readdirSync(import.meta.dirname)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !NOT_ENTRIES.has(f));
    expect(files.map((f) => path.basename(f, ".ts")).sort()).toEqual(REPORTS.map((r) => r.id).sort());
  });

  it("declares each id once", () => {
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length);
  });

  it("puts every report in a defined group, and every group has a report", () => {
    const keys = REPORT_GROUP_DEFS.map((g) => g.key);
    for (const r of REPORTS) expect(keys).toContain(r.group);
    for (const k of keys) expect(REPORTS.some((r) => r.group === k)).toBe(true);
  });

  it("gives each search pill a distinct label", () => {
    const labels = REPORTS.flatMap((r) => ("scope" in r ? [r.scope.label] : []));
    expect(new Set(labels).size).toBe(labels.length);
  });
});
