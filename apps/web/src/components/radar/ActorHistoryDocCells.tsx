import { Tooltip } from "../Tooltip";
import { CHANGE_COLOR } from "@/lib/history";
import { shortenTitle } from "@/lib/shortenTitle";
import type { AffectedDoc } from "./actorHistoryMerge";
import { CHANGE_INDICATOR, editTooltip } from "./actorHistoryLabels";
import { DocNoDiff, TypeDiff } from "../history/ChangePair";

// The title and edit-type cells of one doc row in the actor history table.

export function TitleCell({ doc: d }: { doc: AffectedDoc }) {
  return (
    <>
      <span className="block truncate">{d.title ? shortenTitle(d.title, 48) : ""}</span>
      {/* A renumbering's numbers with the changed segments marked; else the
          path detail of a genuine "moved" doc — omitted for a self-move
          (movedFrom/movedTo absent, see AffectedDoc) so no "A.1 → A.1"
          nonsense ever renders. */}
      {d.renumbered ? (
        <span className="block truncate text-[9px]" style={{ color: "var(--tan-3)" }}>
          <DocNoDiff prev={d.renumbered[0]} next={d.renumbered[1]} />
        </span>
      ) : (
        d.movedFrom &&
        d.movedTo && (
          <span className="block truncate mono text-[9px]" style={{ color: "var(--tan-3)" }}>
            {d.movedFrom} → {d.movedTo}
          </span>
        )
      )}
      {d.retitled && (
        <span className="block truncate text-[9px]" style={{ color: "var(--tan-3)" }}>
          was “{d.retitled[0]}”
        </span>
      )}
      {d.retyped && (
        <span className="block truncate text-[9px]" style={{ color: "var(--tan-3)" }}>
          <TypeDiff prev={d.retyped[0]} next={d.retyped[1]} />
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
