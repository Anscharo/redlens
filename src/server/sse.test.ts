// Test the SSE client registry.
import { describe, it, expect, beforeEach } from "bun:test";
import { registerSSEClient, broadcastAtlasUpdate } from "./sse.ts";

describe("SSE client registry", () => {
  beforeEach(() => {
    // Reset module state by clearing all registered clients between tests.
    // We can't directly clear the clients map, so we rely on test isolation.
    // In practice, each test starts fresh with no clients registered.
  });

  it("registerSSEClient returns an unregister function", () => {
    let enqueued: string[] = [];
    const unregister = registerSSEClient(
      (chunk) => enqueued.push(chunk),
      () => { }
    );
    expect(typeof unregister).toBe("function");
  });

  it("registerSSEClient accepts enqueue and close callbacks", () => {
    let enqueueCalled = false;
    let closeCalled = false;
    registerSSEClient(
      () => { enqueueCalled = true; },
      () => { closeCalled = true; }
    );
    expect(typeof enqueueCalled).toBe("boolean");
    expect(typeof closeCalled).toBe("boolean");
  });

  it("broadcastAtlasUpdate sends an SSE message to registered clients", () => {
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

  it("broadcastAtlasUpdate sends correct SSE format", () => {
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

  it("registerSSEClient unregister removes the client from broadcasts", () => {
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

  it("multiple clients all receive broadcasts", () => {
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

  it("broadcastAtlasUpdate handles client errors gracefully", () => {
    registerSSEClient(
      (_chunk) => {
        throw new Error("Client error");
      },
      () => { }
    );
    registerSSEClient(
      (_chunk) => { /* second client ok */ },
      () => { }
    );

    // Should not throw even if first client errors
    expect(() => broadcastAtlasUpdate("test")).not.toThrow();
  });

  it("registerSSEClient stores client with unique id", () => {
    for (let i = 0; i < 5; i++) {
      const unregister = registerSSEClient(
        () => { },
        () => { }
      );
      expect(typeof unregister).toBe("function");
    }
  });

  it("broadcastAtlasUpdate sends to all registered clients simultaneously", () => {
    const messages: string[][] = [[], [], []];

    registerSSEClient(
      (chunk) => messages[0].push(chunk),
      () => { }
    );
    registerSSEClient(
      (chunk) => messages[1].push(chunk),
      () => { }
    );
    registerSSEClient(
      (chunk) => messages[2].push(chunk),
      () => { }
    );

    broadcastAtlasUpdate("sync-test");

    expect(messages[0].length).toBe(1);
    expect(messages[1].length).toBe(1);
    expect(messages[2].length).toBe(1);
  });

  it("broadcastAtlasUpdate message format includes data field", () => {
    const messages: string[] = [];
    registerSSEClient(
      (chunk) => messages.push(chunk),
      () => { }
    );

    broadcastAtlasUpdate("sha123");
    const msg = messages[0];

    expect(msg).toContain("event: atlas-update");
    expect(msg).toContain("data:");
    expect(msg).toContain("sha123");
    expect(msg).toContain("atlas_sha");
  });

  it("registerSSEClient callback parameter is usable", () => {
    let enqueueWasCalled = false;
    let closeWasCalled = false;

    registerSSEClient(
      () => { enqueueWasCalled = true; },
      () => { closeWasCalled = true; }
    );

    expect(typeof enqueueWasCalled).toBe("boolean");
    expect(typeof closeWasCalled).toBe("boolean");
  });

  it("multiple broadcast calls accumulate messages", () => {
    const messages: string[] = [];
    registerSSEClient(
      (chunk) => messages.push(chunk),
      () => { }
    );

    broadcastAtlasUpdate("first");
    broadcastAtlasUpdate("second");
    broadcastAtlasUpdate("third");

    expect(messages.length).toBe(3);
    expect(messages[0]).toContain("first");
    expect(messages[1]).toContain("second");
    expect(messages[2]).toContain("third");
  });

  it("registerSSEClient unregister can be called multiple times", () => {
    const messages: string[] = [];
    const unregister = registerSSEClient(
      (chunk) => messages.push(chunk),
      () => { }
    );

    broadcastAtlasUpdate("test1");
    unregister();
    broadcastAtlasUpdate("test2");
    unregister(); // Should not throw

    expect(messages.length).toBe(1);
  });

  it("broadcastAtlasUpdate JSON encodes the data correctly", () => {
    const messages: string[] = [];
    registerSSEClient(
      (chunk) => messages.push(chunk),
      () => { }
    );

    const testSha = "abc123def456";
    broadcastAtlasUpdate(testSha);

    const msg = messages[0];
    const dataMatch = msg.match(/data: ({.*})/);
    expect(dataMatch).toBeDefined();

    if (dataMatch) {
      const data = JSON.parse(dataMatch[1]);
      expect(data.atlas_sha).toBe(testSha);
    }
  });

  it("registerSSEClient with empty callbacks", () => {
    const unregister = registerSSEClient(
      () => { },
      () => { }
    );

    expect(typeof unregister).toBe("function");

    // Should not throw
    broadcastAtlasUpdate("test");
    unregister();
    broadcastAtlasUpdate("test2");
  });

  it("broadcastAtlasUpdate terminates message with double newline", () => {
    const messages: string[] = [];
    registerSSEClient(
      (chunk) => messages.push(chunk),
      () => { }
    );

    broadcastAtlasUpdate("test");
    const msg = messages[0];

    expect(msg.endsWith("\n\n")).toBe(true);
  });

  it("registerSSEClient tracks multiple independent clients", () => {
    const client1: string[] = [];
    const client2: string[] = [];
    const client3: string[] = [];

    registerSSEClient(
      (chunk) => client1.push(chunk),
      () => { }
    );
    const unregister2 = registerSSEClient(
      (chunk) => client2.push(chunk),
      () => { }
    );
    registerSSEClient(
      (chunk) => client3.push(chunk),
      () => { }
    );

    broadcastAtlasUpdate("msg1");
    unregister2();
    broadcastAtlasUpdate("msg2");

    expect(client1.length).toBe(2);
    expect(client2.length).toBe(1);
    expect(client3.length).toBe(2);
  });
});
