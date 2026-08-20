// Types for report-citations.mjs — the citation gate is plain ESM JS (the
// Notion publisher and `pnpm cite:check` both import it), so the tests and any
// TypeScript caller need this sidecar. See CLAUDE.md "Citation dictate".

export interface ReportClaim {
  lineNo: number;
  text: string;
  cited: boolean;
  via: "inline" | "footnote" | "quote-attribution" | "none";
}

export interface UncitedClaim {
  lineNo: number;
  text: string;
}

export declare function hasCitation(text: string): boolean;
export declare function isNormativeClaim(line: string): boolean;
export declare function analyzeReportCitations(markdown: string): {
  claims: ReportClaim[];
  uncited: UncitedClaim[];
};
export declare function formatUncited(uncited: UncitedClaim[], label?: string): string;
