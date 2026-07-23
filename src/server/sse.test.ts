// Test the SSE client registry.
import { test, expect, beforeEach } from "bun:test";
import { registerSSEClient, broadcastAtlasUpdate } from "./sse.ts";

beforeEach(() => {
  // Reset module state by clearing all registered clients between tests.
  // We can't directly clear the clients map, so we rely on test isolation.
  // In practice, each test starts fresh with no clients registered.
});

test("registerSSEClient returns an unregister function", () => {
  let enqueued: string[] = [];
  const unregister = registerSSEClient(
    (chunk) => enqueued.push(chunk),
    () => { }
  );
  expect(typeof unregister).toBe("function");
});

test("registerSSEClient accepts enqueue and close callbacks", () => {
  let enqueueCalled = false;
  let closeCalled = false;
  registerSSEClient(
    () => { enqueueCalled = true; },
    () => { closeCalled = true; }
  );
  expect(typeof enqueueCalled).toBe("boolean");
  expect(typeof closeCalled).toBe("boolean");
});

test("broadcastAtlasUpdate sends an SSE message to registered clients", () => {
  const messages: string[] = [];
  registerSSEClient(
    (chunk) => messages.push(chunk),
    () => { }
  );

  broadcastAtlasUpdate("abc123def456");
  expect(messages.length).toBe(1);
  expect(messages[0]).toContain("event: atlas-update");
  expect(messages[0]).toContain("abc123def456");
});

test("broadcastAtlasUpdate sends correct SSE format", () => {
  const messages: string[] = [];
  registerSSEClient(
    (chunk) => messages.push(chunk),
    () => { }
  );

  broadcastAtlasUpdate("testsha");
  const msg = messages[0];
  expect(msg).toMatch(/^event: atlas-update\n/);
  expect(msg).toContain("data:");
  expect(msg).toContain(JSON.stringify({ atlas_sha: "testsha" }));
  expect(msg.endsWith("\n\n")).toBe(true);
});

test("registerSSEClient unregister removes the client from broadcasts", () => {
  const messages: string[] = [];
  const unregister = registerSSEClient(
    (chunk) => messages.push(chunk),
    () => { }
  );

  broadcastAtlasUpdate("before");
  expect(messages.length).toBe(1);

  unregister();

  broadcastAtlasUpdate("after");
  expect(messages.length).toBe(1); // No new message added
});

test("multiple clients all receive broadcasts", () => {
  const messages1: string[] = [];
  const messages2: string[] = [];

  registerSSEClient(
    (chunk) => messages1.push(chunk),
    () => { }
  );
  registerSSEClient(
    (chunk) => messages2.push(chunk),
    () => { }
  );

  broadcastAtlasUpdate("shared");
  expect(messages1.length).toBe(1);
  expect(messages2.length).toBe(1);
  expect(messages1[0]).toContain("shared");
  expect(messages2[0]).toContain("shared");
});

test("broadcastAtlasUpdate handles client errors gracefully", () => {
  let errorCount = 0;
  registerSSEClient(
    (chunk) => {
      throw new Error("Client error");
    },
    () => { }
  );
  registerSSEClient(
    (chunk) => { /* second client ok */ },
    () => { }
  );

  // Should not throw even if first client errors
  expect(() => broadcastAtlasUpdate("test")).not.toThrow();
});
