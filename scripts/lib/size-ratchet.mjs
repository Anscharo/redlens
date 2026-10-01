// Size limits and the shrink-only baseline. Pure: measurements + baseline in, findings out.
//
// Limits count code lines (see size-metrics.mjs). Anything over `fail` must either be
// absent or listed in the baseline, and a listed item may only shrink. `warn` is
// advisory and reported only for files the change touches.

export const LIMITS = {
  file: { warn: 120, fail: 180 },
  fn: { warn: 20, fail: 50 },
  // React components carry markup, so they get this multiple of the function limits.
  componentFactor: 1.5,
};

const SOURCE_RE = /^(src|apps\/web\/src|scripts)\/.+\.(m?[jt]sx?)$/;
const EXCLUDED_RE = /(\.test\.|\.spec\.|\.d\.m?ts$|\/__tests__\/|\/__snapshots__\/)/;

/** Files the size check measures: first-party source, not tests or declarations. */
export const inSizeScope = (path) => SOURCE_RE.test(path) && !EXCLUDED_RE.test(path);

function limitFor(kind, component) {
  const base = kind === "file" ? LIMITS.file : LIMITS.fn;
  if (!component) return base;
  return { warn: Math.round(base.warn * LIMITS.componentFactor), fail: Math.round(base.fail * LIMITS.componentFactor) };
}

/** Every measured item as { key, kind, path, name, line, lines, limit }. */
export function sizeItems(measurements) {
  const items = [];
  for (const [path, m] of measurements) {
    items.push({ key: path, kind: "file", path, line: 1, lines: m.lines, limit: limitFor("file", false) });
    for (const f of m.fns) {
      const key = `${path}::${f.name}`;
      items.push({ key, kind: "fn", path, name: f.name, line: f.line, lines: f.lines, limit: limitFor("fn", f.component) });
    }
  }
  return items;
}

/** Classifies one item against its baseline entry; returns a finding or null. */
function judge(item, base, changed) {
  const { lines, limit } = item;
  if (lines > limit.fail) {
    if (base === undefined) return { ...item, level: "error", reason: "new" };
    if (lines > base) return { ...item, level: "error", reason: "grew", base };
    if (lines < base) return { ...item, level: "stale", reason: "shrank", base };
    return null;
  }
  if (base !== undefined) return { ...item, level: "stale", reason: "fixed", base };
  if (lines > limit.warn && (!changed || changed.has(item.path))) return { ...item, level: "warn", reason: "warn" };
  return null;
}

/**
 * Compares measurements with the baseline.
 * `changed` (Set of paths, or null for "all") scopes the advisory warnings only.
 * Returns findings plus the baseline that `--update` (tighten) and `--accept` (also
 * admit new/grown items) would write.
 */
export function ratchet(measurements, baseline, changed = null) {
  const items = sizeItems(measurements);
  const findings = [];
  const seen = new Set();
  for (const item of items) {
    seen.add(item.key);
    const finding = judge(item, baseline[item.key], changed);
    if (finding) findings.push(finding);
  }
  for (const key of Object.keys(baseline)) {
    if (!seen.has(key)) findings.push({ key, kind: "gone", path: key.split("::")[0], line: 1, level: "stale", reason: "gone", base: baseline[key] });
  }
  const over = items.filter((i) => i.lines > i.limit.fail);
  const tightened = Object.fromEntries(over.filter((i) => baseline[i.key] !== undefined).map((i) => [i.key, Math.min(i.lines, baseline[i.key])]));
  const accepted = Object.fromEntries(over.map((i) => [i.key, i.lines]));
  return { findings, tightened: sortKeys(tightened), accepted: sortKeys(accepted) };
}

const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/** One human-readable line per finding. */
export function describe(f) {
  const what = f.kind === "file" ? f.path : `${f.path} ${f.name ?? f.key.split("::")[1]}()`;
  const limit = f.limit ? ` (limit ${f.reason === "warn" ? f.limit.warn : f.limit.fail})` : "";
  switch (f.reason) {
    case "new": return `${what}: ${f.lines} code lines${limit}. Split it, or run --accept with a reason in the PR.`;
    case "grew": return `${what}: grew to ${f.lines} code lines, baseline ${f.base}. Grandfathered items may only shrink.`;
    case "shrank": return `${what}: shrank ${f.base} → ${f.lines}. Run \`pnpm check:size --update\` to lock it in.`;
    case "fixed": return `${what}: now within limits. Run \`pnpm check:size --update\` to drop it from the baseline.`;
    case "gone": return `${f.key}: no longer exists. Run \`pnpm check:size --update\` to drop it from the baseline.`;
    default: return `${what}: ${f.lines} code lines${limit}.`;
  }
}
