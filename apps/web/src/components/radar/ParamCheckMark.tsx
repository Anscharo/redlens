import type { ValueCheck } from "@/lib/pauAtlasValues";
import { explorerTxUrl } from "@/lib/explorer";
import { atlasOnchainHref } from "@/lib/routes";
import { AtlasLink } from "../AtlasLink";
import { Tooltip } from "../Tooltip";
import { MARK_TIP_MS } from "./PauAtlasMark";
import { PAU_KIND_LABEL } from "../../lib/pau";
import { paramMark, type ParamMark } from "../../lib/paramChecks";
import { contractValue, isCompared, VALUE_STATUS } from "../../lib/valueStatus";

const LOOK: Record<ParamMark, { glyph: string; head: string; color: string }> = {
  match: { glyph: "✓", head: "Matches the atlas", color: "var(--terminal-green)" },
  mismatch: { glyph: "✗", head: "Differs from the atlas", color: "var(--error-text)" },
  "not-set": { glyph: "!", head: "Not set on the contract", color: "var(--error-text)" },
  "not-stated": { glyph: "–", head: "The atlas sets no value yet", color: "var(--tan-3)" },
  unsure: { glyph: "?", head: "Can't be compared", color: "var(--tan-3)" },
};

const dim = { color: "var(--tan-3)" };

/** One deployment's side of the check: the value it holds and when it was set, or why there is none. */
function CheckLine({ c, many }: { c: ValueCheck; many: boolean }) {
  const where = many && c.kind ? ` · ${PAU_KIND_LABEL[c.kind]}` : "";
  const reason = VALUE_STATUS[c.status].text;
  if (!isCompared(c)) return <p>{reason[0].toUpperCase()}{reason.slice(1)}{where}</p>;
  return (
    <>
      <p className="flex justify-between gap-3">
        <span style={dim}>On-chain{where}</span>
        <span style={{ color: "var(--tan)" }}>{contractValue(c)}</span>
      </p>
      <p style={dim}>
        set{" "}
        <a href={explorerTxUrl(c.chain!, c.limit!.setAt.tx)} target="_blank" rel="noopener" className="hover:underline">
          {c.limit!.setAt.time.slice(0, 10)}
        </a>
        {c.readAt && ` · read ${c.readAt.slice(0, 16).replace("T", " ")} UTC`}
      </p>
    </>
  );
}

/** Each deployment's line, with a reason said once however many deployments give it. */
const distinctLines = (checks: ValueCheck[]) =>
  checks.filter((c, i) => isCompared(c) || checks.findIndex((d) => !isCompared(d) && d.status === c.status && d.kind === c.kind) === i);

function CheckTip({ mark, checks }: { mark: ParamMark; checks: ValueCheck[] }) {
  const look = LOOK[mark];
  const lines = distinctLines(checks);
  return (
    <div className="mono text-[10px] space-y-1" style={{ minWidth: 200 }}>
      <p className="font-semibold" style={{ color: look.color }}>{look.glyph} {look.head}</p>
      {lines.map((c, i) => <CheckLine key={`${c.contract ?? ""}:${c.kind ?? ""}:${i}`} c={c} many={lines.length > 1} />)}
      {mark === "mismatch" && (
        <p className="flex justify-between gap-3"><span style={dim}>Atlas</span><span>{checks[0].stated}</span></p>
      )}
    </div>
  );
}

/**
 * A card row's verdict against the chain, in the card's mark column: ✓ ✗ ! ? or
 * –, linked to the stating document's Onchain tab. The column is kept empty
 * for a row with nothing to check, so every mark in a card lines up.
 */
export function ParamCheckMark({ checks }: { checks: ValueCheck[] }) {
  const mark = paramMark(checks);
  const look = mark ? LOOK[mark] : null;
  return (
    <span className="mono text-[10px] shrink-0 w-4 ml-2 text-center font-semibold" data-check={mark ?? undefined}>
      {look && (
        <Tooltip content={<CheckTip mark={mark!} checks={checks} />} delay={MARK_TIP_MS}>
          <AtlasLink to={atlasOnchainHref(checks[0].docId)} aria-label={look.head} style={{ color: look.color }}>
            {look.glyph}
          </AtlasLink>
        </Tooltip>
      )}
    </span>
  );
}
