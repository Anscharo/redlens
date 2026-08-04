// Unit coverage for the silent-collapse tripwires (graph-tripwires.mjs):
// zero-match warnings for the structural doc_no gates and type filters, and
// the bucketed [drift-count] stderr lines the atlas-healer/atlas-update
// warnings diff keys on. The healthy case must stay silent — a tripwire that
// fires on the current atlas would poison the warnings baseline.

import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { checkGateTripwires, countBucket, warnDriftCount } from "../scripts/lib/graph-tripwires.mjs";

const doc = (doc_no: string, type = "Core", title = "Doc") => ({ doc_no, type, title });

// One doc per structural gate plus one per guarded type — the minimal corpus
// where nothing should fire.
const HEALTHY = [
  doc("A.6.1.1.1"), // isPrimeAgent
  doc("A.6.1.2.1"), // isExecutorAgent
  doc("A.6.1.2.1.1"), // isFacilitatorDoc
  doc("A.6.1.2.1.2"), // isGovOpsDoc
  doc("A.1.2.0.6.1", "Active Data"), // isActiveData + "Active Data" type
  doc("A.2.8.2.1"), // isEcosystemAccord
  doc("A.2.8.2.1.1.1.1"), // isPartyDetails
  doc("A.2.13.1.1.1"), // isGrantDoc
  doc("A.3.1", "Core", "Freezer Instance Configuration Document"), // isICD
  doc("A.1.12.1", "Active Data Controller"),
  doc("A.1", "Scope"),
];

afterEach(() => vi.restoreAllMocks());

describe("checkGateTripwires", () => {
  it("stays silent on a corpus where every gate and type matches", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkGateTripwires(HEALTHY)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("fires one [drift] warning per zeroed gate and type on a renumbered/renamed corpus", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 9 doc_no gates + 4 type gates all match nothing here.
    expect(checkGateTripwires([doc("B.1.1", "Weird Type")])).toBe(13);
    expect(warn).toHaveBeenCalledTimes(13);
    for (const call of warn.mock.calls) {
      expect(call[0]).toMatch(/^ {2}\[drift\] tripwire: /);
    }
    const all = warn.mock.calls.map((c) => c[0]).join("\n");
    expect(all).toMatch(/isPrimeAgent matched 0 docs/);
    expect(all).toMatch(/no docs of type "Active Data Controller"/);
  });

  it("fires only the zeroed gate when the rest of the corpus is intact", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noAccords = HEALTHY.filter((d) => !d.doc_no.startsWith("A.2.8.2"));
    expect(checkGateTripwires(noAccords)).toBe(2); // isEcosystemAccord + isPartyDetails
    const all = warn.mock.calls.map((c) => c[0]).join("\n");
    expect(all).toMatch(/isEcosystemAccord/);
    expect(all).toMatch(/isPartyDetails/);
    expect(all).not.toMatch(/isPrimeAgent/);
  });

  it("does not count an ICD Location doc as an ICD", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const corpus = HEALTHY.map((d) =>
      d.title.includes("Instance Configuration Document")
        ? doc("A.3.1", "Core", "Freezer Instance Configuration Document Location")
        : d,
    );
    checkGateTripwires(corpus);
    expect(warn.mock.calls.map((c) => c[0]).join("\n")).toMatch(/isICD matched 0 docs/);
  });
});

describe("countBucket", () => {
  it("maps counts onto stable bucket labels at the boundaries", () => {
    expect(countBucket(0)).toBe("0");
    expect(countBucket(1)).toBe("1-9");
    expect(countBucket(9)).toBe("1-9");
    expect(countBucket(10)).toBe("10-49");
    expect(countBucket(49)).toBe("10-49");
    expect(countBucket(50)).toBe("50+");
    expect(countBucket(500)).toBe("50+");
  });
});

describe("warnDriftCount", () => {
  it("emits the exact baseline-diffable stderr line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnDriftCount("responsible_party_for unresolved", 5);
    expect(warn).toHaveBeenCalledWith("  [drift-count] responsible_party_for unresolved: 1-9");
  });
});
