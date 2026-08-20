// @vitest-environment jsdom
// ActorHistory batches per-doc change history for an actor (definition +
// instances + their params/config + reward primitives), merges by commit, and
// renders collapsible commit rows with a nested doc table. loadAtlas and
// loadHistoryBatch are mocked (no artifacts); CHANGE_COLOR / isGitSha / movePaths /
// severedRange stay real via a partial mock so the git-vs-synthetic-era branch,
// the moved-entry from/to detail, and the severed-era heading fallback all
// render correctly.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "@/types";
import type { ActorProfile, RadarInstance } from "@/lib/actorIndex";
import type { HistoryEntry } from "@/lib/history";
import { RadarProvider } from "./RadarContext";

const configChild: AtlasNode = {
  id: "config-1", doc_no: "A.9.1", title: "Rate Limit Config", type: "Core", depth: 4,
  parentId: "inst-1", content: "", contentHash: "", order: 0, addressRefs: [],
};

const byParent = new Map<string | null, AtlasNode[]>([["inst-1", [configChild]]]);

vi.mock("@/lib/docs", () => ({
  loadAtlas: () => Promise.resolve({ byParent }),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

// Overridable per-test history payload; keep CHANGE_COLOR / isGitSha real.
let historyByDoc = new Map<string, HistoryEntry[]>();
let atlasRejects = false;
vi.mock("@/lib/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/history")>();
  return { ...actual, loadHistoryBatch: () => Promise.resolve(historyByDoc) };
});
vi.mock("@/lib/docs", () => ({
  loadAtlas: () => (atlasRejects ? Promise.reject(new Error("boom")) : Promise.resolve({ byParent })),
}));

import { ActorHistory } from "./ActorHistory";

const docs: Record<string, AtlasNode> = {
  "def-1": { id: "def-1", doc_no: "A.2", title: "Spark Agent", type: "Core", depth: 2, parentId: null, content: "", contentHash: "", order: 0, addressRefs: [] },
  "inst-1": { id: "inst-1", doc_no: "A.2.1", title: "An Instance", type: "Core", depth: 3, parentId: null, content: "", contentHash: "", order: 0, addressRefs: [] },
  "prim-1": { id: "prim-1", doc_no: "A.2.2", title: "A Primitive", type: "Core", depth: 3, parentId: null, content: "", contentHash: "", order: 0, addressRefs: [] },
  "config-1": configChild,
};

function instance(): RadarInstance {
  return {
    id: "e-inst", slug: "inst", rawName: "Inst", st: "dr", displayName: "Inst",
    status: "Active", docId: "inst-1", docNo: "A.2.1", primitiveTitle: null,
    primitiveDocId: "prim-1", primitiveCategory: null, primitiveCategoryDocId: null,
    isUnknownPrimitive: false, signalParams: [{ key: "K", value: "v", srcDocId: "param-1" }],
  };
}

function profile(): ActorProfile {
  return {
    entity: { id: "e1", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "def-1" },
    definingDoc: docs["def-1"],
    chain: { primes: [], executors: [], facilitators: [], govops: [] },
    adRows: [], rewardsAgent: null, relations: [],
    instances: [instance()], invocations: [], primitives: [],
    recommendations: [], comprisesMembers: [], partOfComposite: null,
    contact: { channels: [], emergency: [] },
  } as ActorProfile;
}

function renderHistory() {
  return render(
    <RadarProvider value={{ docs }}>
      <ActorHistory profile={profile()} />
    </RadarProvider>,
  );
}

afterEach(() => {
  cleanup();
  historyByDoc = new Map();
  atlasRejects = false;
});

describe("ActorHistory", () => {
  it("shows the loading state, then merged commit rows", async () => {
    historyByDoc = new Map<string, HistoryEntry[]>([
      ["def-1", [{ date: "2025-01-02", commitHash: "abc1234", changeType: "modified", changeKind: "semantic", pr: 184, prTitle: "Header change", prAuthor: "alice", prUrl: "http://pr/184" }]],
      ["config-1", [{ date: "2025-01-02", commitHash: "abc1234", changeType: "added" }]],
      ["inst-1", [{ date: "2024-12-01", commitHash: "genesis:zzz", changeType: "added", era: "genesis" }]],
      // "moved" events (renumbers, atomization) are structural history and
      // must render like any other change, not be dropped (RD2).
      ["prim-1", [{ date: "2024-10-01", commitHash: "fff9999", changeType: "moved" }]],
    ]);
    renderHistory();
    expect(screen.getByText("loading history…")).toBeInTheDocument();

    expect(await screen.findByText(/2025-01-02/)).toBeInTheDocument();
    expect(screen.getByText("Header change")).toBeInTheDocument();
    // genesis synthetic entry and the moved commit are both present.
    expect(screen.getByText(/2024-12-01/)).toBeInTheDocument();
    expect(screen.getByText(/2024-10-01/)).toBeInTheDocument();
  });

  it("shows real history for an actor whose only changes are structural moves (RD2)", async () => {
    // Mirrors /radar/keel-freezer-multisig: every recorded change for this
    // actor's docs is a renumber, so the old drop-all-"moved" logic emptied
    // mergeByCommit's output entirely and the panel claimed no history.
    historyByDoc = new Map<string, HistoryEntry[]>([
      ["def-1", [{ date: "2025-06-01", commitHash: "renumber01", changeType: "moved", movedFrom: "A.1", movedTo: "A.2" }]],
    ]);
    renderHistory();
    expect(await screen.findByText(/2025-06-01/)).toBeInTheDocument();
    expect(screen.queryByText("no history recorded")).not.toBeInTheDocument();
  });

  it("shows the renumber detail for a genuine move, but guards a self-move from a nonsense label (RD2/H2)", async () => {
    historyByDoc = new Map<string, HistoryEntry[]>([
      // Genuine renumber: doc_no actually changed.
      ["def-1", [{ date: "2025-03-01", commitHash: "ren0001", changeType: "moved", movedFrom: "A.1.11", movedTo: "A.1.12" }]],
      // Self-move (html-era quirk): only title/ancestors changed, so
      // movedFrom === movedTo — must not render "A.1.5 → A.1.5".
      ["inst-1", [{ date: "2025-03-01", commitHash: "ren0001", changeType: "moved", movedFrom: "A.1.5", movedTo: "A.1.5" }]],
    ]);
    renderHistory();
    const toggle = await screen.findByRole("button", { name: /2025-03-01/ });
    fireEvent.click(toggle);

    // Real renumber: from/to is shown.
    expect(screen.getByText("A.1.11 → A.1.12")).toBeInTheDocument();
    // Self-move: still rendered as a row (not dropped), but no "X to X" text.
    expect(screen.getByText("agent instance")).toBeInTheDocument();
    expect(screen.queryByText(/A\.1\.5 → A\.1\.5/)).not.toBeInTheDocument();
  });

  it("merges a same-commit modified + moved event for one doc — modified-then-moved order (P2)", async () => {
    // The history builder emits BOTH a "modified" and a "moved" entry for a
    // doc that's edited and renumbered in the same commit
    // (build-history.mjs: "A node can appear twice ... both entries are
    // emitted"). The per-commit docId dedup used to retain only whichever
    // row arrived first, silently dropping the other's detail — merge both
    // into one row instead.
    historyByDoc = new Map<string, HistoryEntry[]>([
      ["def-1", [
        { date: "2025-04-01", commitHash: "mixed001", changeType: "modified", changeKind: "typo" },
        { date: "2025-04-01", commitHash: "mixed001", changeType: "moved", movedFrom: "A.1.9", movedTo: "A.1.10" },
      ]],
    ]);
    renderHistory();
    const toggle = await screen.findByRole("button", { name: /2025-04-01/ });
    fireEvent.click(toggle);

    // Content-edit detail survives: the changeKind badge.
    expect(screen.getByText("typo")).toBeInTheDocument();
    // Renumber detail survives too — neither event overwrote the other.
    expect(screen.getByText("A.1.9 → A.1.10")).toBeInTheDocument();
    // Merged into ONE row for the doc, not a duplicate.
    expect(screen.getAllByText("A.2")).toHaveLength(1);
  });

  it("merges a same-commit modified + moved event for one doc — moved-then-modified order (P2)", async () => {
    // Same scenario, opposite arrival order — the merge must not depend on
    // which row the batch query happens to return first, since (per the
    // reviewer) the query has no tie-breaker between rows from the same
    // commit.
    historyByDoc = new Map<string, HistoryEntry[]>([
      ["def-1", [
        { date: "2025-04-01", commitHash: "mixed002", changeType: "moved", movedFrom: "A.1.9", movedTo: "A.1.10" },
        { date: "2025-04-01", commitHash: "mixed002", changeType: "modified", changeKind: "typo" },
      ]],
    ]);
    renderHistory();
    const toggle = await screen.findByRole("button", { name: /2025-04-01/ });
    fireEvent.click(toggle);

    expect(screen.getByText("typo")).toBeInTheDocument();
    expect(screen.getByText("A.1.9 → A.1.10")).toBeInTheDocument();
    expect(screen.getAllByText("A.2")).toHaveLength(1);
  });

  it("shows a severed-era month range instead of a blank heading when the date is empty (H3)", async () => {
    historyByDoc = new Map<string, HistoryEntry[]>([
      ["def-1", [{ date: "", commitHash: "severed:2024-09-02..2025-05-28", changeType: "removed", era: "severed" }]],
    ]);
    renderHistory();
    expect(await screen.findByText("2024-09 ~ 2025-05")).toBeInTheDocument();
  });

  it("expands a commit to reveal the affected-doc table and toggles config rows", async () => {
    historyByDoc = new Map<string, HistoryEntry[]>([
      ["def-1", [{ date: "2025-01-02", commitHash: "abc1234", changeType: "modified", pr: 184, prTitle: "Header change", prUrl: "http://pr/184" }]],
      ["config-1", [{ date: "2025-01-02", commitHash: "abc1234", changeType: "added" }]],
    ]);
    renderHistory();
    const toggle = await screen.findByRole("button", { name: /2025-01-02/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Primary (non-config) doc row + its category label are visible.
    expect(screen.getByText("A.2")).toBeInTheDocument();
    expect(screen.getByText("agent definition")).toBeInTheDocument();
    // Real git sha → GitHub commit link.
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("#184")).toBeInTheDocument();

    // Config docs are collapsed behind a toggle by default.
    const configToggle = screen.getByRole("button", { name: /instance config change/ });
    expect(screen.queryByText("A.9.1")).not.toBeInTheDocument();
    fireEvent.click(configToggle);
    expect(screen.getByText("A.9.1")).toBeInTheDocument();
  });

  it("renders the synthetic era instead of a commit link for a pre-git entry", async () => {
    historyByDoc = new Map<string, HistoryEntry[]>([
      ["inst-1", [{ date: "2024-12-01", commitHash: "genesis:zzz", changeType: "added", era: "genesis" }]],
    ]);
    renderHistory();
    const toggle = await screen.findByRole("button", { name: /2024-12-01/ });
    fireEvent.click(toggle);
    expect(screen.getByText("genesis")).toBeInTheDocument();
  });

  it("shows the empty state when there is no history", async () => {
    historyByDoc = new Map();
    renderHistory();
    expect(await screen.findByText("no history recorded")).toBeInTheDocument();
  });

  it("degrades to the empty state when loadAtlas rejects", async () => {
    atlasRejects = true;
    renderHistory();
    await waitFor(() => expect(screen.getByText("no history recorded")).toBeInTheDocument());
  });
});
