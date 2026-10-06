// Status cell of a Processes report row: the curated status pill plus an
// "ignored" badge when the row is marked locally.
import type { ProcessRow as ProcessRowData } from "@/lib/processesIndex";
import type { LocalIgnore } from "../../lib/curationStore";

const STATUS_STYLE: Record<ProcessRowData["status"], string> = {
  active: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-tan",
  "deferred-stub": "bg-[var(--hover)] text-tan-3",
};

function StatusPill({ s }: { s: ProcessRowData["status"] }) {
  return <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[s]}`}>{s}</span>;
}

export function ProcessStatusCell({ status, existing }: { status: ProcessRowData["status"]; existing: LocalIgnore | undefined }) {
  return (
    <td className="py-2 px-3 align-top">
      <div className="flex items-center gap-1">
        <StatusPill s={status} />
        {existing && (
          <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan-3" title={`Marked locally: ${existing.reason}`}>
            ignored
          </span>
        )}
      </div>
    </td>
  );
}
