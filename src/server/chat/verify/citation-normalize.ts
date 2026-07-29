// Reference-style citation normalization (docs/plans/reference-citations.md).
// The entire checking layer — CITATION_SRC, extractCitations, findBareAtlasLinks,
// findDocNoMismatches, MD_LINK_SRC, normalizeForMatch, findUngroundedQuotes,
// findLowOverlapCitations, repairCitations — keys on the INLINE citation shape
// `[text](/atlas/<uuid>)`. Rather than teach each of them markdown reference
// links, one pure pass expands them into that canonical shape and runs first.
//
// It also repairs the two malformed shapes measured in the model bakeoff (both
// render as visible literal brackets today): a comma-separated label list, and
// a bare shortcut bracket with no label at all.
//
// Inline-only answers — everything today's prompt produces — come back
// BYTE-IDENTICAL, and the pass is idempotent: expanding twice changes nothing.

export interface ReferenceExpansion {
  content: string;
  // Normalized label → destination exactly as declared (never repaired here).
  // The label is the only surviving carrier of the model's own handle for a
  // doc once the definition line is gone, so it is returned even though
  // nothing consumes it yet — repair's label matching is a later wave.
  definitions: Map<string, string>;
  undefinedLabels: string[];
  unusedLabels: string[];
}

// A CommonMark link-reference definition: up to 3 leading spaces, a label, ":",
// a whitespace-free destination, an optional title. The destination is
// restricted to URL-ish forms (/path, #anchor, scheme:) so an ordinary prose
// line like `[note]: draft` is never mistaken for a definition and deleted.
const DEF_RE =
  /^ {0,3}\[([^[\]\n]{1,120})\]:\s*(<[^>\s]*>|(?:\/|#|[a-z][a-z0-9+.-]*:)\S*)\s*(?:"[^"]*"|'[^']*'|\([^)\s]*\))?\s*$/i;

// One bracket span, optionally followed by a second: [text], [text][label],
// [text][]. Bounded to a single line and 120 chars exactly like verify-checks'
// MD_LINK_SRC — an unbounded [^\]]+ runs across newlines and swallows real
// prose until some later "]".
const REF_RE = /\[([^[\]\n]{1,120})\](?:\[([^[\]\n]{0,200})\])?/g;

const FENCE_RE = /^ {0,3}(?:```|~~~)/;

// CommonMark matches labels case-insensitively with whitespace collapsed.
const normLabel = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

// A bracket span with no label at all — `a range of [20 percentage points]
// applies`, emitted by the default-tier model in 2 of 3 measured runs. It
// renders as literal brackets, so it must not ship; but brackets are load-
// bearing elsewhere, so unbracketing is deliberately narrow:
//   - only where reference style is in play at all (see `refMode`);
//   - only multi-token prose, so `[E1]`, `[sic]`, `[A.1.6]`, `[^1]` footnotes
//     and `[ ]`/`[x]` task markers all survive;
//   - never inside a blockquote or a double-quoted run — that is where
//     editorial insertions live, and verify-checks' quoteSegments already
//     excises them. Unbracketing one there would splice "emphasis added" into
//     the quoted text and manufacture an ungrounded-quote HARD failure.
function strippable(text: string, line: string, offset: number): boolean {
  if (/^\s*>/.test(line)) return false;
  if (text.startsWith("^")) return false;
  if (!/\S\s+\S/.test(text)) return false;
  const quotes = line.slice(0, offset).match(/["“”]/g)?.length ?? 0;
  return quotes % 2 === 0;
}

interface ExpandCtx {
  defs: Map<string, string>;
  used: Set<string>;
  undef: string[];
  refMode: boolean;
  // Undefined-label degradation: resolve a used-but-undeclared label to an
  // /atlas/<uuid> href (docs retrieved this turn, else the atlas). Injected by
  // the orchestrator; absent in the pure/no-index path, which strips instead.
  resolve?: (label: string) => string | null;
}

function expandLine(line: string, ctx: ExpandCtx): string {
  return line.replace(REF_RE, (m: string, text: string, label: string | undefined, offset: number) => {
    // `undefined` = no second bracket (shortcut ref, or an inline link's text);
    // `""` = a collapsed ref `[foo][]`. They diverge when unresolved, so the
    // distinction cannot be collapsed to a falsy check.
    const shortcut = label === undefined;
    if (shortcut && line[offset + m.length] === "(") return m; // inline link — untouched
    const key = shortcut || label.trim() === "" ? normLabel(text) : normLabel(label);
    // Multi-label list `[text][a, b]` — not valid CommonMark, renders literally.
    // Split only when EVERY part resolves; a partial list is an undefined label.
    const parts = key.split(",").map((p) => p.trim()).filter(Boolean);
    const multi = parts.length > 1 && parts.every((p) => ctx.defs.has(p));
    const hrefs = multi ? parts.map((p) => ctx.defs.get(p)!) : ctx.defs.has(key) ? [ctx.defs.get(key)!] : null;
    if (hrefs) {
      for (const p of multi ? parts : [key]) ctx.used.add(p);
      // Consecutive links carrying the same text: byte-for-byte what a
      // prompt-compliant model writes when told "one label per citation, cite
      // twice for two sources", so downstream sees nothing novel.
      return hrefs.map((h) => `[${text}](${h})`).join(" ");
    }
    // A used-but-undeclared label must never ship as raw brackets. First try to
    // resolve it against the docs retrieved this turn (undefined-label
    // degradation): a unique match synthesizes the missing definition as an
    // inline link. Otherwise drop to plain text and report it as a hard failure.
    if (!shortcut) {
      const href = ctx.resolve?.(key);
      if (href) return `[${text}](${href})`;
      ctx.undef.push(key);
      return text;
    }
    return ctx.refMode && strippable(text, line, offset) ? text : m;
  });
}

export function expandReferenceLinks(answer: string, resolve?: (label: string) => string | null): ReferenceExpansion {
  const lines = answer.split("\n");
  const definitions = new Map<string, string>();
  const declared: string[] = []; // normalized labels, declaration order
  const isDef: boolean[] = [];

  // Pass 1 — collect definitions. They are normally a block at the top, but
  // CommonMark allows them anywhere and a bottom block is an accepted
  // degradation, so the whole answer is scanned. Fenced code is skipped: this
  // bot answers questions about markdown syntax.
  let fence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) fence = !fence;
    const m = fence ? null : DEF_RE.exec(line);
    isDef.push(m !== null);
    if (!m) continue;
    const key = normLabel(m[1]);
    if (definitions.has(key)) continue; // first definition wins, per CommonMark
    definitions.set(key, m[2].replace(/^<|>$/g, ""));
    declared.push(key);
  }

  // Pass 2 — expand uses and drop the definition lines (remark strips them
  // when rendering, so the checking layer must not see them as prose either).
  const ctx: ExpandCtx = { defs: definitions, used: new Set(), undef: [], refMode: definitions.size > 0, resolve };
  const out: string[] = [];
  fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) fence = !fence;
    if (isDef[i]) continue;
    out.push(fence ? lines[i] : expandLine(lines[i], ctx));
  }

  let content = out.join("\n");
  // Blank-line cleanup ONLY where definition lines were removed — an
  // inline-only answer must come back byte-identical.
  if (isDef.some(Boolean)) content = content.replace(/^[ \t]*\n+/, "").replace(/\n{3,}/g, "\n\n").replace(/\n\s*$/, "");
  return {
    content,
    definitions,
    undefinedLabels: [...new Set(ctx.undef)],
    unusedLabels: declared.filter((k) => !ctx.used.has(k)),
  };
}
