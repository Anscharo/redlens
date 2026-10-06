import { beforeEach, describe, expect, it, vi } from "vitest";

const inspect = vi.fn();
const hasArtifacts = vi.fn();
vi.mock("../scripts/lib/atlas-sync-health.mjs", () => ({ inspectStructuralSnapshot: inspect }));
vi.mock("../src/server/atlas-artifacts.ts", () => ({ hasArtifacts }));

const { readDriftState, logRebuildReason } = await import("../scripts/lib/worker-drift.mjs");

/** A Bun-SQL-shaped tagged template answering by the query's text. */
function fakeDb(answers: { syncSha?: string | null; stale?: number | Error }) {
  return (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("FROM sync_state")) return Promise.resolve([{ atlas_sha: answers.syncSha ?? null }]);
    if (answers.stale instanceof Error) return Promise.reject(answers.stale);
    return Promise.resolve([{ n: answers.stale ?? 0 }]);
  };
}

describe("worker drift readings", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  beforeEach(() => {
    log.mockClear();
    warn.mockClear();
    inspect.mockReset();
    hasArtifacts.mockReset();
  });

  it("gathers upstream, pointer, stale count, structure and artifacts for a healthy store", async () => {
    inspect.mockResolvedValue({ healthy: true, reasons: [], currentDocs: 10, currentAddresses: 2 });
    hasArtifacts.mockResolvedValue(true);
    const state = await readDriftState(fakeDb({ syncSha: "a".repeat(40), stale: 0 }), async () => "b".repeat(40));
    expect(state).toMatchObject({ upstreamSha: "b".repeat(40), syncState: "a".repeat(40), staleCount: 0, artifactsPublished: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("structural integrity OK — 10 docs, 2 addresses"));
  });

  it("counts an unreadable embeddings table as stale and warns about failed structure and missing artifacts", async () => {
    inspect.mockResolvedValue({ healthy: false, reasons: ["no addresses"] });
    hasArtifacts.mockResolvedValue(false);
    const state = await readDriftState(fakeDb({ syncSha: "c".repeat(40), stale: new Error("boom") }), async () => null);
    expect(state.staleCount).toBe(1);
    expect(state.artifactsPublished).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("structural integrity failed — no addresses"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("artifact store has nothing for cccccccccccc"));
  });

  it("treats no pointer, or an unreadable artifact store, as published", async () => {
    inspect.mockResolvedValue({ healthy: true, reasons: [], currentDocs: 1, currentAddresses: 1 });
    expect((await readDriftState(fakeDb({ syncSha: null }), async () => null)).artifactsPublished).toBe(true);
    expect(hasArtifacts).not.toHaveBeenCalled();
    hasArtifacts.mockRejectedValue(new Error("relation does not exist"));
    expect((await readDriftState(fakeDb({ syncSha: "d".repeat(40) }), async () => null)).artifactsPublished).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("artifact-store probe skipped — relation does not exist"));
  });

  it("logs why it is rebuilding, or that the upstream sha was unreadable", () => {
    logRebuildReason({ upstreamSha: null, syncState: null, staleCount: 0 });
    expect(warn).toHaveBeenCalledWith("atlas-worker: could not read upstream SHA — proceeding anyway");
    logRebuildReason({ upstreamSha: "e".repeat(40), syncState: null, staleCount: 3 });
    expect(log).toHaveBeenCalledWith(`atlas-worker: upstream=${"e".repeat(12)} db=none staleEmbeds=3`);
  });
});
