import { AtlasLink } from "../AtlasLink";
import { Address } from "../Address";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadAtlas } from "../../lib/docs";
import type { StoredPauSnapshot } from "../../lib/pau";
import { facetRows, type FacetRow as FacetRowData } from "@/lib/pauFacets";
import type { Anchor } from "@/lib/pauAnchors";
import { atlasHref } from "@/lib/routes";
import { PauOriginChip } from "./PauOriginChip";
import { PauSectionHeading } from "./PauSectionHeading";

const dim = { color: "var(--tan-3)" };
const head = "py-0.5 font-normal align-bottom";
const NO_DOC = "the Atlas has no ceiling document for this facet";
const DEFERRED = "the Atlas says the ceiling will be specified in a future iteration";

function FacetRow({ r, chain, loaded }: { r: FacetRowData; chain: string; loaded: boolean }) {
  return (
    <tr className="border-t border-[var(--border)] mono" style={{ color: "var(--tan-2)" }}>
      <td className="py-0.5 pr-3 align-top">{r.name}</td>
      <td className="py-0.5 pr-3 align-top"><Address address={r.address} chain={chain} /></td>
      <td className="py-0.5 pr-3 align-top">
        {r.ceiling ? (
          <AtlasLink to={atlasHref(r.ceiling.docId)} className="text-accent hover:underline" title={r.ceiling.text ? undefined : DEFERRED}>
            {r.ceiling.text ?? "not yet stated"}
          </AtlasLink>
        ) : (
          <span style={dim} title={NO_DOC}>{loaded ? "—" : ""}</span>
        )}
      </td>
      <td className="py-0.5 align-top text-right whitespace-nowrap">
        {r.setAt.time.slice(0, 10)} <PauOriginChip chain={chain} tx={r.setAt.tx} />
      </td>
    </tr>
  );
}

/** The facets a Diamond PAU's controller uses, each beside the most the Atlas designs it for (not the limit this Prime has set). */
export function PauFacets({ snap, anchor }: { snap: Pick<StoredPauSnapshot, "chain" | "contracts">; anchor: Anchor }) {
  const atlas = useLoaded(loadAtlas, { soft: true });
  const rows = facetRows(snap, atlas?.docs ?? null);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <PauSectionHeading deployment={anchor} section="facets">Facets in use</PauSectionHeading>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="mono text-[11px] uppercase tracking-wider" style={dim}>
            <th className={`${head} pl-0 pr-3 text-left`}>Facet</th>
            <th className={`${head} pr-3 text-left`}>Address</th>
            <th className={`${head} pr-3 text-left`} title="the highest production rate limit the Atlas designs the facet for; not the limit set on this Prime's contracts">Atlas ceiling</th>
            <th className={`${head} text-right`}>Registered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <FacetRow key={r.id} r={r} chain={snap.chain} loaded={!!atlas} />)}
        </tbody>
      </table>
    </div>
  );
}
