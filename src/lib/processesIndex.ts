import type { AtlasNode } from "../types";
import { fetchJson } from "./verify";

// One curated entry from public/processes.json — the hand-validated inventory.
// Title + doc_no are resolved from docs.json at read time via the entry's uuid.
export interface ProcessEntry {
  uuid: string;
  category: string;
  shape: "child" | "inline";
  status: "active" | "deferred-stub";
  /**
   * Manual step count set by the processes-triage skill. Overrides the heuristic.
   * Used primarily for prose-only inline processes where automatic counting fails.
   */
  stepCount?: number;
}

// Enriched row used by the report. stepCount is null when the heuristic can't
// derive one (rare; surface as "—" in the UI).
export interface ProcessRow {
  uuid: string;
  docNo: string;
  title: string;
  category: string;
  shape: "child" | "inline";
  status: "active" | "deferred-stub";
  stepCount: number | null;
}

let cache: Promise<ProcessEntry[]> | null = null;

export function loadProcesses(): Promise<ProcessEntry[]> {
  if (!cache) {
    cache = fetchJson<ProcessEntry[]>(
      `${import.meta.env.BASE_URL}processes.json`,
      "processes.json",
    ).catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Step counting
// ---------------------------------------------------------------------------

// Atlas types that are never step nodes — used to filter doc_no-based children.
const NON_STEP_TYPES = new Set([
  "Annotation",
  "Action Tenet",
  "Scenario",
  "Scenario Variation",
  "Active Data",
  "Needed Research",
]);

function isStepChild(child: AtlasNode): boolean {
  if (NON_STEP_TYPES.has(child.type)) return false;
  // ".0" suffix nodes are placeholders for annotation/action-tenet/scenario
  // containers (e.g. A.1.10.0.3.1) — not process steps.
  const lastSegment = child.doc_no.split(".").pop();
  if (lastSegment === "0") return false;
  return true;
}

// Build a `parent_doc_no → children[]` map once per dataset. doc_no is the
// only reliable parent linkage at depth 6+ where parentId / parent_of edges
// are missing.
export function indexByParentDocNo(docs: Record<string, AtlasNode>): Map<string, AtlasNode[]> {
  const map = new Map<string, AtlasNode[]>();
  for (const node of Object.values(docs)) {
    const lastDot = node.doc_no.lastIndexOf(".");
    if (lastDot < 0) continue;
    const parentDocNo = node.doc_no.slice(0, lastDot);
    const list = map.get(parentDocNo) ?? [];
    list.push(node);
    map.set(parentDocNo, list);
  }
  return map;
}

/**
 * Count the steps of a process. Strategy in priority order:
 *   1. Direct doc_no children that are step-shaped (numeric suffix, not annotation)
 *   2. Headings within content matching "Step N" / "Stage N" / "Phase N"
 *   3. Top-level numbered list items
 *   4. Parenthesized enumeration "(1) ... (2) ..." (1-indexed, sequential)
 *   5. Top-level bullet items (only if ≥ 3 — avoid counting prose bullets)
 *
 * Returns null if no signal — the UI should render "—".
 */
export function countSteps(
  node: AtlasNode,
  childrenByParentDocNo: Map<string, AtlasNode[]>,
): number | null {
  // 1. doc_no-based children
  const children = (childrenByParentDocNo.get(node.doc_no) ?? []).filter(isStepChild);
  if (children.length > 0) return children.length;

  const content = node.content ?? "";

  // 2. Step/Stage/Phase headings — unique numbers only
  const stepHeadings = [...content.matchAll(/^#+\s*(?:Step|Stage|Phase)\s+(\d+)/gim)];
  if (stepHeadings.length > 0) {
    return new Set(stepHeadings.map((m) => m[1])).size;
  }

  // 3. Numbered list items at line start
  const numList = [...content.matchAll(/^(\d+)\.\s+/gm)];
  if (numList.length >= 2) return numList.length;

  // 4. Parenthesized sequential enumeration: (1) ... (2) ... (3) ...
  const parens = [...content.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
  if (parens.length >= 2 && parens[0] === 1) {
    let n = 1;
    for (let i = 1; i < parens.length && parens[i] === n + 1; i++) n++;
    if (n >= 2) return n;
  }

  // 5. Bullet items (cautious — needs at least 3 to avoid prose noise)
  const bullets = [...content.matchAll(/^[-*]\s+/gm)];
  if (bullets.length >= 3) return bullets.length;

  return null;
}

/**
 * Direct step children of a process node, in doc_no order. Annotations and
 * other non-step children are filtered out via `isStepChild`.
 */
export function getStepChildren(
  node: AtlasNode,
  childrenByParentDocNo: Map<string, AtlasNode[]>,
): AtlasNode[] {
  return (childrenByParentDocNo.get(node.doc_no) ?? [])
    .filter(isStepChild)
    .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------
// buildProcessRows — pure, testable.
// ---------------------------------------------------------------------------

export function buildProcessRows(
  docs: Record<string, AtlasNode>,
  processes: ProcessEntry[],
): ProcessRow[] {
  const childrenByParentDocNo = indexByParentDocNo(docs);

  return processes
    .map<ProcessRow | null>((entry) => {
      const node = docs[entry.uuid];
      if (!node) return null; // missing UUID — dirty-check would flag this
      return {
        uuid: entry.uuid,
        docNo: node.doc_no,
        title: node.title,
        category: entry.category,
        shape: entry.shape,
        status: entry.status,
        // Manual override wins; otherwise fall back to the heuristic.
        stepCount: entry.stepCount ?? countSteps(node, childrenByParentDocNo),
      };
    })
    .filter((r): r is ProcessRow => r !== null);
}
