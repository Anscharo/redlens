// SSE module testing
import { test, expect } from "bun:test";

test("SSE registerSSEClient returns unsubscribe function", async () => {
  const { registerSSEClient } = await import("./sse.ts");

  let enqueueCalls = 0;
  let closeCalls = 0;

  const unsub = registerSSEClient(
    () => { enqueueCalls++; },
    () => { closeCalls++; }
  );

  expect(typeof unsub).toBe("function");
  unsub();
});

test("SSE registerSSEClient with error handling", async () => {
  const { registerSSEClient } = await import("./sse.ts");

  const unsub = registerSSEClient(
    () => { throw new Error("test error"); },
    () => { throw new Error("test error"); }
  );

  expect(typeof unsub).toBe("function");
  unsub();
});

test("SSE broadcastAtlasUpdate with multiple clients", async () => {
  const { registerSSEClient, broadcastAtlasUpdate } = await import("./sse.ts");

  let messages1 = 0;
  let messages2 = 0;

  const unsub1 = registerSSEClient(
    () => { messages1++; },
    () => {}
  );

  const unsub2 = registerSSEClient(
    () => { messages2++; },
    () => {}
  );

  broadcastAtlasUpdate("sha-123");

  expect(messages1).toBe(1);
  expect(messages2).toBe(1);

  unsub1();
  unsub2();
});

test("SSE broadcastAtlasUpdate with error in enqueue", async () => {
  const { registerSSEClient, broadcastAtlasUpdate } = await import("./sse.ts");

  let errorThrown = false;
  const unsub = registerSSEClient(
    () => { throw new Error("broadcast error"); },
    () => {}
  );

  // Should not throw
  broadcastAtlasUpdate("sha-456");

  unsub();
});
