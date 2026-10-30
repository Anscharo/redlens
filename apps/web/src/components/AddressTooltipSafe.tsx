import { explorerUrl } from "@/lib/explorer";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "./AtlasLink";
import { TipRow } from "./AddressTooltipRow";
import { shortAddr } from "../lib/format";
import type { SafeView } from "../lib/addressSafe";

/** A Safe as read on chain, as rows of the hover card: its M / N threshold and
 *  signer addresses, plus the atlas's stated threshold only when they disagree. */
export function AddressTooltipSafe({ safe }: { safe: SafeView }) {
  const chains = safe.chains.length > 1 ? ` · ${safe.chains.join(", ")}` : "";
  return (
    <>
      <TipRow label="threshold">
        <span className="text-tan" data-threshold>{safe.threshold} / {safe.owners.length}</span>{chains}
      </TipRow>
      {safe.atlas && (
        <TipRow label="atlas states" style={{ color: "var(--warn)" }}>
          <span data-atlas-disagrees>{safe.atlas.required} / {safe.atlas.total}</span>
          {safe.atlas.docId && <> · <AtlasLink to={atlasHref(safe.atlas.docId)} className="link-accent">{safe.atlas.name}</AtlasLink></>}
        </TipRow>
      )}
      <TipRow label="signers">
        <ul aria-label="Signers">
          {safe.owners.map((o) => (
            <li key={o}>
              <a href={explorerUrl(o, { chain: safe.chains[0] })} target="_blank" rel="noopener noreferrer" title={o} className="link-accent">
                {shortAddr(o)}
              </a>
            </li>
          ))}
        </ul>
      </TipRow>
    </>
  );
}
