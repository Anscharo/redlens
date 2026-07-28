// react-markdown `components` map for LibraryMarkdown.tsx — split out to keep
// that file under the ~150-line convention. Every atlas document reference
// (full UUID / short 8-hex pointer in a code span, bare doc_no in plain text)
// becomes a reader deep-link via rehypeDocRefs.ts, "DOC_NO • Truncated Title".
// Resolution needs the docs bundle; until it resolves (or if it fails to
// load) `code` falls back to the old full-uuid-only behavior.
import type { Components } from "react-markdown";
import type { Element as HastElement } from "hast";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";
import { FULL_UUID_RE, type DocRefResolver } from "../../lib/docRefResolver";

// A per-concept unit-opener paragraph starts with a bold "<Group> <N> ·
// <Title>" run (e.g. "**Lifecycle 7 · Omni Documents**") — distinct from a
// list item's bold field label ("**Definition**", "**Detection signature**"),
// which never carries a number + middot.
const UNIT_OPENER_RE = /^[A-Za-z][\w\s]*\d+\s*·/;

function hastText(node: HastElement): string {
  let out = "";
  for (const child of node.children) {
    if (child.type === "text") out += child.value;
    else if (child.type === "element") out += hastText(child);
  }
  return out;
}

const baseComponents: Omit<Components, "a" | "code"> = {
  h1: ({ children }) => (
    <h1 className="text-3xl font-semibold mt-2 mb-4" style={{ color: "var(--tan)" }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold mt-14 mb-3 pb-2 border-b border-[var(--border)]" style={{ color: "var(--tan)" }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold mt-10 mb-2" style={{ color: "var(--tan)" }}>{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-4 mb-1" style={{ color: "var(--tan-2)" }}>{children}</h4>
  ),
  p: ({ node, children }) => {
    const first = node?.children[0];
    const isUnitOpener = !!first && first.type === "element" && first.tagName === "strong" && UNIT_OPENER_RE.test(hastText(first));
    return <p className={isUnitOpener ? "unit-opener" : undefined}>{children}</p>;
  },
};

// `a` handles the hrefs rehypeDocRefs emits (always internal, "/atlas?id=…")
// via the app's client-side Link; any other href (none today, but markdown
// could grow one) falls through to a plain anchor.
// `code`: once a resolver has loaded, rehypeDocRefs has already replaced every
// resolving code span with a link pre-render, so anything still a `code`
// element here is a non-matching span (plain code, or an unresolved pointer)
// and renders as-is.
export function buildComponents(resolver: DocRefResolver | null): Components {
  return {
    ...baseComponents,
    a: ({ href, className, title, children }) =>
      href?.startsWith("/") ? (
        <Link to={href} className={className} title={title}>{children}</Link>
      ) : (
        <a href={href} className={className} title={title}>{children}</a>
      ),
    code: ({ children }) => {
      if (resolver) return <code>{children}</code>;
      const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
      const t = text.trim();
      if (FULL_UUID_RE.test(t)) {
        return (
          <Link to={atlasHref(t)} className="mono text-xs link-accent" title={t}>
            {t.slice(0, 8)}
          </Link>
        );
      }
      return <code>{children}</code>;
    },
  };
}
