import { explorerTxUrl } from "@/lib/explorer";
import { atlasOnchainHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";
import { Tooltip } from "../Tooltip";
import { MARK_TIP_MS } from "./PauAtlasMark";
import type { ParamMark } from "../../lib/paramChecks";
import type { RowMark, TipLine } from "../../lib/rowMark";

/** An exclamation mark in a circle, at the text's size and colour. */
const CIRCLED_BANG = (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={{ display: "inline", verticalAlign: "-1px" }}>
    <circle cx="8" cy="8" r="6.8" />
    <path d="M8 4.4v4.4" />
    <path d="M8 11.4v.2" strokeWidth="2.2" />
  </svg>
);

// Red is kept for "the atlas is probably wrong" (the chain holds what the atlas
// leaves unstated), because the reader updates the atlas. A disagreement could
// be either side's, so it is amber; a key the contract never set is grey.
const LOOK: Record<ParamMark, { glyph: React.ReactNode; color: string }> = {
  match: { glyph: "✓", color: "var(--terminal-green)" },
  mismatch: { glyph: "✗", color: "var(--warn)" },
  "not-set": { glyph: "!", color: "var(--tan-3)" },
  "not-stated": { glyph: "–", color: "var(--tan-3)" },
  candidate: { glyph: CIRCLED_BANG, color: "var(--error-text)" },
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
 * A card row's verdict against the chain, in the card's mark column: ✓ ✗ ! ?,
 * – or a circled ! (the chain holds an ID or value the atlas leaves unstated), linked to the stating document's Onchain tab. The column is kept empty
 * for a row with nothing to check, so every mark in a card lines up.
 */
export function ParamCheckMark({ mark }: { mark: RowMark | null }) {
  const look = mark ? LOOK[mark.mark] : null;
  const glyph = look && <span style={{ color: look.color }}>{look.glyph}</span>;
  return (
    <span className={`${mark ? "relative z-10 " : ""}mono text-[10px] shrink-0 w-4 ml-2 text-center font-semibold`} data-check={mark?.mark}>
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
