import { hex, score } from "wcag-contrast";

export type ContrastLevel = "AAA" | "AA" | "AA Large" | "Fail";

/** Returns WCAG ratio or null if either value isn't a plain #rrggbb hex. */
export function contrastRatio(fg: string, bg: string): number | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(fg) || !/^#[0-9a-fA-F]{6}$/.test(bg)) return null;
  try {
    return hex(fg, bg);
  } catch {
    return null;
  }
}

export function rateContrast(ratio: number): ContrastLevel {
  return score(ratio) as ContrastLevel;
}

/** Worst-case background token per foreground token (for inline swatch badges). */
export const SWATCH_WORST_BG: Record<string, string> = {
  tan: "surface", "tan-2": "surface", "tan-3": "surface", gray: "surface",
  red: "surface", "red-dim": "bg", "error-text": "surface",
  accent: "surface", magenta: "tan", "terminal-green": "surface", "lily-green": "bg",
  "entity-agent": "surface", "entity-facilitator-org": "surface",
  "entity-govops-org": "surface", "entity-delegate-org": "surface",
  "entity-development-company": "surface", "entity-foundation": "surface",
  "entity-composite-party": "surface", "entity-governance-body": "surface",
  "entity-operational-party": "surface", "entity-ecosystem-actor": "surface",
  "entity-instance": "surface", "entity-fallback": "surface",
  "diff-removed-fg": "diff-removed-bg", "edge-label-fg": "bg-deep",
  ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`depth-${i + 1}`, "surface"])),
};

export interface AuditPair {
  fg: string;
  bg: string;
  label: string;
}

export const AUDIT_PAIRS: readonly AuditPair[] = [
  { fg: "tan",           bg: "bg",               label: "primary text / bg" },
  { fg: "tan-2",         bg: "bg",               label: "secondary text / bg" },
  { fg: "tan-3",         bg: "bg",               label: "tertiary text / bg" },
  { fg: "gray",          bg: "bg",               label: "muted text / bg" },
  { fg: "tan",           bg: "surface",          label: "primary text / surface" },
  { fg: "tan-2",         bg: "surface",          label: "secondary text / surface" },
  { fg: "tan-3",         bg: "surface",          label: "tertiary text / surface" },
  { fg: "gray",          bg: "surface",          label: "muted text / surface" },
  { fg: "tan",           bg: "bg-deep",          label: "primary text / bg-deep" },
  { fg: "accent",        bg: "bg",               label: "accent links / bg" },
  { fg: "accent",        bg: "surface",          label: "accent links / surface" },
  { fg: "error-text",    bg: "bg",               label: "error-text / bg" },
  { fg: "error-text",    bg: "surface",          label: "error-text / surface" },
  { fg: "red",           bg: "surface",          label: "red (decorative) / surface" },
  { fg: "magenta",       bg: "tan",              label: "status pill / tan" },
  { fg: "terminal-green",bg: "bg",               label: "terminal-green / bg" },
  { fg: "tan",           bg: "red-dim",          label: "mark text / red-dim" },
  { fg: "diff-removed-fg",bg: "diff-removed-bg", label: "diff removed text" },
  { fg: "depth-1",       bg: "surface",          label: "depth-1 chiclet / surface" },
  { fg: "depth-2",       bg: "surface",          label: "depth-2 chiclet / surface" },
  { fg: "depth-3",       bg: "surface",          label: "depth-3 chiclet / surface" },
  { fg: "depth-4",       bg: "surface",          label: "depth-4 chiclet / surface" },
  { fg: "depth-5",       bg: "surface",          label: "depth-5 chiclet / surface" },
];
