// Data and filter state behind PauAuditReport.tsx: the audit rows, the
// URL-synced Group and Prime filters, the header search, and each document's
// number for display. A load failure reaches the route's error boundary.
import { useCallback, useMemo } from "react";
import { urlString } from "../../hooks/useUrlState";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadDocs } from "../../lib/docs";
import { AUDIT_GROUPS, auditItemCount, auditSearchFields, loadPauAudit, type AuditGroup, type AuditRow } from "../../lib/pauAudit";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const groupCodec = urlString(null);
const primeCodec = urlString(null);
const GROUP_KEYS: AuditGroup[] = AUDIT_GROUPS.map((g) => g.key);

/** Items per group, among rows already narrowed by the other filters. */
function groupCounts(rows: AuditRow[]): Partial<Record<AuditGroup, number>> {
  return Object.fromEntries(GROUP_KEYS.map((g) => [g, auditItemCount(rows.filter((r) => r.group === g))]));
}

export function usePauAuditState(report: ReportId, query: string, mode: ReportMode) {
  const loaded = useLoaded(loadPauAudit);
  const docs = useLoaded(loadDocs, { soft: true });
  const rows = useMemo(() => loaded ?? [], [loaded]);
  const [groupParam, toggleGroup] = useReportFilter(report, "group", groupCodec);
  const group = GROUP_KEYS.find((g) => g === groupParam) ?? null;
  const [prime, togglePrime] = useReportFilter(report, "prime", primeCodec);
  const docNo = useCallback((id: string | null) => (id ? (docs?.[id]?.doc_no ?? "") : ""), [docs]);
  const primes = useMemo(() => [...new Set(rows.map((r) => r.prime))].sort(), [rows]);
  const byPrime = useMemo(() => rows.filter((r) => !prime || r.prime === prime), [rows, prime]);
  const filtered = useMemo(() => byPrime.filter((r) => !group || r.group === group), [byPrime, group]);
  const rq = useReportQuery(query, mode);
  const shown = useMemo(() => filterRows(filtered, rq, (r) => auditSearchFields(r, docNo(r.docId))), [filtered, rq, docNo]);
  const pills = { group, onGroup: toggleGroup, counts: groupCounts(byPrime), primes, prime, onPrime: togglePrime };
  return { loading: loaded === null, rows, shown, rq, docNo, pills, filters: [group, prime] };
}
