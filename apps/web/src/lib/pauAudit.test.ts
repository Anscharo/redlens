// The audit loaders: the PAUs page's count reads no document history, since
// whether a value needs an audit never depends on the dates; the report reads
// it; and a worker that has stored no snapshots yet is asked again.
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadHistoryBatch = vi.fn(async () => new Map());
const loadPau = vi.fn();
vi.mock("@/lib/history", () => ({ loadHistoryBatch }));
vi.mock("./graph", () => ({ loadGraph: async () => ({ participants: [] }) }));
vi.mock("./pau", async (orig) => ({ ...(await orig<typeof import("./pau")>()), loadPau }));

const claim = { prime: "p1", chain: "ethereum", role: "relayer", address: "0x" + "1".repeat(40), reason: "not a relayer", docs: ["d1"] };
const answer = (deployments: unknown[]) => loadPau.mockResolvedValue({ deployments, rejectedClaims: [claim] });

beforeEach(() => {
  vi.resetModules();
  loadHistoryBatch.mockClear();
  loadPau.mockReset();
});

describe("PAU audit loaders", () => {
  it("counts items without reading any document history, and reads it for the report", async () => {
    answer([{ deployment: "p1:ethereum:monolithic", prime: "p1", chain: "ethereum", kind: "monolithic", contracts: [] }]);
    const { loadPauAudit, loadPauAuditItems } = await import("./pauAudit");
    expect((await loadPauAuditItems()).map((r) => r.item)).toEqual([`claim:p1:ethereum:relayer:${claim.address}`]);
    expect(loadHistoryBatch).not.toHaveBeenCalled();
    expect(await loadPauAudit()).toHaveLength(1);
    expect(loadHistoryBatch).toHaveBeenCalledTimes(1);
    await loadPauAuditItems();
    expect(loadPau).toHaveBeenCalledTimes(1);
  });

  it("asks again while the worker has stored no snapshots", async () => {
    answer([]);
    const { loadPauAuditItems } = await import("./pauAudit");
    await loadPauAuditItems();
    await loadPauAuditItems();
    expect(loadPau).toHaveBeenCalledTimes(2);
  });
});
