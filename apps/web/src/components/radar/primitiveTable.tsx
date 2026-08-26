import type { PrimitiveStat } from "../../lib/primitiveStats";

// Instances (A/S/C) and Invocations are atlas-distinct concepts (A.2.2.1.3 vs
// A.2.2.1.4). Invocations sit in the leftmost column; the Active column carries
// the thick group divider so the boundary between the two concepts reads
// visually. `isGroupStart` drives the divider; `group` drives anchor routing.
export const HEADERS = [
  { key: "Inv", full: "Invocations", label: "Invocations", group: "invocation" as const, isGroupStart: false },
  { key: "Act", full: "Active",     label: "Active Instances",    group: "instance" as const, isGroupStart: true },
  { key: "Sus", full: "Suspended",  label: "Suspended Instances", group: "instance" as const, isGroupStart: false },
  { key: "Com", full: "Completed",  label: "Completed Instances", group: "instance" as const, isGroupStart: false },
];

export const BORDER = "1px solid var(--border)";
// A visibly stronger divider than BORDER, for group boundaries — --tan-3 is
// the same "stronger hairline" token index.css uses for the selected type
// pill's border, and it reads as heavier than --border in both themes.
export const GROUP_BORDER = "2px solid var(--tan-3)";
export const CELL_PADDING = "0.175rem";
// Zebra striping, one step darker / one step lighter than the enclosing card
// (which sits on --bg-deep, see AgentPanel/ActorInstances). No token sits
// darker than --bg-deep, so the darker row is a color-mix toward black (the
// same "darken toward black" idiom --bg-alt uses); the lighter row reuses the
// existing --surface token directly.
export const ROW_COLORS = ["color-mix(in srgb, var(--bg-deep) 90%, black)", "var(--surface)"] as const;

export function shortenCategoryTitle(title: string): string {
  return title.replace(/\s*Primitives\s*/i, "").trim();
}

export function namesFor(p: PrimitiveStat, i: number): string[] {
  return [p.invocationNames, p.activeNames, p.suspendedNames, p.completedNames][i];
}

// Match the anchor scheme baked into ActorInstances: instance status cells
// link to `<prim.st>-<status>` (first card of that status group); the
// invocation cell links to `invocations-<prim.st>` (the primitive's
// sub-section within the Invocations top-level section).
export function anchorFor(h: typeof HEADERS[number], primSt: string): string {
  if (h.group === "invocation") return `invocations-${primSt}`;
  return `${primSt}-${h.full.toLowerCase()}`;
}

export function thStyle(h: typeof HEADERS[number]): React.CSSProperties {
  return {
    width: "2rem",
    textAlign: "center",
    borderLeft: h.isGroupStart ? GROUP_BORDER : BORDER,
    paddingLeft: CELL_PADDING,
    paddingRight: CELL_PADDING,
    color: "var(--tan)",
    cursor: "default",
    fontWeight: "normal",
  };
}

export function tdStyle(h: typeof HEADERS[number], dim: boolean): React.CSSProperties {
  return {
    textAlign: "center",
    borderLeft: h.isGroupStart ? GROUP_BORDER : BORDER,
    paddingLeft: CELL_PADDING,
    paddingRight: CELL_PADDING,
    color: "var(--tan-2)",
    opacity: dim ? 0.5 : undefined,
  };
}

export interface NameGroup { primTitle: string; names: string[] }

export function NameList({ names }: { names: string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {names.map((n, i) => (
        <li key={i} style={{ whiteSpace: "nowrap" }}>{n}</li>
      ))}
    </ul>
  );
}

export function GroupedNameList({ groups }: { groups: NameGroup[] }) {
  return (
    <div>
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginTop: gi === 0 ? 0 : 6 }}>
          <div className="mono" style={{ color: "var(--tan-3)", textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em", marginBottom: 1 }}>
            {g.primTitle}
          </div>
          <NameList names={g.names} />
        </div>
      ))}
    </div>
  );
}
