import { describe, it, expect, vi } from "vitest";
import { touchSyncHeartbeat } from "./worker-heartbeat.mjs";

describe("touchSyncHeartbeat", () => {
  it("runs the UPDATE query against the given db client", async () => {
    const calls: string[] = [];
    const db = (strings: TemplateStringsArray, ..._values: unknown[]) => {
      calls.push(strings.join(""));
      return Promise.resolve([]);
    };

    await touchSyncHeartbeat(db as unknown as Parameters<typeof touchSyncHeartbeat>[0]);

    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("UPDATE sync_state");
    expect(calls[0]).toContain("synced_at");
  });

  it("swallows a throwing db client and warns instead of throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = () => {
      throw new Error("connection refused");
    };

    await expect(
      touchSyncHeartbeat(db as unknown as Parameters<typeof touchSyncHeartbeat>[0]),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("heartbeat update failed");

    warnSpy.mockRestore();
  });
});
