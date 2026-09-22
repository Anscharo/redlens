import { describe, it, expect, vi } from "vitest";
import { touchSyncHeartbeat } from "./worker-heartbeat.mjs";

describe("touchSyncHeartbeat", () => {
  it("runs the UPDATE query against the given db client and logs the sha", async () => {
    const calls: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = (strings: TemplateStringsArray, ..._values: unknown[]) => {
      calls.push(strings.join(""));
      return Promise.resolve([{ atlas_sha: "abcdef1234567890" }]);
    };

    await touchSyncHeartbeat(db as unknown as Parameters<typeof touchSyncHeartbeat>[0]);

    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("UPDATE sync_state");
    expect(calls[0]).toContain("synced_at");
    expect(calls[0]).toContain("RETURNING atlas_sha");
    expect(logSpy).toHaveBeenCalledWith("atlas-worker: heartbeat ok — sha abcdef123456");

    logSpy.mockRestore();
  });

  it("throws when the db client throws — a missed heartbeat must fail the cron", async () => {
    const db = () => {
      throw new Error("connection refused");
    };

    await expect(
      touchSyncHeartbeat(db as unknown as Parameters<typeof touchSyncHeartbeat>[0]),
    ).rejects.toThrow("connection refused");
  });

  it("throws when the UPDATE matches no row", async () => {
    const db = () => Promise.resolve([]);

    await expect(
      touchSyncHeartbeat(db as unknown as Parameters<typeof touchSyncHeartbeat>[0]),
    ).rejects.toThrow(/updated 0 row\(s\), expected 1/);
  });
});
