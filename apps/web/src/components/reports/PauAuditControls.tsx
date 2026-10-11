// Group/Prime pill groups and the CSV export for the PAU Values Needing Audit report.
import { AUDIT_GROUPS, auditRowsToCSV, type AuditGroup, type AuditRow } from "../../lib/pauAudit";
import type { ReportId } from "@/types";
import { CategoryPills } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";

const GROUP_KEYS: AuditGroup[] = AUDIT_GROUPS.map((g) => g.key);
const GROUP_DISPLAY = Object.fromEntries(AUDIT_GROUPS.map((g) => [g.key, g.label])) as Record<AuditGroup, string>;

interface ControlsProps {
  group: AuditGroup | null;
  onGroup: (next: AuditGroup) => void;
  counts: Partial<Record<AuditGroup, number>>;
  primes: string[];
  prime: string | null;
  onPrime: (next: string) => void;
}

export function PauAuditControls({ group, onGroup, counts, primes, prime, onPrime }: ControlsProps) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <CategoryPills label="Group" categories={GROUP_KEYS} active={group} onToggle={onGroup} display={GROUP_DISPLAY} counts={counts} showSingle />
      <CategoryPills label="Prime" categories={primes} active={prime} onToggle={onPrime} showSingle />
    </div>
  );
}

interface CsvProps {
  report: ReportId;
  rows: AuditRow[];
  shown: readonly AuditRow[];
  docNo: (id: string | null) => string;
  query: string;
  filters: (string | null)[];
}

export function PauAuditCsvButton({ report, rows, shown, docNo, query, filters }: CsvProps) {
  return (
    <DownloadCsvButton
      report={report}
      filename="pau-values-needing-audit.csv"
      rowCount={shown.length}
      build={() => auditRowsToCSV([...shown], docNo)}
      fullRowCount={rows.length}
      buildFull={() => auditRowsToCSV(rows, docNo)}
      query={query}
      filters={filters}
    />
  );
}
