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
  red: "surface", "red-dim": "bg", "error-text": "surface", warn: "surface",
  accent: "surface", magenta: "tan", "terminal-green": "surface", "lily-green": "bg",
  "entity-agent": "surface", "entity-facilitator-org": "surface",
  "entity-govops-org": "surface", "entity-delegate-org": "surface",
  "entity-development-company": "surface", "entity-foundation": "surface",
  "entity-composite-party": "surface", "entity-governance-body": "surface",
  "entity-operational-party": "surface", "entity-ecosystem-actor": "surface",
  "entity-instance": "surface", "entity-multisig": "surface", "entity-fallback": "surface",
  "diff-removed-fg": "diff-removed-bg",
  ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`depth-${i + 1}`, "surface"])),
  ...Object.fromEntries(["sky", "sky-2", "sky-3", "sky-4", "sde", "kept", "demand", "dr", "gar", "cp"].map((k) => [`msc-${k}`, "bg-deep"])),
  ...Object.fromEntries(["sky", "sde", "kept", "demand", "dr", "gar", "cp"].map((k) => [`msc-${k}-ink`, `msc-${k}`])),
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
  { fg: "tan",           bg: "atlas-row-selected", label: "primary text / selected doc" },
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

  // ─── Light-theme audit additions ─────────────────────────────────────
  // The pairs above were written dark-only, against dark's worst-case
  // backgrounds. In dark, --surface is LIGHTER than --bg (so it's the worst
  // case for light text); in light, --bg-deep is the DARKEST surface (so
  // it's the worst case for dark text) — neither theme's worst case is
  // covered by the other's pairs, so every text token below is checked
  // against bg, surface, AND bg-deep instead of just one.
  { fg: "tan-2",         bg: "bg-deep",          label: "secondary text / bg-deep" },
  { fg: "tan-3",         bg: "bg-deep",          label: "tertiary text / bg-deep" },
  { fg: "gray",          bg: "bg-deep",          label: "muted text / bg-deep" },
  { fg: "accent",        bg: "bg-deep",          label: "accent links / bg-deep" },

  { fg: "warn",          bg: "bg",               label: "warn text / bg" },
  { fg: "warn",          bg: "surface",          label: "warn text / surface" },
  { fg: "lilac",         bg: "bg",               label: "lilac (preview renumbered note) / bg" },
  { fg: "preview-add",   bg: "bg",               label: "preview-add (redline new/changed) / bg" },
  { fg: "lily-green",    bg: "bg",               label: "lily-green / bg" },
  { fg: "diff-added-fg", bg: "diff-added-bg",    label: "diff added text" },

  // depth-1…6 is the full jewel-tone cycle (depth-7+ repeats it) — check
  // both worst-case surfaces per the split above.
  { fg: "depth-6",       bg: "surface",          label: "depth-6 chiclet / surface" },
  { fg: "depth-1",       bg: "bg-deep",          label: "depth-1 chiclet / bg-deep" },
  { fg: "depth-2",       bg: "bg-deep",          label: "depth-2 chiclet / bg-deep" },
  { fg: "depth-3",       bg: "bg-deep",          label: "depth-3 chiclet / bg-deep" },
  { fg: "depth-4",       bg: "bg-deep",          label: "depth-4 chiclet / bg-deep" },
  { fg: "depth-5",       bg: "bg-deep",          label: "depth-5 chiclet / bg-deep" },
  { fg: "depth-6",       bg: "bg-deep",          label: "depth-6 chiclet / bg-deep" },

  // Focus ring is a UI-component boundary, not text — WCAG 1.4.11 non-text
  // contrast (3:1), not 1.4.3 normal text (4.5:1). Same --accent/--bg(/--surface)
  // token pair as the link entries above, but a distinct label so
  // theme-contrast.test.ts can hold it to the lower threshold without
  // touching the text-level entries. See `:focus-visible` in index.css.
  { fg: "accent",        bg: "bg",               label: "focus ring / bg" },
  { fg: "accent",        bg: "surface",          label: "focus ring / surface" },

  // ─── MSC settlement charts ─────────────────────────────────────────
  // Figures printed ON a slice or wedge of the orbital chart are set in the
  // fill's paired ink token (index.css `--msc-<series>-ink`); every fill
  // that carries text is audited against its ink at normal-text 4.5:1. The
  // three family colors are also graphics on the chart card (bars, ribbons,
  // the To-Sky line), so they hold the 3:1 non-text bar against --bg-deep.
  { fg: "msc-sky-ink",    bg: "msc-sky",    label: "MSC figure on CoF slice / Sky pie" },
  { fg: "msc-sky-ink",    bg: "msc-sky-2",  label: "MSC figure on Sky wedge shade 2" },
  { fg: "msc-sky-ink",    bg: "msc-sky-3",  label: "MSC figure on Sky wedge shade 3" },
  { fg: "msc-sky-ink",    bg: "msc-sky-4",  label: "MSC figure on Sky wedge shade 4" },
  { fg: "msc-sde-ink",    bg: "msc-sde",    label: "MSC figure on SDE slice" },
  { fg: "msc-kept-ink",   bg: "msc-kept",   label: "MSC figure on supply-kept slice" },
  { fg: "msc-demand-ink", bg: "msc-demand", label: "MSC figure on agent-rate slice" },
  { fg: "msc-dr-ink",     bg: "msc-dr",     label: "MSC figure on distribution-rewards slice" },
  { fg: "msc-gar-ink",    bg: "msc-gar",    label: "MSC figure on accessibility-rewards slice" },
  { fg: "msc-cp-ink",     bg: "msc-cp",     label: "MSC figure on chronicle-points slice" },
  { fg: "msc-sky",        bg: "bg-deep",    label: "MSC To-Sky series / chart card" },
  { fg: "msc-kept",       bg: "bg-deep",    label: "MSC supply-kept series / chart card" },
  { fg: "msc-demand",     bg: "bg-deep",    label: "MSC demand-side series / chart card" },
];
