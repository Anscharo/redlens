import { describe, expect, it } from "vitest";
import { assessStructuralSnapshot, inspectStructuralSnapshot } from "../scripts/lib/atlas-sync-health.mjs";

const HEALTHY = {
  syncSha: "atlas-sha",
  totalDocs: 11_340,
  currentDocs: 11_340,
  docsWithAddressRefs: 193,
  totalAddresses: 438,
  currentAddresses: 438,
};

describe("assessStructuralSnapshot", () => {
  it("accepts a complete current snapshot", () => {
    expect(assessStructuralSnapshot(HEALTHY)).toMatchObject({ healthy: true, reasons: [] });
  });

  it("rejects the missing-address state seen in preview databases", () => {
    const result = assessStructuralSnapshot({ ...HEALTHY, totalAddresses: 0, currentAddresses: 0 });
    expect(result.healthy).toBe(false);
    expect(result.reasons.join("\n")).toContain("reference addresses but atlas_addresses is empty");
  });

  it("rejects rows stamped with a stale SHA", () => {
    const result = assessStructuralSnapshot({
      ...HEALTHY,
      totalDocs: HEALTHY.totalDocs + 2,
      totalAddresses: HEALTHY.totalAddresses + 1,
    });
    expect(result.healthy).toBe(false);
    expect(result.reasons).toEqual([
      "2 atlas_doc_meta row(s) carry another SHA",
      "1 atlas_addresses row(s) carry another SHA",
    ]);
  });
});

function fakeDb(rows: { docs: Record<string, unknown>; addresses: Record<string, unknown> }) {
  return ((strings: TemplateStringsArray) => {
    const sql = String.raw({ raw: strings });
    if (sql.includes("FROM atlas_doc_meta")) return Promise.resolve([rows.docs]);
    if (sql.includes("FROM atlas_addresses")) return Promise.resolve([rows.addresses]);
    return Promise.reject(new Error(`unexpected query: ${sql}`));
  }) as never;
}

describe("inspectStructuralSnapshot", () => {
  it("maps a complete current SHA snapshot as healthy", async () => {
    const result = await inspectStructuralSnapshot(
      fakeDb({
        docs: { total: 11_340, current: 11_340, with_address_refs: 193 },
        addresses: { total: 438, current: 438 },
      }),
      "atlas-sha",
    );
    expect(result).toMatchObject({ ...HEALTHY, healthy: true, reasons: [] });
  });

  it("treats a missing sync SHA as incomplete without querying", async () => {
    const result = await inspectStructuralSnapshot((() => {
      throw new Error("integrity check must not query when sync_state has no SHA");
    }) as never, null);
    expect(result.healthy).toBe(false);
    expect(result.reasons).toEqual([
      "sync_state has no atlas SHA",
      "no current atlas_doc_meta rows",
    ]);
  });

  it("turns a failed integrity query into a repair decision", async () => {
    const db = (() => Promise.reject(new Error("relation does not exist"))) as never;
    const result = await inspectStructuralSnapshot(db, "atlas-sha");
    expect(result.healthy).toBe(false);
    expect(result.reasons).toEqual(["integrity query failed: relation does not exist"]);
  });
});
