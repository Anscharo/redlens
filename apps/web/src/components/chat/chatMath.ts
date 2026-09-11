// Chat-local wiring around the shared LaTeX pipeline (../../lib/markdownMath.ts):
// lazy-loads KaTeX only once a message actually contains math, and the
// mid-stream $$ balancing balanceFences() (markdown.tsx) needs to keep a
// half-open display-math block from swallowing later paragraphs. Split out of
// markdown.tsx to keep that file under the ~150-line convention.
import { useEffect, useState } from "react";
import remarkGfm from "remark-gfm";
import { MATH_RE, loadMathPlugins, mathRemarkPlugins, mathRehypePlugin } from "../../lib/markdownMath";

// Module-scope assembled plugin arrays, populated once the shared KaTeX
// import resolves — mirrors the pattern in ../NodeContentInner.tsx; the
// dynamic import itself is shared between both renderers via
// loadMathPlugins()'s own module-scope cache, so only one KaTeX chunk fetch
// ever happens per page regardless of which renderer needs it first.
let remarkPluginsMath: any[] | null = null;
let rehypePluginsMath: any[] | null = null;
let katexReadyPromise: Promise<void> | null = null;

function loadKatex(): Promise<void> {
  if (!katexReadyPromise) {
    katexReadyPromise = loadMathPlugins()
      .then(({ remarkMath, rehypeKatex }) => {
        remarkPluginsMath = [remarkGfm, ...mathRemarkPlugins(remarkMath)];
        rehypePluginsMath = [mathRehypePlugin(rehypeKatex)];
      })
      .catch((err) => {
        // A rejected dynamic import (e.g. a stale chunk URL right after a
        // redeploy) must not be cached forever — clear it so the next
        // math-bearing message retries instead of awaiting a dead promise.
        katexReadyPromise = null;
        throw err;
      });
  }
  return katexReadyPromise;
}

// Plugin arrays to pass to ReactMarkdown: math-aware once KaTeX has
// lazy-loaded, otherwise plain remarkGfm (a message with no math delimiter
// never pays for the import at all).
export function useMathPlugins(content: string): {
  remarkPlugins: any[];
  rehypePlugins: any[] | undefined;
} {
  const hasMath = MATH_RE.test(content);
  const [katexReady, setKatexReady] = useState(!!rehypePluginsMath);

  // Guarded on `katexReady`, NOT on the module cache: an instance that
  // mounted math-free before the cache was populated, and gains math after
  // some OTHER instance finished the load, would skip a module-cache guard
  // and keep rendering raw $$ forever. loadKatex() returns its resolved
  // promise in that case, so the extra call costs nothing.
  useEffect(() => {
    if (hasMath && !katexReady) {
      loadKatex()
        .then(() => setKatexReady(true))
        .catch(() => {
          // Leave katexReady false — the raw $...$ delimiters still render as
          // plain text, and a later message with math will retry the import.
        });
    }
  }, [hasMath, katexReady]);

  const usesMath = hasMath && katexReady;
  return {
    remarkPlugins: usesMath ? remarkPluginsMath! : [remarkGfm],
    rehypePlugins: usesMath ? rehypePluginsMath! : undefined,
  };
}

// A half-open $$ display-math block consumes every paragraph the model
// streams in afterward (including their citation links) as literal TeX
// source, rendering each character as its own math glyph — the same failure
// mode balanceFences already guards against for ``` code fences, but worse.
// Unlike a code fence, appending the closer at the very end doesn't help:
// remark-math already treats an unterminated $$ at the true end of the
// buffer as implicitly closed there, so a synthetic closer at the end
// changes nothing while trailing prose is still in the buffer. Instead,
// close it right after the math content: at the first blank line (paragraph
// break) following the open $$, which is where the model's own prose
// resumes. If no blank line has streamed in yet (still mid-formula), fall
// back to the end — same as leaving it for remark-math's own EOF handling,
// and KaTeX renders an incomplete formula as an inline error rather than
// throwing (see markdownMath.ts's KATEX_OPTIONS).
export function closeOpenMathFence(text: string): string {
  const fences = (text.match(/\$\$/g) ?? []).length;
  if (fences % 2 === 0) return text;
  const openAt = text.lastIndexOf("$$") + 2;
  const breakAt = text.indexOf("\n\n", openAt);
  if (breakAt === -1) return `${text}\n$$`;
  return `${text.slice(0, breakAt)}\n$$${text.slice(breakAt)}`;
}
