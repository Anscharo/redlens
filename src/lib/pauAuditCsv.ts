// The PAU values audit report's search and CSV (rows: pauAuditIndex.ts). Each
// CSV row cites one atlas document by UUID and link; a row with no document
// (a controller the registry found on chain) leaves them empty. Pure.
import { toCSV } from "./csv.ts";
import { AUDIT_GROUPS } from "./pauAudit.ts";
import type { AuditRow } from "./pauAuditIndex.ts";
import { routesText } from "./pauRouteText.ts";
import { stepText } from "./pauStepText.ts";
import type { SearchField } from "./reportFilter.ts";
import { atlasUrlOrEmpty } from "./routes.ts";

const GROUP_LABEL = new Map<string, string>(AUDIT_GROUPS.map((g) => [g.key, g.label]));

/** The fields the report's search box matches: everything the table shows, plus the key and contract. */
export const auditSearchFields = (r: AuditRow, docNo: string): SearchField[] => [
  { label: "prime", value: r.prime, despace: true },
  { label: "chain", value: r.chain },
  { label: "subject", value: r.subject },
  { label: "value", value: r.label },
  { label: "atlas", value: r.stated },
  { label: "chain value", value: r.onchain },
  { label: "why", value: r.note },
  { label: "on-chain step", value: r.step ? stepText(r.step) : "" },
  { label: "group", value: GROUP_LABEL.get(r.group) ?? "", hidden: true },
  { label: "doc no", value: docNo },
  { label: "key", value: r.key ?? "", hidden: true },
  { label: "contract", value: r.contract ?? "", hidden: true },
];

const HEADERS = [
  "Group", "Reason", "Prime", "Chain", "Generation", "Subject", "Value", "Atlas states", "Chain holds",
  "Chain last set", "Atlas last changed", "On-chain step", "Who can set it", "Key", "Contract", "Doc No", "UUID", "Atlas Link",
];

/** The rows as CSV; `docNo` resolves a document's number for display only. */
export function auditRowsToCSV(rows: AuditRow[], docNo: (id: string) => string): string {
  return toCSV(
    HEADERS,
    rows.map((r) => [
      GROUP_LABEL.get(r.group), r.note, r.prime, r.chain, r.kind, r.subject, r.label, r.stated, r.onchain,
      r.chainSetAt, r.atlasChangedAt, r.step ? stepText(r.step) : "", r.routes ? routesText(r.routes) : "", r.key, r.contract, r.docId ? docNo(r.docId) : "", r.docId ?? "", atlasUrlOrEmpty(r.docId),
    ]),
  );
}
