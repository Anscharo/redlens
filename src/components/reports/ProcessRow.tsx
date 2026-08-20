// One process row (collapsed summary + expanded body) for the Processes
// report, with its two small status/steps cells.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { HEADER_OFFSET } from "@/lib/layout";
import type { ProcessRow as ProcessRowData } from "@/lib/processesIndex";
import type { LocalIgnore } from "@/lib/curationStore";
import type { AtlasNode } from "@/types";
import type { ReportQuery } from "@/lib/reportFilter";
import { Highlight } from "./Highlight";
import { ProcessExpandedBody } from "./ProcessExpandedBody";

const STATUS_STYLE: Record<ProcessRowData["status"], string> = {
  active: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-tan",
  "deferred-stub": "bg-[var(--hover)] text-tan-3",
};

function StatusPill({ s }: { s: ProcessRowData["status"] }) {
  return <span className={`mono text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[s]}`}>{s}</span>;
}

function StepsCell({ count, shape }: { count: number | null; shape: ProcessRowData["shape"] }) {
  if (count === null) {
    return (
      <span className="mono text-[10px] text-tan-3" title="step count not auto-detectable">
        —
      </span>
    );
  }
  return (
    <span className="mono text-[10px] text-tan-3">
      {count} {shape === "inline" ? "inline " : ""}step{count === 1 ? "" : "s"}
    </span>
  );
}

export function ProcessRow({
  r,
  node,
  stepChildren,
  expanded,
  onToggle,
  onNavigate,
  existing,
  onMark,
  onUnmark,
  rq,
}: {
  r: ProcessRowData;
  node: AtlasNode;
  stepChildren: AtlasNode[];
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (id: string) => void;
  existing: LocalIgnore | undefined;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
  rq: ReportQuery;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <>
      <tr
        id={r.uuid}
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ scrollMarginTop: HEADER_OFFSET }}
        className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
      >
        <td className="py-2 px-3 align-top w-6 text-tan-3 mono text-[10px]" aria-hidden>
          {expanded ? "▾" : "▸"}
        </td>
        <td className="py-2 px-3 align-top">
          <AtlasLink to={atlasHref(r.uuid)} onClick={stop} className="mono text-xs text-accent hover:underline text-left">
            <Highlight text={r.docNo} rq={rq} />
          </AtlasLink>
        </td>
        <td className="py-2 px-3 align-top">
          <AtlasLink to={atlasHref(r.uuid)} onClick={stop} className="text-sm text-tan hover:underline text-left">
            <Highlight text={r.title} rq={rq} />
          </AtlasLink>
        </td>
        <td className="py-2 px-3 align-top">
          <StepsCell count={r.stepCount} shape={r.shape} />
        </td>
        <td className="py-2 px-3 align-top">
          <div className="flex items-center gap-1">
            <StatusPill s={r.status} />
            {existing && (
              <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-tan-3" title={`Marked locally: ${existing.reason}`}>
                ignored
              </span>
            )}
          </div>
        </td>
        <td className="py-2 px-3 align-top mono text-[10px] text-tan-3" title={r.uuid}>
          {r.uuid.slice(0, 8)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <ProcessExpandedBody
              node={node}
              steps={stepChildren}
              onNavigate={onNavigate}
              existing={existing}
              onMark={onMark}
              onUnmark={onUnmark}
            />
          </td>
        </tr>
      )}
    </>
  );
}
