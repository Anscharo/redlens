import { describe, expect, it } from "bun:test";
import { broadcastAtlasUpdate, heartbeat, registerSSEClient, sseClientCount } from "./sse.ts";

describe("SSE client registry", () => {
  it("broadcasts atlas-update events to registered clients", () => {
    const chunks: string[] = [];
    const unregister = registerSSEClient((chunk) => chunks.push(chunk), () => {});

    try {
      broadcastAtlasUpdate("abc123");
      expect(chunks).toEqual(['event: atlas-update\ndata: {"atlas_sha":"abc123"}\n\n']);
    } finally {
      unregister();
    }
  });

  it("does not send events after unregister", () => {
    const chunks: string[] = [];
    const unregister = registerSSEClient((chunk) => chunks.push(chunk), () => {});

    unregister();
    broadcastAtlasUpdate("def456");

    expect(chunks).toEqual([]);
  });

  it("drops clients whose enqueue throws", () => {
    const chunks: string[] = [];
    registerSSEClient(() => {
      throw new Error("broken stream");
    }, () => {});
    const unregisterHealthy = registerSSEClient((chunk) => chunks.push(chunk), () => {});

    try {
      broadcastAtlasUpdate("first");
      broadcastAtlasUpdate("second");

      expect(chunks).toEqual([
        'event: atlas-update\ndata: {"atlas_sha":"first"}\n\n',
        'event: atlas-update\ndata: {"atlas_sha":"second"}\n\n',
      ]);
    } finally {
      unregisterHealthy();
    }
  });

  it("heartbeat pings live clients and evicts dead ones", () => {
    const pings: string[] = [];
    registerSSEClient(() => {
      throw new Error("dead stream");
    }, () => {});
    const unregisterHealthy = registerSSEClient((chunk) => pings.push(chunk), () => {});

    try {
      heartbeat(); // first tick: pings both, evicts the dead one
      heartbeat(); // second tick: only the healthy client remains
      expect(pings).toEqual([":ping\n\n", ":ping\n\n"]);
    } finally {
      unregisterHealthy();
    }
  });
});

describe("sseClientCount", () => {
  it("tracks live registrations", () => {
    const before = sseClientCount();
    const a = registerSSEClient(() => {}, () => {});
    const b = registerSSEClient(() => {}, () => {});
    expect(sseClientCount()).toBe(before + 2);
    a();
    expect(sseClientCount()).toBe(before + 1);
    b();
    expect(sseClientCount()).toBe(before);
  });
});
