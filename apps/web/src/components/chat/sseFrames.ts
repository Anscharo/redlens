import type { ChatEvent } from "./api";

// One SSE record ("data: <json>"). A frame with no data: line (a heartbeat or
// comment), an empty payload, or unparsable JSON yields nothing.
export function parseSseFrame(frame: string): ChatEvent | null {
  const line = frame.split("\n").find((l) => l.startsWith("data:"));
  const payload = line?.slice(5).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as ChatEvent;
  } catch {
    return null;
  }
}

// Frames can split across chunk boundaries, so only complete
// "\n\n"-terminated records are consumed; the unterminated tail is `rest`.
export function parseSseBuffer(buffer: string): { events: ChatEvent[]; rest: string } {
  const events: ChatEvent[] = [];
  let rest = buffer;
  let nl: number;
  while ((nl = rest.indexOf("\n\n")) !== -1) {
    const ev = parseSseFrame(rest.slice(0, nl));
    rest = rest.slice(nl + 2);
    if (ev) events.push(ev);
  }
  return { events, rest };
}

// Reads a text/event-stream off a fetch body (not EventSource — the request is
// a POST), calling `onEvent` synchronously for each event in arrival order.
// Resolves when the stream ends; rejects (e.g. AbortError) when reading does.
export async function pumpSseEvents(body: ReadableStream<Uint8Array>, onEvent: (ev: ChatEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const parsed = parseSseBuffer(buffer + decoder.decode(value, { stream: true }));
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
}
