// The boundary gate's contract, asserted against the manifests it derives from.
//
// The gate used to carry a hand-maintained FRONTEND_ONLY denylist, and it had
// already drifted: @chenglou/pretext is an apps/web dependency imported by
// treeUtils/breadcrumbs/asideFit and was missing, so a service import of those
// modules would have passed and crashed the pruned image. These tests exist so
// the derived form cannot regress to something a list could get wrong.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readPkg = (rel: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

const rootPkg = readPkg("package.json");
const webPkg = readPkg("apps/web/package.json");

/** Exactly what `pnpm install --prod --filter sabr-root` puts in an image. */
const shipped = new Set(Object.keys(rootPkg.dependencies ?? {}));
const webOnly = [
  ...Object.keys(webPkg.dependencies ?? {}),
  ...Object.keys(webPkg.devDependencies ?? {}),
].filter((name) => !shipped.has(name));

describe("check-boundaries", () => {
  it("passes on the current tree", () => {
    // Throws on a non-zero exit, which is the failure this asserts against.
    const out = execFileSync("node", ["scripts/required/check-boundaries.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("OK");
  });

  it("treats every apps/web-exclusive package as absent from a service image", () => {
    // The property the old denylist had to restate by hand, and got wrong.
    expect(webOnly.filter((name) => shipped.has(name))).toEqual([]);
    expect(webOnly.length).toBeGreaterThan(20);
  });

  it("covers the package the hand-maintained list missed", () => {
    expect(webOnly).toContain("@chenglou/pretext");
  });

  it("also excludes root devDependencies, which --prod strips", () => {
    // Not a frontend concern at all — this is the class `viem` was in when it
    // was a devDependency imported by src/server/balances at runtime.
    for (const name of Object.keys(rootPkg.devDependencies ?? {})) {
      expect(shipped.has(name), `${name} is both a dep and a devDep`).toBe(false);
    }
  });
});
