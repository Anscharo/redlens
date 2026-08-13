// The 3 curated Preamble GovOps definition-doc UUIDs are hand-kept in two
// places: check-govops-census.mjs's row set (so the census doesn't flag them
// as residue) and govopsResponsibilities.ts's "definition" category rows.
// Previously the only sync mechanism between them was a comment on each side
// — this test is the enforcement. If it fails, the UUID sets diverged; edit
// both files together. (Order is not asserted — the census wraps its list in
// a Set and the report's order comes from govops-definition-docs.json, not
// from the .mjs file, so a reorder-only change is not a real divergence.)
//
// check-govops-census.mjs runs its whole census as an unconditional top-level
// script (reads public/docs.json + public/relations.json, not committed), so
// it's imported dynamically and only when those build artifacts exist —
// mirrors the artifact-gating convention in preview-isolation.test.ts /
// history-canaries.test.ts.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFINITION_UUIDS as REPORT_DEFINITION_UUIDS } from "../src/lib/govopsResponsibilities";

const ROOT = path.resolve(__dirname, "..");
const CENSUS_FILE = "scripts/required/check-govops-census.mjs";
const REPORT_FILE = "src/lib/govopsResponsibilities.ts";

const haveInputs =
  fs.existsSync(path.join(ROOT, "public/docs.json")) &&
  fs.existsSync(path.join(ROOT, "public/relations.json"));

describe.runIf(haveInputs)("GovOps curated definition UUIDs stay in sync", () => {
  it(`${CENSUS_FILE} and ${REPORT_FILE} agree on the definition-doc UUID set`, async () => {
    const { DEFINITION_UUIDS: CENSUS_DEFINITION_UUIDS } = await import(
      "../scripts/required/check-govops-census.mjs"
    );
    const census = [...CENSUS_DEFINITION_UUIDS].sort();
    const report = [...REPORT_DEFINITION_UUIDS].sort();
    expect(
      census,
      `DEFINITION_UUIDS diverged between ${CENSUS_FILE} and ${REPORT_FILE} — ` +
        "these are hand-kept in sync (no shared import), so edit both together.",
    ).toEqual(report);
  });
});
