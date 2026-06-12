// localStorage I/O + DOM application for the palette editor.
// The storage key and schema version are duplicated in index.html's
// inline pre-paint <script>. Keep them in sync.

import { PALETTE_TOKENS, type PaletteToken } from "./palette-tokens";

export const STORAGE_KEY = "redlens:palette-overrides";
export const SCHEMA_VERSION = 1;

interface PaletteOverridesV1 {
  v: 1;
  values: Record<string, string>;
}

// Built once at module load; used to whitelist keys from localStorage so that
// a tampered store (e.g. from a compromised extension) can't inject arbitrary
// CSS custom properties via applyOverrides.
const ALLOWED_TOKEN_NAMES = new Set(PALETTE_TOKENS.map((t) => t.name));

export function readOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PaletteOverridesV1;
    if (parsed?.v !== SCHEMA_VERSION || typeof parsed.values !== "object" || parsed.values === null) {
      return {};
    }
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.values)) {
      if (ALLOWED_TOKEN_NAMES.has(k) && typeof v === "string") safe[k] = v;
    }
    return safe;
  } catch {
    return {};
  }
}

export function writeOverrides(values: Record<string, string>): void {
  const payload: PaletteOverridesV1 = { v: SCHEMA_VERSION, values };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearOverrides(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function applyOverrides(values: Record<string, string>): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(values)) {
    root.style.setProperty(`--${name}`, value);
  }
}

export function clearInlineOverrides(names: readonly string[]): void {
  const root = document.documentElement;
  for (const name of names) root.style.removeProperty(`--${name}`);
}

// Normalize a CSS color for comparison: lowercase, strip whitespace inside rgba(),
// expand #fff → #ffffff. Lets "set back to default" detect equality reliably.
export function normalize(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    if (trimmed.length === 4) {
      const [, r, g, b] = trimmed;
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return trimmed;
  }
  if (trimmed.startsWith("rgba(") || trimmed.startsWith("rgb(")) {
    const inner = trimmed.slice(trimmed.indexOf("(") + 1, trimmed.lastIndexOf(")"));
    const parts = inner.split(",").map((s) => s.trim());
    return `${trimmed.startsWith("rgba(") ? "rgba" : "rgb"}(${parts.join(", ")})`;
  }
  return trimmed;
}

export function buildOverrideSnippet(
  draft: Record<string, string>,
  registry: readonly PaletteToken[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  const changedByGroup = new Map<string, PaletteToken[]>();

  for (const token of registry) {
    const draftValue = draft[token.name];
    if (draftValue === undefined) continue;
    if (normalize(draftValue) === normalize(cssDefault(token.name))) continue;
    const list = changedByGroup.get(token.group) ?? [];
    list.push(token);
    changedByGroup.set(token.group, list);
  }

  if (changedByGroup.size === 0) {
    return `/* Palette overrides — generated ${today} from /admin/palette\n   No tokens differ from defaults. */\n`;
  }

  // Split depth tokens into a separate :root block to mirror index.css layout.
  const semanticGroups: string[] = [];
  let depthBlock = "";

  for (const [group, tokens] of changedByGroup) {
    const lines = tokens.map((t) => `  --${t.name}: ${draft[t.name]};`).join("\n");
    const block = `  /* ${group} */\n${lines}`;
    if (group === "depth") depthBlock = block;
    else semanticGroups.push(block);
  }

  const header = `/* Palette overrides — generated ${today} from /admin/palette\n   Paste into src/index.css inside the appropriate :root { } block. */\n`;
  let output = header;

  if (semanticGroups.length > 0) {
    output += `:root {\n${semanticGroups.join("\n\n")}\n}\n`;
  }
  if (depthBlock) {
    if (semanticGroups.length > 0) output += "\n";
    output += `:root {\n${depthBlock}\n}\n`;
  }

  return output;
}

export const ALL_TOKEN_NAMES: readonly string[] = PALETTE_TOKENS.map((t) => t.name);

/** Read the current stylesheet value of a CSS custom property (not any inline override). */
export function cssDefault(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}
