// Filter pill groups for Potential Mistakes. On a phone the groups start
// folded so the finding card isn't pushed below the fold; desktop always
// shows them. Open/closed is local — the active pills still live in the URL.
import { useId, useMemo, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import {
  CATEGORY_LABELS,
  PASSES,
  PASS_LABELS,
  SEVERITIES,
  STATUS_LABELS,
  countBy,
  presentCategories,
  type MistakePass,
  type MistakeRow,
  type MistakeSeverity,
  type MistakeStatus,
} from "@/lib/potentialMistakesIndex";
import { CategoryPills } from "./CategoryPills";
import { MOBILE_AT } from "./PotentialMistakesTable";

const STATUSES: readonly MistakeStatus[] = ["current", "renumbered", "missing", "corpus"];

export function MistakesFilters({
  all,
  severity,
  onSeverity,
  pass,
  onPass,
  status,
  onStatus,
  category,
  onCategory,
}: {
  all: readonly MistakeRow[];
  severity: MistakeSeverity | null;
  onSeverity: (next: MistakeSeverity) => void;
  pass: MistakePass | null;
  onPass: (next: MistakePass) => void;
  status: MistakeStatus | null;
  onStatus: (next: MistakeStatus) => void;
  category: string | null;
  onCategory: (next: string) => void;
}) {
  const mobile = useMediaQuery(MOBILE_AT);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const cats = useMemo(() => presentCategories(all), [all]);
  const catLabels = useMemo(
    () => Object.fromEntries(cats.map((c) => [c, CATEGORY_LABELS[c] ?? c])),
    [cats],
  );

  const pills = (
    <div className="flex flex-col gap-1.5">
      <CategoryPills
        categories={SEVERITIES}
        active={severity}
        onToggle={onSeverity}
        label="Severity"
        labelTitle="How confident the sweep was that this is a real defect — not how damaging it would be."
        counts={countBy(all, (r) => r.severity)}
        showSingle
      />
      <CategoryPills
        categories={cats}
        active={category}
        onToggle={onCategory}
        label="Category"
        display={catLabels}
        counts={countBy(all, (r) => r.category)}
      />
      <CategoryPills
        categories={PASSES}
        active={pass}
        onToggle={onPass}
        label="Found by"
        labelTitle="Which sweep pass reported the finding: a language read, a consistency read, or a mechanical scan."
        display={PASS_LABELS}
        counts={countBy(all, (r) => r.pass)}
      />
      <CategoryPills
        categories={STATUSES}
        active={status}
        onToggle={onStatus}
        label="Doc status"
        labelTitle="Checked live against the Atlas being served right now — findings whose document moved or vanished since the sweep."
        display={STATUS_LABELS}
        counts={countBy(all, (r) => r.status)}
      />
    </div>
  );

  if (!mobile) return <div className="mb-4">{pills}</div>;

  return (
    <div className="mb-4" data-state={open ? "open" : "closed"}>
      <button
        type="button"
        className="mono text-xs text-tan-2 min-h-11"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mr-1.5" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        Filters
      </button>
      {open && (
        <div id={bodyId} className="mt-1.5">
          {pills}
        </div>
      )}
    </div>
  );
}
