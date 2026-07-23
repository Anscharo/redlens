// SSE client registry unit tests. Run under `bun test`.
import { describe, test, expect } from "bun:test";
import { registerSSEClient, broadcastAtlasUpdate } from "./sse.ts";

describe("SSE client registry", () => {
  test("registerSSEClient returns an unregister function that removes the client", () => {
    const calls1: string[] = [];
    const unregister1 = registerSSEClient(
      (chunk) => calls1.push(chunk),
      () => {}
    );

    const calls2: string[] = [];
    const unregister2 = registerSSEClient(
      (chunk) => calls2.push(chunk),
      () => {}
    );

    // Both clients should receive the broadcast
    broadcastAtlasUpdate("abc123");
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
    expect(calls1[0]).toContain("abc123");
    expect(calls2[0]).toContain("abc123");

    // Unregister the first client
    unregister1();

    // Broadcast again - only the second client should receive it
    broadcastAtlasUpdate("def456");
    expect(calls1).toHaveLength(1); // Still 1, no new call
    expect(calls2).toHaveLength(2); // Now 2

    unregister2();
  });

  test("broadcastAtlasUpdate sends exact SSE format with JSON payload", () => {
    const calls: string[] = [];
    const unregister = registerSSEClient(
      (chunk) => calls.push(chunk),
      () => {}
    );

    const testSha = "test-sha-value";
    broadcastAtlasUpdate(testSha);

    expect(calls).toHaveLength(1);
    const expectedMsg = `event: atlas-update\ndata: ${JSON.stringify({ atlas_sha: testSha })}\n\n`;
    expect(calls[0]).toBe(expectedMsg);

    unregister();
  });

  test("broadcasting to zero registered clients does not throw", () => {
    expect(() => {
      broadcastAtlasUpdate("test-sha");
    }).not.toThrow();
  });

  test("client whose enqueue throws is automatically removed", () => {
    let throwingClientCallCount = 0;
    const unregister1 = registerSSEClient(
      () => {
        throwingClientCallCount++;
        throw new Error("Client disconnected");
      },
      () => {}
    );

    const normalCalls: string[] = [];
    const unregister2 = registerSSEClient(
      (chunk) => normalCalls.push(chunk),
      () => {}
    );

    // First broadcast - the throwing client should fail but be auto-removed
    expect(() => {
      broadcastAtlasUpdate("sha1");
    }).not.toThrow();
    expect(throwingClientCallCount).toBe(1);
    expect(normalCalls).toHaveLength(1);

    // Second broadcast - the throwing client should NOT be called again
    expect(() => {
      broadcastAtlasUpdate("sha2");
    }).not.toThrow();
    expect(throwingClientCallCount).toBe(1); // Still 1, not incremented
    expect(normalCalls).toHaveLength(2);

    unregister1();
    unregister2();
  });

  test("multiple registrations get distinct auto-incrementing IDs", () => {
    const calls1: string[] = [];
    const unregister1 = registerSSEClient(
      (chunk) => calls1.push(chunk),
      () => {}
    );

    const calls2: string[] = [];
    const unregister2 = registerSSEClient(
      (chunk) => calls2.push(chunk),
      () => {}
    );

    const calls3: string[] = [];
    const unregister3 = registerSSEClient(
      (chunk) => calls3.push(chunk),
      () => {}
    );

    // Unregister only the middle one
    unregister2();

    // Broadcast - first and third should receive, second should not
    broadcastAtlasUpdate("test");
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(0);
    expect(calls3).toHaveLength(1);

    unregister1();
    unregister3();
  });

  test("close callback is stored but not invoked by sse.ts itself", () => {
    let closeCalled = false;
    const unregister = registerSSEClient(
      () => {},
      () => {
        closeCalled = true;
      }
    );

    broadcastAtlasUpdate("test");
    expect(closeCalled).toBe(false);

    unregister();
    expect(closeCalled).toBe(false);
  });
});
