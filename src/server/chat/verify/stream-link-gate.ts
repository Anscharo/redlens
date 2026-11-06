// Streaming citation gate — the token-side half of citation repair. The
// post-answer pass (citation-repair.ts) is the authority, but on its own a
// fabricated /atlas/ link is visible to the user until done.content replaces
// the streamed text. This gate holds token text from "[" until the link
// closes — links are short, so the hold is imperceptible — hands the complete
// link to a render callback (the orchestrator wraps the SAME LinkJudge the
// post-answer pass uses), and emits the repaired form, so the stream and
// done.content agree and nothing flashes wrong. Anything that turns out not
// to be a link ("]" with no "(", whitespace in the href, a hold past the cap)
// is flushed raw; the post-answer pass remains the safety net for those.
import type { ChatEvent } from "../chat-loop.ts";

// A real citation link is well under this; a stray "[" must not stall the stream.
const MAX_HELD = 400;

export interface LinkGate {
  // Feed a token's text; returns whatever is safe to emit now.
  push(text: string): string;
  // End of stream: return any held tail raw (an answer ending mid-link).
  flush(): string;
}

interface GateState {
  mode: "idle" | "title" | "after" | "target";
  held: string;
  title: string;
  target: string;
}

function resetGate(g: GateState): void {
  g.mode = "idle";
  g.held = g.title = g.target = "";
}

function beginLink(g: GateState): void {
  resetGate(g);
  g.mode = "title";
  g.held = "[";
}

// Advance the link parser by one character; returns the text safe to emit now.
// Mirrors the repair pass's link regex \[([^\]]+)\]\(([^)\s]+)\): the title is
// anything but "]", the href anything but ")" or whitespace, both non-empty.
function stepGate(g: GateState, ch: string, render: (title: string, target: string, raw: string) => string): string {
  let out = "";
  if (g.mode === "idle") {
    if (ch === "[") beginLink(g);
    else out += ch;
  } else if (g.mode === "title") {
    g.held += ch;
    if (ch === "]") g.mode = "after";
    else g.title += ch;
  } else if (g.mode === "after") {
    if (ch === "(") {
      g.held += ch;
      g.mode = "target";
    } else {
      // "[text]" with no "(" — not a link; the "[" may start a new one.
      out += g.held;
      if (ch === "[") beginLink(g);
      else {
        resetGate(g);
        out += ch;
      }
    }
  } else if (ch === ")") {
    out += g.title && g.target ? render(g.title, g.target, g.held + ")") : g.held + ")";
    resetGate(g);
  } else if (/\s/.test(ch)) {
    // An href never contains whitespace — the repair regex wouldn't match.
    out += g.held + ch;
    resetGate(g);
  } else {
    g.held += ch;
    g.target += ch;
  }
  return out;
}

// `render` receives the parsed link and its raw text, returns the replacement
// to emit. It MUST NOT throw — wrap judge errors and fall back to `raw`.
export function createLinkGate(render: (title: string, target: string, raw: string) => string): LinkGate {
  const g: GateState = { mode: "idle", held: "", title: "", target: "" };

  const push = (text: string): string => {
    let out = "";
    for (const ch of text) {
      out += stepGate(g, ch, render);
      if (g.held.length > MAX_HELD) {
        out += g.held;
        resetGate(g);
      }
    }
    return out;
  };

  return {
    push,
    flush: () => {
      const tail = g.held;
      resetGate(g);
      return tail;
    },
  };
}

// Pipe a runChat event stream through a link gate: token text is gated,
// `clear` drops the held buffer along with the client's answer buffer, and
// the held tail is flushed as a final token before done so the streamed view
// stays complete even when the answer is cut off mid-link.
export async function* gatedChat(events: AsyncIterable<ChatEvent>, makeGate: () => LinkGate): AsyncGenerator<ChatEvent> {
  let gate = makeGate();
  for await (const ev of events) {
    if (ev.type === "token") {
      const text = gate.push(ev.text);
      if (text) yield { type: "token", text };
    } else if (ev.type === "clear") {
      gate = makeGate();
      yield ev;
    } else if (ev.type === "done") {
      const tail = gate.flush();
      if (tail) yield { type: "token", text: tail };
      yield ev;
    } else {
      yield ev;
    }
  }
}
