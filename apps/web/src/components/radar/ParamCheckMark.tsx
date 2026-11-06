import { explorerTxUrl } from "@/lib/explorer";
import { atlasOnchainHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";
import { Tooltip } from "../Tooltip";
import { MARK_TIP_MS } from "./PauAtlasMark";
import type { ParamMark } from "../../lib/paramChecks";
import type { RowMark, TipLine } from "../../lib/rowMark";

const LOOK: Record<ParamMark, { glyph: string; color: string }> = {
  match: { glyph: "✓", color: "var(--terminal-green)" },
  mismatch: { glyph: "✗", color: "var(--error-text)" },
  "not-set": { glyph: "!", color: "var(--error-text)" },
  "not-stated": { glyph: "–", color: "var(--tan-3)" },
  unsure: { glyph: "?", color: "var(--tan-3)" },
};

const dim = { color: "var(--tan-3)" };

function Line({ line }: { line: TipLine }) {
  if ("text" in line) return <p>{line.text}</p>;
  if ("label" in line) {
    return (
      <p className="flex justify-between gap-3">
        <span style={dim}>{line.label}</span>
        <span className="text-right" style={{ color: "var(--tan)" }}>{line.value}</span>
      </p>
    );
  }
  return (
    <p style={dim}>
      set{" "}
      <a href={explorerTxUrl(line.chain, line.set.tx)} target="_blank" rel="noopener" className="hover:underline">
        {line.set.time.slice(0, 10)}
      </a>
      {line.readAt && ` · read ${line.readAt.slice(0, 16).replace("T", " ")} UTC`}
    </p>
  );
}

function MarkTip({ mark }: { mark: RowMark }) {
  const look = LOOK[mark.mark];
  return (
    <div className="mono text-[10px] space-y-1" style={{ minWidth: 200, maxWidth: 360 }}>
      <p className="font-semibold" style={{ color: look.color }}>{look.glyph} {mark.head}</p>
      {mark.lines.map((line, i) => <Line key={i} line={line} />)}
    </div>
  );
}

/**
 * A card row's verdict against the chain, in the card's mark column: ✓ ✗ ! ? or
 * –, linked to the stating document's Onchain tab. The column is kept empty
 * for a row with nothing to check, so every mark in a card lines up.
 */
export function ParamCheckMark({ mark }: { mark: RowMark | null }) {
  const look = mark ? LOOK[mark.mark] : null;
  const glyph = look && <span style={{ color: look.color }}>{look.glyph}</span>;
  return (
    <span className="mono text-[10px] shrink-0 w-4 ml-2 text-center font-semibold" data-check={mark?.mark}>
      {mark && (
        <Tooltip content={<MarkTip mark={mark} />} delay={MARK_TIP_MS}>
          {mark.docId ? (
            <AtlasLink to={atlasOnchainHref(mark.docId)} aria-label={mark.head}>{glyph}</AtlasLink>
          ) : (
            <span role="img" tabIndex={0} aria-label={mark.head}>{glyph}</span>
          )}
        </Tooltip>
      )}
    </span>
  );
}
