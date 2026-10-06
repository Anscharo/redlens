import { describe, expect, it } from "vitest";
import { parseSseBuffer, parseSseFrame, pumpSseEvents } from "./sseFrames";
import type { ChatEvent } from "./api";

describe("parseSseFrame", () => {
  it("parses the data: line of a frame", () => {
    expect(parseSseFrame('event: x\ndata: {"type":"token","text":"a"}')).toEqual({ type: "token", text: "a" });
  });
  it("yields nothing for a heartbeat, an empty payload, or bad JSON", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
    expect(parseSseFrame("data:   ")).toBeNull();
    expect(parseSseFrame("data: {nope")).toBeNull();
  });
});

describe("parseSseBuffer", () => {
  it("consumes only complete records and returns the unterminated tail", () => {
    const { events, rest } = parseSseBuffer('data: {"type":"token","text":"a"}\n\ndata: {"type":"tok');
    expect(events).toEqual([{ type: "token", text: "a" }]);
    expect(rest).toBe('data: {"type":"tok');
  });
});

describe("pumpSseEvents", () => {
  it("delivers events in order across chunk boundaries", async () => {
    const enc = new TextEncoder();
    const chunks = ['data: {"type":"token","text":"a"}\n', '\ndata: {"type":"tok', 'en","text":"b"}\n\n'];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    const seen: ChatEvent[] = [];
    await pumpSseEvents(body, (ev) => seen.push(ev));
    expect(seen).toEqual([
      { type: "token", text: "a" },
      { type: "token", text: "b" },
    ]);
  });
});
