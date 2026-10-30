import type { AddressDocRef } from "@/lib/addressGraphFacts";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "./AtlasLink";

const SHOWN = 3;

/** The atlas documents that mention the address, as doc_no links — the way
 *  back to the atlas from an address shown outside the reader. */
export function AddressTooltipDocs({ docs }: { docs: AddressDocRef[] }) {
  if (docs.length === 0) return null;
  const more = docs.length - SHOWN;
  return (
    <div className="mt-1.5 mono text-[10px] text-tan-3" data-address-docs>
      in the Atlas:{" "}
      {docs.slice(0, SHOWN).map((d, i) => (
        <span key={d.id}>
          {i > 0 && ", "}
          <AtlasLink to={atlasHref(d.id)} className="link-accent">{d.docNo || "document"}</AtlasLink>
        </span>
      ))}
      {more > 0 && ` +${more} more`}
    </div>
  );
}
