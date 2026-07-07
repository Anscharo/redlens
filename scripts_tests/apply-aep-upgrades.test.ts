// Curated AEP upgrade pass (docs/plans/pre-git-history.md, "Stage 1c") — replaces a
// doc's generic severed-birth placeholder with a dated, sourced "Present in Atlas
// Edit Proposal N" fact. Pins: Accepted-only guard, exact-event replacement (never
// touches a doc's other events), supersedes tracking + accumulation, idempotency.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { applyAepUpgrades } from "../scripts/prehist/apply-aep-upgrades.mjs";

const DOC_A = "0d0e2e1a-0502-4ee3-bc9d-8bd8ddde19ec";
const DOC_B = "7648bf12-d600-4e0d-807b-5eb18e8d0f4f";
const UNRELATED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const genericSevered = (docId: string) => ({
  docId, commitHash: "severed:2024-09-02..2025-05-28", commitSeq: -10000,
  changeType: "added", era: "severed", date: null,
  summary: "First appeared between Atlas v2 genesis (2024-09-02) and the first git snapshot (2025-05-28)",
});

const upgrade = (docs: { docId: string; title: string }[]) => [{
  aep: 1, status: "Accepted", dateRatified: "2025-02-24",
  forumUrl: "https://forum.sky.money/t/aep1/25907",
  repoUrl: "https://github.com/sky-ecosystem/next-gen-atlas/blob/4e931dfd4017a9b9d573dec1aac352e60f1bb02a/Atlas%20Edit%20Proposals/AEP-1.md",
  docs,
}];

describe("applyAepUpgrades", () => {
  it("replaces the matching generic severed event with the dated, sourced upgrade — linking the repo file, not the forum thread", () => {
    const artifact = { events: [genericSevered(DOC_A)] };
    const { events, stats } = applyAepUpgrades(upgrade([{ docId: DOC_A, title: "x" }]), artifact);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      docId: DOC_A, commitHash: "aep:1", era: "severed", changeType: "added",
      date: "2025-02-24", summary: "Present in Atlas Edit Proposal 1",
      sourceUrl: "https://github.com/sky-ecosystem/next-gen-atlas/blob/4e931dfd4017a9b9d573dec1aac352e60f1bb02a/Atlas%20Edit%20Proposals/AEP-1.md",
      method: "human",
    });
    expect(stats).toMatchObject({ docs: 1, aeps: 1, replaced: 1, missing: 0 });
  });

  it("leaves events for docs not in the upgrade list untouched", () => {
    const artifact = { events: [genericSevered(DOC_A), genericSevered(UNRELATED)] };
    const { events } = applyAepUpgrades(upgrade([{ docId: DOC_A, title: "x" }]), artifact);
    const other = events.find((e: any) => e.docId === UNRELATED);
    expect(other.commitHash).toBe("severed:2024-09-02..2025-05-28"); // unchanged
  });

  it("only replaces THAT doc's severed-added event, never its other events (real git history, genesis, etc.)", () => {
    const artifact = {
      events: [
        genericSevered(DOC_A),
        { docId: DOC_A, commitHash: "4e931df", changeType: "added", era: "html", date: "2025-05-28" },
        { docId: DOC_A, commitHash: "abc1234", changeType: "modified", era: "html", date: "2025-09-19" },
      ],
    };
    const { events } = applyAepUpgrades(upgrade([{ docId: DOC_A, title: "x" }]), artifact);
    expect(events).toHaveLength(3);
    expect(events.filter((e: any) => e.docId === DOC_A && e.commitHash === "aep:1")).toHaveLength(1);
    expect(events.some((e: any) => e.commitHash === "4e931df")).toBe(true);
    expect(events.some((e: any) => e.commitHash === "abc1234")).toBe(true);
  });

  it("throws on a non-Accepted entry — a rejected AEP must never be matched to a doc", () => {
    const rejectedUpgrade = [{ aep: 2, status: "Rejected-Misaligned", dateRatified: "2025-02-11", forumUrl: "x", docs: [{ docId: DOC_A, title: "x" }] }];
    expect(() => applyAepUpgrades(rejectedUpgrade, { events: [genericSevered(DOC_A)] })).toThrow(/non-Accepted/);
  });

  it("tracks the superseded (old) row so the DB-side stale row can be deleted", () => {
    const artifact = { events: [genericSevered(DOC_A)] };
    const { supersedes } = applyAepUpgrades(upgrade([{ docId: DOC_A, title: "x" }]), artifact);
    expect(supersedes).toContainEqual({ docId: DOC_A, commitHash: "severed:2024-09-02..2025-05-28", changeType: "added" });
  });

  it("accumulates supersedes across runs rather than overwriting a prior run's record", () => {
    const artifact = { events: [genericSevered(DOC_B)], supersedes: [{ docId: DOC_A, commitHash: "severed:2024-09-02..2025-05-28", changeType: "added" }] };
    const { supersedes } = applyAepUpgrades(upgrade([{ docId: DOC_B, title: "y" }]), artifact);
    expect(supersedes).toHaveLength(2);
    expect(supersedes.map((s: any) => s.docId).sort()).toEqual([DOC_A, DOC_B].sort());
  });

  it("reports missing when an upgrade doc has no generic severed event to replace", () => {
    const { stats } = applyAepUpgrades(upgrade([{ docId: DOC_A, title: "x" }]), { events: [] });
    expect(stats.missing).toBe(1);
  });

  it("is idempotent: re-running against its own output reaches the same final state", () => {
    const artifact = { events: [genericSevered(DOC_A)] };
    const first = applyAepUpgrades(upgrade([{ docId: DOC_A, title: "x" }]), artifact);
    const second = applyAepUpgrades(upgrade([{ docId: DOC_A, title: "x" }]), { events: first.events, supersedes: first.supersedes });
    expect(second.events).toEqual(first.events);
    expect(second.supersedes).toEqual(first.supersedes);
  });
});
