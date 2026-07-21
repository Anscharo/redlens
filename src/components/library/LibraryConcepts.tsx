import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import conceptsRaw from "../../../docs/library/concepts.md?raw";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// The concept catalog is curated research (docs/library/concepts.md), bundled
// at build time like the risk rubric — it ships with deploys, not atlas
// commits. Inline code spans holding FULL UUIDs become reader deep-links; the
// catalog's short-form pointers (`9db14ab7`) and doc_nos stay plain code (the
// reader's ?id= resolves UUIDs only — a doc_no resolver would need the whole
// atlas bundle loaded here).
const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--tan)" }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mt-8 mb-3 pb-1 border-b border-[var(--border)]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-5 mb-2" style={{ color: "var(--tan)" }}>{children}</h3>
  ),
  code: ({ children }) => {
    const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
    const t = text.trim();
    if (UUID_RE.test(t)) {
      return (
        <Link to={atlasHref(t)} className="mono text-xs link-accent" title={t}>
          {t.slice(0, 8)}
        </Link>
      );
    }
    return <code>{children}</code>;
  },
};

export function LibraryConcepts() {
  return (
    <div className="atlas-md text-sm text-tan-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{conceptsRaw}</ReactMarkdown>
    </div>
  );
}
