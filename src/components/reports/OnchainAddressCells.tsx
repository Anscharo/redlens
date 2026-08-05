import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";
import { Highlight } from "./Highlight";
import type { ReportQuery } from "../../lib/reportFilter";
import type { AddressType, OnchainAddressRow } from "../../lib/onchainAddressesIndex";

const TYPE_STYLE: Record<AddressType, string> = {
  EOA: "bg-[var(--hover)] text-tan-3",
  Multisig: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-tan",
  Token: "bg-[color-mix(in_srgb,var(--red)_16%,transparent)] text-tan-2",
  "Sky Internal Contract": "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-tan-2",
  "Other Contract": "bg-transparent text-tan-3 border border-[var(--border)]",
};

export function TypePill({ t }: { t: AddressType }) {
  return (
    <span className={`mono text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${TYPE_STYLE[t]}`}>
      {t}
    </span>
  );
}

// The "Docs mentioned in" cell — one app link per mentioning doc, rendered as
// `A.1.2 — Title`. Each link targets the doc by UUID (atlasHref), never doc_no.
export function DocsCell({ row, rq }: { row: OnchainAddressRow; rq: ReportQuery }) {
  if (row.docs.length === 0) {
    return <span className="mono text-[10px] text-tan-3">(no mentions)</span>;
  }
  return (
    <ul className="space-y-0.5">
      {row.docs.map((d) => (
        <li key={d.id} className="leading-snug">
          <AtlasLink
            to={atlasHref(d.id)}
            className="text-xs text-tan-2 hover:text-tan hover:underline"
            title={`${d.docNo} — ${d.title} [${d.type}]`}
          >
            <span className="mono text-[10px] text-accent">
              <Highlight text={d.docNo} rq={rq} />
            </span>{" "}
            <Highlight text={d.title} rq={rq} />
          </AtlasLink>
        </li>
      ))}
    </ul>
  );
}
