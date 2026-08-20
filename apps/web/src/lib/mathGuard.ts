// The atlas is authored in markdown and genuinely uses `$…$` / `$$…$$` for math
// (Black-Scholes PD formulas, reward formulas, `$20\%$`, single-symbol variables
// like `$d_1$`). But a `$` also appears as currency, and remark-math will happily
// consume a run like `$100k direct exposure | … | L$` (a table row) as one inline
// math span, garbling it. The source is immutable, so we discriminate at render
// time: after remark-math has parsed the spans, turn any inline-math node that is
// actually prose back into literal text. Genuine math passes through to KaTeX.
//
// Validated against the full atlas: this reclassifies exactly the one currency
// table span and leaves all ~191 genuine inline-math spans untouched.

// A span with any LaTeX/math indicator (backslash command, sub/superscript,
// braces, `=`) is always genuine math — never reclassified.
function hasMathIndicator(value: string): boolean {
  return /[\\^_{}=]/.test(value);
}

// A currency magnitude token — `100k`, `1M`, `5bn` — which appears in accidental
// spans like `$100k-1M$` (a range) or `$100k direct exposure | … $` (a table).
const CURRENCY_MAGNITUDE = /\d\s*(k|m|bn|mm|M|K|B)\b/;

// True when an inline-math span's inner value is actually prose/currency rather
// than math. LaTeX-bearing spans are always math; then currency magnitudes,
// table pipes, and long real-word runs read as prose. Everything else (a bare
// symbol/acronym/number like `$PD$`, `$a$`, `$N$`) stays math.
export function isProseValue(value: string): boolean {
  if (hasMathIndicator(value)) return false;
  if (CURRENCY_MAGNITUDE.test(value)) return true;
  if (value.includes("|")) return true;
  return /[A-Za-z]{4,}/.test(value) && value.length > 15;
}

export function isMathValue(value: string): boolean {
  return !isProseValue(value);
}

// Minimal mdast node shape we touch — remark-math emits `inlineMath` (and `math`
// for display) nodes with a `value` string.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

// remark plugin: place AFTER remarkMath. Only inline math is reconsidered —
// display `$$…$$` is essentially always intentional. A prose inline-math node
// becomes a literal `$value$` text node.
export function remarkDeMathProse() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child.type === "inlineMath" && typeof child.value === "string" && isProseValue(child.value)) {
          return { type: "text", value: `$${child.value}$` };
        }
        walk(child);
        return child;
      });
    };
    walk(tree);
  };
}
