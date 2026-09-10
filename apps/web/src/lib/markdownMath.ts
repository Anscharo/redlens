// Shared LaTeX-in-markdown pipeline for every renderer that shows atlas
// content: the atlas reader (NodeContentInner.tsx) and the chat panel
// (chat/markdown.tsx). Both must treat `$…$` / `$$…$$` the same way the atlas
// itself does, so a formula quoted verbatim from a document (e.g. A.3.2.2.1.1.1.1.1.5's
// `$$\text{RRC} = K \times \frac{1}{CR} \times \text{EAD} \times \text{ECR}$$`)
// renders identically wherever it appears. This module owns only the parts
// that must be identical everywhere: the "does this text contain math at
// all" test, the KaTeX render-safety options, and the lazy dynamic import
// (cached once at module scope so the reader and chat share a single KaTeX
// chunk fetch instead of loading it twice). Each renderer still assembles its
// own final remark/rehype plugin arrays, since they differ (the reader also
// linkifies on-chain addresses; chat doesn't).
//
// remarkDeMathProse (mathGuard.ts) is the render-time guard: remark-math will
// happily parse a currency run like `$100k direct exposure | … | L$` as one
// inline-math span, so every consumer of mathRemarkPlugins() gets the guard
// applied after remark-math, not just the reader.
import { remarkDeMathProse } from "./mathGuard";

// A document/message "has math" only if it contains a genuine LaTeX
// delimiter: `$$` (display), or `$` immediately followed by a non-space,
// non-`$` character (inline). This is a cheap pre-check to decide whether to
// pay for the KaTeX import at all — it is deliberately coarse (plain prose
// like "$5,000 and $20" has no `$` followed by a `$`-closed span, so it never
// matches) and is NOT the guard against false-positive math: remarkDeMathProse
// still runs on whatever remark-math actually parses.
export const MATH_RE = /\$\$|\$[^$\s]/;

// KaTeX renders synchronously, so a wall-clock timeout isn't possible — these
// bound the work instead: maxExpand kills macro-expansion bombs (\def
// chains), maxSize caps glyphs at 50em (no viewport-filling rules from
// hostile content). Render errors stay inline (errorColor) rather than
// throwing; anything that still throws must be caught by the caller (the
// reader wraps nodes in an ErrorBoundary).
export const KATEX_OPTIONS = { maxExpand: 1000, maxSize: 50, errorColor: "var(--red)" };

export interface MathPlugins {
  remarkMath: any;
  rehypeKatex: any;
}

let mathPluginsPromise: Promise<MathPlugins> | null = null;

// Lazy-load remark-math + rehype-katex + KaTeX's stylesheet. Cached at module
// scope so every renderer on the page shares one dynamic import instead of
// fetching the KaTeX chunk once per component. A rejected import (e.g. a
// stale chunk URL right after a redeploy) is NOT cached — the promise is
// cleared so the next math-bearing node/message retries instead of awaiting
// a dead promise forever.
export function loadMathPlugins(): Promise<MathPlugins> {
  if (!mathPluginsPromise) {
    mathPluginsPromise = Promise.all([
      import("rehype-katex"),
      import("remark-math"),
      import("katex/dist/katex.min.css"),
    ])
      .then(([rehypeKatexMod, remarkMathMod]) => ({
        remarkMath: remarkMathMod.default,
        rehypeKatex: rehypeKatexMod.default,
      }))
      .catch((err) => {
        mathPluginsPromise = null;
        throw err;
      });
  }
  return mathPluginsPromise;
}

// remark plugins for math-aware content, in the order that matters:
// remark-math first (parses `$…$`/`$$…$$` into math nodes), then
// remarkDeMathProse (reclassifies the ones that are actually prose/currency
// back to literal text). Spread these alongside remarkGfm in the caller's
// array — order relative to GFM doesn't matter.
export function mathRemarkPlugins(remarkMath: unknown): unknown[] {
  return [remarkMath, remarkDeMathProse];
}

// rehype plugin entry (a [plugin, options] tuple, react-markdown's shape for
// a configured plugin) that renders surviving math nodes with KaTeX, bounded
// by KATEX_OPTIONS. Splice this into the caller's rehype plugin array
// alongside whatever else it needs (address linkification, highlight marks).
export function mathRehypePlugin(rehypeKatex: unknown): [unknown, typeof KATEX_OPTIONS] {
  return [rehypeKatex, KATEX_OPTIONS];
}
