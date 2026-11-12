import { useState } from "react";
import { severedRange } from "@/lib/history";
import { track } from "../../lib/analytics";
import type { MergedEntry } from "./actorHistoryMerge";
import { HistoryDetail } from "./ActorHistoryDetail";

export function ActorHistoryEntry({
  entry,
  agentSlug,
  agentName,
}: {
  entry: MergedEntry;
  agentSlug: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const heading = entry.date || severedRange(entry.commitHash) || entry.commitHash;
  return (
    <div className="border-b py-2" style={{ borderColor: "var(--border)" }}>
      <HistoryToggle
        open={open}
        heading={heading}
        prSuffix={entry.pr ? ` — #${entry.pr}` : ""}
        prTitle={entry.prTitle}
        onToggle={() => toggleEntry(entry, agentSlug, agentName, open, setOpen)}
      />
      {open && <HistoryDetail entry={entry} />}
    </div>
  );
}

function toggleEntry(
  entry: MergedEntry,
  agentSlug: string,
  agentName: string,
  open: boolean,
  setOpen: (next: boolean | ((value: boolean) => boolean)) => void,
) {
  track("radar_history_toggle", {
    agent_slug: agentSlug,
    agent_name: agentName,
    commit: entry.commitHash,
    pr: entry.pr ?? null,
    date: entry.date,
    open: !open,
  });
  setOpen((value) => !value);
}

function HistoryToggle({
  open,
  heading,
  prSuffix,
  prTitle,
  onToggle,
}: {
  open: boolean;
  heading: string;
  prSuffix: string;
  prTitle?: string;
  onToggle: () => void;
}) {
  return (
    <button className="w-full text-left flex items-start gap-1.5" onClick={onToggle} aria-expanded={open}>
      <span className="mono text-[10px] mt-0.5 shrink-0" style={{ color: "var(--tan-3)" }}>{open ? "▾" : "▸"}</span>
      <span>
        <span className="mono text-xs font-semibold block" style={{ color: "var(--tan)" }}>{heading}{prSuffix}</span>
        {prTitle && <span className="text-[11px] leading-snug mt-0.5 block" style={{ color: "var(--tan-3)" }}>{prTitle}</span>}
      </span>
    </button>
  );
}
