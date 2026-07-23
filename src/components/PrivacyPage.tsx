import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import privacyRaw from "../../PRIVACY.md?raw";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

// Renders the repo-root PRIVACY.md (bundled at build time via ?raw) so there is
// a single source of truth: edit the markdown, the page updates. Served at
// /privacy — the public URL pasted into the Google/GitHub OAuth consent screens.
// Heading/link/list treatment mirrors RubricPage (the other prose-markdown page).
const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--tan)" }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold mt-8 mb-3" style={{ color: "var(--tan)" }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-5 mb-2" style={{ color: "var(--tan)" }}>{children}</h3>
  ),
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1.5">{children}</ul>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} className="text-accent hover:underline">{children}</a>
  ),
  hr: () => <hr className="my-6 border-[var(--border)]" />,
  strong: ({ children }) => <strong style={{ color: "var(--tan)" }}>{children}</strong>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="text-left px-3 py-1.5 border-b border-[var(--border)] font-semibold" style={{ color: "var(--tan)" }}>
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-1.5 border-b border-[var(--border)] align-top">{children}</td>,
};

export function PrivacyPage() {
  useDocumentTitle("Privacy Policy: Sky Atlas by Redline");
  return (
    <main className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto atlas-md text-sm text-tan-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{privacyRaw}</ReactMarkdown>
      </div>
    </main>
  );
}
