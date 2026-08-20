// Filter controls for the Processes report: the local-ignore curation bar and
// the category / status / shape pill groups. Status and shape are enums whose
// "all" value means "no filter", so it maps to a null active pill.
import type { LocalIgnore } from "@/lib/curationStore";
import { CategoryPills } from "./CategoryPills";
import { ProcessCurationBar } from "./ProcessCurationBar";

export type StatusFilter = "all" | "active" | "deferred-stub";
export type ShapeFilter = "all" | "child" | "inline";
export const STATUS_VALUES = ["all", "active", "deferred-stub"] as const;
export const SHAPE_VALUES = ["all", "child", "inline"] as const;
const STATUS_PILLS = ["active", "deferred-stub"] as const;
const SHAPE_PILLS = ["child", "inline"] as const;

export function ProcessesFilters({
  marks,
  onClearMarks,
  showIgnored,
  onToggleShowIgnored,
  categories,
  category,
  onCategory,
  status,
  onStatus,
  shape,
  onShape,
}: {
  marks: LocalIgnore[];
  onClearMarks: () => void;
  showIgnored: boolean;
  onToggleShowIgnored: () => void;
  categories: string[];
  category: string | null;
  onCategory: (next: string) => void;
  status: StatusFilter;
  onStatus: (next: StatusFilter) => void;
  shape: ShapeFilter;
  onShape: (next: ShapeFilter) => void;
}) {
  return (
    <>
      <ProcessCurationBar
        marks={marks}
        onClear={onClearMarks}
        showIgnored={showIgnored}
        onToggleShowIgnored={onToggleShowIgnored}
      />
      <div className="flex flex-wrap gap-4 mb-6">
        <CategoryPills label="Category" categories={categories} active={category} onToggle={onCategory} showSingle />
        <CategoryPills
          label="Status"
          categories={STATUS_PILLS}
          active={status === "all" ? null : status}
          onToggle={onStatus}
          showSingle
        />
        <CategoryPills
          label="Shape"
          categories={SHAPE_PILLS}
          active={shape === "all" ? null : shape}
          onToggle={onShape}
          showSingle
        />
      </div>
    </>
  );
}
