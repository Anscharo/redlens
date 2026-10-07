import { Tooltip } from "../Tooltip";
import { CHANGE_COLOR } from "@/lib/history";
import { shortenTitle } from "@/lib/shortenTitle";
import type { AffectedDoc } from "./actorHistoryMerge";
import { CHANGE_INDICATOR, editTooltip } from "./actorHistoryLabels";

// The title and edit-type cells of one doc row in the actor history table.

export function TitleCell({ doc: d }: { doc: AffectedDoc }) {
  return (
    <>
      <span className="block truncate">{d.title ? shortenTitle(d.title, 48) : ""}</span>
      {/* Renumber detail for a genuine "moved" doc — omitted for a
          self-move (movedFrom/movedTo absent, see AffectedDoc) so no
          "A.1 → A.1" nonsense ever renders. */}
      {d.movedFrom && d.movedTo && (
        <span className="block truncate mono text-[9px]" style={{ color: "var(--tan-3)" }}>
          {d.movedFrom} → {d.movedTo}
        </span>
      )}
    </>
  );
}

export function EditCell({ doc: d }: { doc: AffectedDoc }) {
  return (
    <Tooltip content={editTooltip(d.changeType, d.changeKind)}>
      <span className="flex items-center gap-1.5 cursor-help">
        <span style={{ color: CHANGE_COLOR[d.changeType] }}>{CHANGE_INDICATOR[d.changeType]}</span>
        {d.changeKind && d.changeKind !== "semantic" && <span style={{ color: "var(--tan-3)" }}>{d.changeKind}</span>}
      </span>
    </Tooltip>
  );
}
