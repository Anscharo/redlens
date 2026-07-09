// @vitest-environment jsdom
// getConstellationInit now REJECTS on a worker init failure (deep review Exec
// #4). This consumer must surface that as `initError` — not swallow it into a
// permanent null (forever "loading constellations") or leak an unhandled
// rejection. Query/cluster already had .catch; this covers the init path.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const { getConstellationInit } = vi.hoisted(() => ({ getConstellationInit: vi.fn() }));
vi.mock("../lib/graph", () => ({
  getConstellationInit,
  constellationQuery: () => new Promise(() => {}),
  constellationCluster: () => new Promise(() => {}),
}));

import { useConstellationsWorker } from "./useConstellationsWorker";

// Each test sets its own mockImplementation; no mockReset (a reset in beforeEach
// spuriously trips vitest's unhandled-rejection guard even though the hook's
// two-arg .then handles the rejection). cleanup() unmounts between tests.
afterEach(() => cleanup());

describe("useConstellationsWorker init failure", () => {
  it("exposes initError when getConstellationInit rejects", async () => {
    getConstellationInit.mockImplementation(() => Promise.reject(new Error("relations.json 500")));
    const { result } = renderHook(() => useConstellationsWorker("", null));

    await waitFor(() => expect(result.current.initError).toBeInstanceOf(Error));
    expect(result.current.initError?.message).toMatch(/500/);
    expect(result.current.init).toBeNull();
  });

  it("exposes init and no error on success", async () => {
    getConstellationInit.mockImplementation(() => Promise.resolve({ entities: [], entityEdges: [] }));
    const { result } = renderHook(() => useConstellationsWorker("", null));

    await waitFor(() => expect(result.current.init).not.toBeNull());
    expect(result.current.initError).toBeNull();
  });
});
