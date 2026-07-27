// @vitest-environment jsdom
// ActorHistory batches per-doc change history for an actor (definition +
// instances + their params/config + reward primitives), merges by commit, and
// renders collapsible commit rows with a nested doc table. loadAtlas and
// loadHistoryBatch are mocked (no artifacts); CHANGE_COLOR / isGitSha stay real
// via a partial mock so the git-vs-synthetic-era branch renders correctly.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "../../types";
import type { ActorProfile, RadarInstance } from "../../lib/actorIndex";
import type { HistoryEntry } from "../../lib/history";
import { RadarProvider } from "./RadarContext";

const configChild: AtlasNode = {
  id: "config-1", doc_no: "A.9.1", title: "Rate Limit Config", type: "Core", depth: 4,
  parentId: "inst-1", content: "", contentHash: "", order: 0, addressRefs: [],
};

const byParent = new Map<string | null, AtlasNode[]>([["inst-1", [configChild]]]);

vi.mock("../../lib/docs", () => ({
  loadAtlas: () => Promise.resolve({ byParent }),
}));

vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

// Overridable per-test history payload; keep CHANGE_COLOR / isGitSha real.
let historyByDoc = new Map<string, HistoryEntry[]>();
let atlasRejects = false;
vi.mock("../../lib/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/history")>();
  return { ...actual, loadHistoryBatch: () => Promise.resolve(historyByDoc) };
});
vi.mock("../../lib/docs", () => ({
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
      // "moved" events are renumbering noise and must be dropped.
      ["prim-1", [{ date: "2024-10-01", commitHash: "fff9999", changeType: "moved" }]],
    ]);
    renderHistory();
    expect(screen.getByText("loading history…")).toBeInTheDocument();

    expect(await screen.findByText(/2025-01-02/)).toBeInTheDocument();
    expect(screen.getByText("Header change")).toBeInTheDocument();
    // genesis synthetic entry present; moved-only commit dropped.
    expect(screen.getByText(/2024-12-01/)).toBeInTheDocument();
    expect(screen.queryByText(/2024-10-01/)).not.toBeInTheDocument();
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
