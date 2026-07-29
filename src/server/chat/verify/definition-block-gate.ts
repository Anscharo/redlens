// Reference-style citation streaming gate (docs/plans/reference-citations.md,
// "stream-link-gate.ts"). A reference answer opens with a small definition block
// (`[label]: /atlas/<uuid>` per line); its UUIDs are the ones a small model
// garbles. This gate BUFFERS that leading block, repairs the whole citation
// table once (repairDefinitionBlock via the shared LinkJudge), releases the
// repaired block, then streams prose through the ordinary per-link inline gate
// (createLinkGate) — so a garbled definition never flashes as a live dead link,
// and `[text][label]` uses in prose need no per-link gating because their
// targets were validated up front. Anything that is not a top definition block
// (inline-only answers, a bottom block, prose-first) degrades to the plain
// inline gate, which passes `[label]: /atlas/…` lines through untouched.
import { createLinkGate, type LinkGate } from "./stream-link-gate.ts";

// A complete definition line: ≤3 leading spaces, `[label]:`, an /atlas/ dest.
// Restricted to /atlas/ so a stray CommonMark ref-def to some URL isn't buffered.
const DEF = /^ {0,3}\[[^[\]\n]{1,120}\]:\s*<?\/atlas\//;

// A definition block is small; never hold prose indefinitely waiting for a line
// break that a single-line answer will never send.
const MAX_PRELUDE = 4000;

// Could the buffered partial (no newline yet) still BECOME a definition line?
// True for leading whitespace, mid-label `[…` with no `]` yet, or `[label]`
// immediately followed by `:` (or nothing yet). An inline link (`[t](`), a
// reference use (`[t][`), or `[label] ` with a space all diverge → false, so
// those route to the inline gate promptly instead of stalling to end-of-stream.
function couldBeDef(s: string): boolean {
  if (/^\s*$/.test(s)) return true;
  const m = /^ {0,3}\[[^[\]\n]{0,120}(\]?)([^\n]?)/.exec(s);
  if (!m) return false; // not `[`-led
  if (m[1] === "") return true; // `]` not seen yet — still inside the label
  return m[2] === "" || m[2] === ":";
}

export function createCitationGate(opts: {
  render: (title: string, target: string, raw: string) => string;
  repairBlock: (block: string) => string;
}): LinkGate {
  const inner = createLinkGate(opts.render);
  let phase: "prelude" | "block" | "prose" = "prelude";
  let buf = ""; // unprocessed text while in prelude/block
  let blockLines: string[] = []; // collected definition lines (no trailing "\n")

  // Emit the repaired block; the terminator line that ended it stays in `buf`.
  const releaseBlock = (): string => {
    const out = blockLines.length ? opts.repairBlock(blockLines.join("\n")) + "\n" : "";
    blockLines = [];
    return out;
  };

  const push = (text: string): string => {
    if (phase === "prose") return inner.push(text);
    buf += text;
    let out = "";
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl === -1) {
        // No complete line yet: bail to prose the moment the partial can't be a
        // definition, or once the hold grows unreasonable.
        if ((phase === "prelude" && buf && !couldBeDef(buf)) || buf.length > MAX_PRELUDE) {
          if (phase === "block") out += releaseBlock();
          phase = "prose";
          out += inner.push(buf);
          buf = "";
        }
        break;
      }
      const line = buf.slice(0, nl);
      if (phase === "prelude") {
        if (line.trim() === "") {
          out += buf.slice(0, nl + 1); // leading blank line — pass straight through
          buf = buf.slice(nl + 1);
          continue;
        }
        if (DEF.test(line)) {
          phase = "block";
          blockLines.push(line);
          buf = buf.slice(nl + 1);
          continue;
        }
        phase = "prose"; // first real line isn't a definition — no top block
        out += inner.push(buf);
        buf = "";
        break;
      }
      // phase === "block"
      if (DEF.test(line)) {
        blockLines.push(line);
        buf = buf.slice(nl + 1);
        continue;
      }
      out += releaseBlock(); // terminator (blank or prose) stays in buf
      phase = "prose";
      out += inner.push(buf);
      buf = "";
      break;
    }
    return out;
  };

  return {
    push,
    flush: () => {
      // A single definition-only line that never got a terminating newline.
      if (phase === "prelude" && buf.trim() !== "" && DEF.test(buf)) {
        phase = "block";
        blockLines.push(buf);
        buf = "";
      }
      if (phase === "block") {
        // A final definition line missing only its newline (block ran to EOS).
        if (buf.trim() !== "" && DEF.test(buf)) {
          blockLines.push(buf);
          buf = "";
        }
        let out = blockLines.length ? opts.repairBlock(blockLines.join("\n")) : "";
        blockLines = [];
        // Any non-def remainder is prose — gate it, don't dump it raw.
        return out + inner.push(buf) + inner.flush();
      }
      // prose: nothing is buffered here. prelude: a partial first line, raw.
      return buf + inner.flush();
    },
  };
}
