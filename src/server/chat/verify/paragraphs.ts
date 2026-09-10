// Paragraph segmentation for the incremental verification stream
// (incremental.ts, docs/chat-system.md §6). Buffers streamed token text and
// reports each paragraph the moment it closes at a blank line — never inside
// a fenced code block — and separately collects reference-style
// link-definition lines (`[label]: /atlas/<uuid>`) so they never ship as a
// "paragraph" of their own; incremental.ts folds them back in for
// `[text][label]` expansion.
//
// A definition line is only recognised at the START of a paragraph (no prose
// collected yet since the last blank line) — the same place CommonMark allows
// one: a reference definition cannot interrupt a paragraph already begun.

// Mirrors citation-normalize.ts's (unexported) DEF_RE: up to 3 leading spaces,
// a bracketed label, ":", a whitespace-free URL-ish destination, an optional
// title.
const DEF_RE =
  /^ {0,3}\[([^[\]\n]{1,120})\]:\s*(<[^>\s]*>|(?:\/|#|[a-z][a-z0-9+.-]*:)\S*)\s*(?:"[^"]*"|'[^']*'|\([^)\s]*\))?\s*$/i;

const FENCE_RE = /^ {0,3}(?:```|~~~)/;

export interface ParagraphSegmenter {
  /** Feed streamed text; returns every paragraph that closed as a result (usually 0 or 1). */
  push(text: string): string[];
  /** End of stream: the trailing unterminated paragraph, once, or null if there is none. */
  flush(): string | null;
  /** Accumulated reference-style definition lines seen so far, joined by "\n". */
  definitions(): string;
  reset(): void;
}

export function createParagraphSegmenter(): ParagraphSegmenter {
  let buf = ""; // text since the last complete line
  let fence = false; // inside a ``` or ~~~ fenced block
  let defs: string[] = [];
  let pending: string[] = []; // lines of the paragraph in progress

  function closePending(out: string[]) {
    const text = pending.join("\n").trim();
    pending = [];
    if (text) out.push(text);
  }

  function consumeLine(line: string, out: string[]) {
    if (FENCE_RE.test(line)) {
      fence = !fence;
      pending.push(line);
      return;
    }
    if (!fence && line.trim() === "") {
      closePending(out);
      return;
    }
    if (!fence && pending.length === 0 && DEF_RE.test(line)) {
      defs.push(line);
      return;
    }
    pending.push(line);
  }

  return {
    push(text: string): string[] {
      buf += text;
      const out: string[] = [];
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        consumeLine(buf.slice(0, nl), out);
        buf = buf.slice(nl + 1);
      }
      return out;
    },
    flush(): string | null {
      const out: string[] = [];
      if (buf) {
        consumeLine(buf, out);
        buf = "";
      }
      closePending(out);
      return out[0] ?? null; // at most one trailing paragraph
    },
    definitions: () => defs.join("\n"),
    reset() {
      buf = "";
      fence = false;
      defs = [];
      pending = [];
    },
  };
}
