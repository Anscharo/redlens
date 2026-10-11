import type { ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { ReportShell } from "./ReportShell";
import { PauAuditControls, PauAuditCsvButton } from "./PauAuditControls";
import { PauAuditTable } from "./PauAuditTable";
import { usePauAuditState } from "./usePauAuditState";

const REPORT: ReportId = "pau-audit";

const SEARCHES = "prime · chain · instance · value · atlas text · chain value · reason · doc no";

function Intro() {
  return (
    <>
      Every Prime Agent PAU value, controller and atlas role claim an expert should look at, grouped by why. Which side moved last is read
      from dates: when the chain last set the value, and when the atlas document stating it last changed. Where the dates cannot say, the row is
      ambiguous rather than guessed. Values that match, values the atlas marks as not set, and values the reader has not read yet are left out.
    </>
  );
}

export function PauAuditReport({ query, mode }: { query: string; mode: ReportMode }) {
  const s = usePauAuditState(REPORT, query, mode);
  const items = new Set(s.shown.map((r) => r.item)).size;
  return (
    <ReportShell
      report={REPORT}
      maxWidth="max-w-7xl"
      description={<Intro />}
      controls={<PauAuditControls {...s.pills} />}
      query={query}
      filters={s.filters}
      searches={SEARCHES}
      count={`${items} item${items === 1 ? "" : "s"}`}
      actions={<PauAuditCsvButton report={REPORT} rows={s.rows} shown={s.shown} docNo={s.docNo} query={query} filters={s.filters} />}
      loading={s.loading}
      viewProps={{ row_count: s.rows.length }}
      noRows={!s.loading && s.shown.length === 0}
    >
      <PauAuditTable rows={s.shown} rq={s.rq} docNo={s.docNo} />
    </ReportShell>
  );
}
