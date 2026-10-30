import type { AddressDocRef } from "@/lib/addressGraphFacts";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "./AtlasLink";
import { TipRow } from "./AddressTooltipRow";

const SHOWN = 3;

/** The atlas documents that mention the address, as doc_no links — the way
 *  back to the atlas from an address shown outside the reader. */
export function AddressTooltipDocs({ docs }: { docs: AddressDocRef[] }) {
  if (docs.length === 0) return null;
  const more = docs.length - SHOWN;
  return (
    <TipRow label="in atlas">
      <ul data-address-docs>
        {docs.slice(0, SHOWN).map((d) => (
          <li key={d.id}>
            <AtlasLink to={atlasHref(d.id)} className="link-accent">{d.docNo || "document"}</AtlasLink>
          </li>
        ))}
        {more > 0 && <li className="text-tan-3">+{more} more</li>}
      </ul>
    </TipRow>
  );
}
