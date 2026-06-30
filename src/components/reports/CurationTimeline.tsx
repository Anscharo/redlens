// Overview chart for the HTML-era curation queue: one stacked bar per commit
// (oldest → newest, with the #117 seed seam as the final column), split by decision
// kind so you can see where the ambiguity clusters — and click a bar to jump straight
// to that commit's first case. Hand-rolled SVG (no chart lib, the house style).
import { useMemo, useState } from "react";
import { commitColumns } from "../../lib/curationOrder";
import type { CurationData } from "../../lib/historyCuration";

// matcher tiers, stacked bottom→top, with descriptive names (the y-axis legend). Kept
// in render order so the big seed-close seam sits at the base and the rarer fuzzy/typed
// decisions read on top.
const TIERS: { kind: string; label: string; color: string }[] = [
  { kind: "seed-close", label: "Seed boundary (#117 close call)", color: "var(--red)" },
  { kind: "ambiguous", label: "Flagged ambiguous (no auto-pick)", color: "#d9a441" },
  { kind: "tier-2.5", label: "Reordered sibling group", color: "var(--accent)" },
  { kind: "tier-2.7", label: "Resized sibling group", color: "#9a6c8e" },
  { kind: "tier-3", label: "Fuzzy prose match", color: "var(--tan-3)" },
];

export function CurationTimeline({ data, onJump }: { data: CurationData; onJump?: (sha: string) => void }) {
  const cols = useMemo(() => commitColumns(data), [data]);
  const [sqrtScale, setSqrtScale] = useState(true); // the seam dwarfs the rest on a linear axis

  const totalByKind: Record<string, number> = {};
  for (const c of cols) for (const [k, n] of Object.entries(c.counts)) totalByKind[k] = (totalByKind[k] ?? 0) + n;

  const max = Math.max(1, ...cols.map((c) => c.total));
  const H = 170, PAD_B = 16, colW = 9, gap = 2, W = cols.length * colW;
  // bar height: sqrt compresses the 837-case seam so the small HTML bars stay visible;
  // segments split that height by each kind's linear share of the bar.
  const barH = (total: number) => (total ? (sqrtScale ? Math.sqrt(total) / Math.sqrt(max) : total / max) * H : 0);

  // a few evenly-spaced date ticks + the seam, so 80 columns stay legible
  const ticks = cols.map((c, i) => ({ c, i })).filter(({ c, i }) => c.isSeam || i % 12 === 0);

  return (
    <section className="mb-4 rounded p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <h2 className="text-[13px]" style={{ color: "var(--tan-2)" }}>Decisions per commit — oldest → newest</h2>
        <label className="text-[11px] flex items-center gap-1 cursor-pointer" style={{ color: "var(--tan-3)" }}>
          <input type="checkbox" checked={sqrtScale} onChange={(e) => setSqrtScale(e.target.checked)} />
          √ scale (compress the seam)
        </label>
      </div>

      <div className="overflow-x-auto">
        <svg width={W} height={H + PAD_B + 14} role="img" aria-label="Curation decisions per commit by tier">
          {cols.map((c, i) => {
            if (!c.total) return null;
            let y = H;
            return (
              <g key={c.sha} transform={`translate(${i * colW}, 0)`}>
                <title>{`${c.isSeam ? "#117 seed seam" : c.sha}${c.date ? ` · ${c.date.slice(0, 10)}` : ""}${c.pr ? ` · #${c.pr}` : ""}\n${c.total} decisions\n${TIERS.filter((t) => c.counts[t.kind]).map((t) => `  ${c.counts[t.kind]} ${t.label}`).join("\n")}`}</title>
                {TIERS.map((t) => {
                  const n = c.counts[t.kind] ?? 0;
                  if (!n) return null;
                  const h = barH(c.total) * (n / c.total);
                  y -= h;
                  return <rect key={t.kind} x={0} y={y} width={colW - gap} height={h} fill={t.color} />;
                })}
                {onJump && <rect x={0} y={0} width={colW - gap} height={H} fill="transparent" className="cursor-pointer" onClick={() => onJump(c.sha)} />}
              </g>
            );
          })}
          {/* baseline */}
          <line x1={0} y1={H} x2={W} y2={H} stroke="var(--border)" />
          {ticks.map(({ c, i }) => (
            <text key={c.sha} x={i * colW + (colW - gap) / 2} y={H + PAD_B} textAnchor="middle" fontSize={9} fill="var(--tan-3)">
              {c.isSeam ? "#117" : (c.date?.slice(5, 10) ?? "")}
            </text>
          ))}
        </svg>
      </div>

      <ul className="flex gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px]" style={{ color: "var(--tan-2)" }}>
        {TIERS.map((t) => (
          <li key={t.kind} className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, background: t.color, display: "inline-block", borderRadius: 2 }} />
            {t.label}<span style={{ color: "var(--tan-3)" }}>({totalByKind[t.kind] ?? 0})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
