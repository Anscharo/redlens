import { Tooltip } from "../Tooltip";
import { CHANGE_COLOR, CHANGE_MARK } from "@/lib/changeTypes";
import { shortenTitle } from "@/lib/shortenTitle";
import type { AffectedDoc } from "./actorHistoryMerge";
import { editTooltip } from "./actorHistoryLabels";
import { DocNoDiff, TypeDiff } from "../history/ChangePair";

// The title and edit-type cells of one doc row in the actor history table.

/** One line of detail under a row's title. */
const detail = (body: React.ReactNode, mono = false) => (
  <span className={`block truncate text-[9px]${mono ? " mono" : ""}`} style={{ color: "var(--tan-3)" }}>
    {body}
  </span>
);

export function TitleCell({ doc: d }: { doc: AffectedDoc }) {
  return (
    <>
      <span className="block truncate">{d.title ? shortenTitle(d.title, 48) : ""}</span>
      {/* A move's paths — absent for a self-move (see AffectedDoc), so no
          "A.1 → A.1" nonsense ever renders — then a retitle's old title, a
          renumbering with its changed segments marked, and a type change. */}
      {d.movedFrom && d.movedTo && detail(`${d.movedFrom} → ${d.movedTo}`, true)}
      {d.retitled && detail(`was “${d.retitled[0]}”`)}
      {d.renumbered && detail(<DocNoDiff prev={d.renumbered[0]} next={d.renumbered[1]} />)}
      {d.retyped && detail(<TypeDiff prev={d.retyped[0]} next={d.retyped[1]} />)}
    </>
  );
}

export function EditCell({ doc: d }: { doc: AffectedDoc }) {
  return (
    <Tooltip content={editTooltip(d.changeType, d.changeKind)}>
      <span className="flex items-center gap-1.5 cursor-help">
        <span style={{ color: CHANGE_COLOR[d.changeType] }}>{CHANGE_MARK[d.changeType]}</span>
        {d.changeKind && d.changeKind !== "semantic" && <span style={{ color: "var(--tan-3)" }}>{d.changeKind}</span>}
      </span>
    </Tooltip>
  );
}
