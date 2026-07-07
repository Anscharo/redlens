import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rubricRaw from "../../../docs/risk-assessment-rubric.md?raw";
import { Link } from "../Link";
import { ROUTES } from "../../lib/routes";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

// .atlas-md is tuned for atlas node bodies, which carry no headings — map the
// rubric's heading levels to the same treatment report pages use.
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
};

// The exact rubric the risk-rules assessment pipeline scores against
// (docs/risk-assessment-rubric.md, bundled at build time). The report header
// links here from its "rubric <hash>" provenance token.
export function RubricPage() {
  useDocumentTitle("Risk Assessment Rubric: Sky Atlas by Redline");
  return (
    <div className="px-6 py-6">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">
          <Link to={ROUTES.REPORTS_RISK_RULES} className="text-accent hover:underline">
            risk rules assessment
          </Link>
          {" · rubric"}
        </p>
        <div className="atlas-md text-sm text-tan-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{rubricRaw}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
