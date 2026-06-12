export type PaletteGroup =
  | "surface"
  | "brand"
  | "text"
  | "row"
  | "shadow"
  | "graph"
  | "diff"
  | "entity"
  | "depth";

export interface PaletteToken {
  name: string;
  label: string;
  group: PaletteGroup;
  alpha: boolean;
}

export const GROUP_ORDER: readonly PaletteGroup[] = [
  "surface",
  "brand",
  "text",
  "row",
  "shadow",
  "graph",
  "diff",
  "entity",
  "depth",
] as const;

export const GROUP_LABEL: Record<PaletteGroup, string> = {
  surface: "Surface",
  brand: "Brand",
  text: "Text",
  row: "Row Overlays",
  shadow: "Shadows",
  graph: "Graph Chrome",
  diff: "Diff",
  entity: "Entity Types",
  depth: "Depth Rainbow",
};

export const PALETTE_TOKENS: readonly PaletteToken[] = [
  // ─── Surface ───
  { name: "bg", label: "Background", group: "surface", alpha: false },
  { name: "bg-deep", label: "Deep BG", group: "surface", alpha: false },
  { name: "surface", label: "Surface", group: "surface", alpha: false },
  { name: "hover", label: "Hover", group: "surface", alpha: false },
  { name: "border", label: "Border", group: "surface", alpha: false },
  { name: "atlas-row-selected", label: "Atlas Row Selected", group: "surface", alpha: false },
  { name: "row-pulse-flash", label: "Row Pulse Flash", group: "surface", alpha: true },
  { name: "row-bar-tint", label: "Row Bar Tint", group: "surface", alpha: false },

  // ─── Brand ───
  { name: "red", label: "Red", group: "brand", alpha: false },
  { name: "red-dim", label: "Red Dim", group: "brand", alpha: false },
  { name: "accent", label: "Accent", group: "brand", alpha: false },
  { name: "error-text", label: "Error Text", group: "brand", alpha: false },
  { name: "magenta", label: "Magenta", group: "brand", alpha: false },
  { name: "terminal-green", label: "Terminal Green", group: "brand", alpha: false },
  { name: "lily-green", label: "Lily Green", group: "brand", alpha: false },

  // ─── Text ───
  { name: "gray", label: "Gray", group: "text", alpha: false },
  { name: "tan", label: "Tan (primary)", group: "text", alpha: false },
  { name: "tan-2", label: "Tan 2", group: "text", alpha: false },
  { name: "tan-3", label: "Tan 3", group: "text", alpha: false },

  // ─── Row overlays (alpha) ───
  { name: "row-hover", label: "Row Hover", group: "row", alpha: true },
  { name: "row-selected", label: "Row Selected", group: "row", alpha: true },
  { name: "row-focused", label: "Row Focused", group: "row", alpha: true },

  // ─── Shadows (alpha) ───
  { name: "shadow", label: "Shadow", group: "shadow", alpha: true },
  { name: "shadow-strong", label: "Shadow Strong", group: "shadow", alpha: true },

  // ─── Graph chrome ───
  { name: "edge", label: "Edge", group: "graph", alpha: false },
  { name: "edge-label-fg", label: "Edge Label", group: "graph", alpha: false },
  { name: "graph-dots", label: "Graph Dots", group: "graph", alpha: false },

  // ─── Diff ───
  { name: "diff-removed-bg", label: "Diff Removed BG", group: "diff", alpha: false },
  { name: "diff-removed-fg", label: "Diff Removed FG", group: "diff", alpha: false },

  // ─── Entity types ───
  { name: "entity-agent", label: "Agent", group: "entity", alpha: false },
  { name: "entity-facilitator-org", label: "Facilitator", group: "entity", alpha: false },
  { name: "entity-govops-org", label: "GovOps", group: "entity", alpha: false },
  { name: "entity-delegate-org", label: "Aligned Delegate", group: "entity", alpha: false },
  { name: "entity-development-company", label: "Dev Company", group: "entity", alpha: false },
  { name: "entity-foundation", label: "Foundation", group: "entity", alpha: false },
  { name: "entity-composite-party", label: "Composite Party", group: "entity", alpha: false },
  { name: "entity-governance-body", label: "Governance Body", group: "entity", alpha: false },
  { name: "entity-operational-party", label: "Operational Party", group: "entity", alpha: false },
  { name: "entity-ecosystem-actor", label: "Ecosystem Actor", group: "entity", alpha: false },
  { name: "entity-instance", label: "Instance", group: "entity", alpha: false },
  { name: "entity-fallback", label: "Fallback", group: "entity", alpha: false },

  // ─── Depth jewel-tone palette (5-color cycle red→orange→green→blue→purple starting at depth-1, looping through depth-17) ───
  { name: "depth-1", label: "Depth 1 (red)", group: "depth", alpha: false },
  { name: "depth-2", label: "Depth 2 (orange)", group: "depth", alpha: false },
  { name: "depth-3", label: "Depth 3 (green)", group: "depth", alpha: false },
  { name: "depth-4", label: "Depth 4 (blue)", group: "depth", alpha: false },
  { name: "depth-5", label: "Depth 5 (purple)", group: "depth", alpha: false },
  { name: "depth-6", label: "Depth 6 (red)", group: "depth", alpha: false },
  { name: "depth-7", label: "Depth 7 (orange)", group: "depth", alpha: false },
  { name: "depth-8", label: "Depth 8 (green)", group: "depth", alpha: false },
  { name: "depth-9", label: "Depth 9 (blue)", group: "depth", alpha: false },
  { name: "depth-10", label: "Depth 10 (purple)", group: "depth", alpha: false },
  { name: "depth-11", label: "Depth 11 (red)", group: "depth", alpha: false },
  { name: "depth-12", label: "Depth 12 (orange)", group: "depth", alpha: false },
  { name: "depth-13", label: "Depth 13 (green)", group: "depth", alpha: false },
  { name: "depth-14", label: "Depth 14 (blue)", group: "depth", alpha: false },
  { name: "depth-15", label: "Depth 15 (purple)", group: "depth", alpha: false },
  { name: "depth-16", label: "Depth 16 (red)", group: "depth", alpha: false },
  { name: "depth-17", label: "Depth 17 (orange)", group: "depth", alpha: false },
] as const;

export const TOKEN_BY_NAME: ReadonlyMap<string, PaletteToken> = new Map(
  PALETTE_TOKENS.map((t) => [t.name, t]),
);
