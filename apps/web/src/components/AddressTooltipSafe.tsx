import { explorerUrl } from "@/lib/explorer";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "./AtlasLink";
import { shortAddr } from "../lib/format";
import type { SafeView } from "../lib/addressSafe";

/** A Safe as read on chain: its M / N threshold and owner addresses, plus the
 *  atlas's stated threshold only when the two disagree. */
export function AddressTooltipSafe({ safe }: { safe: SafeView }) {
  const chains = safe.chains.length > 1 ? ` · ${safe.chains.join(", ")}` : "";
  return (
    <section className="mt-1.5" aria-label="Safe owners" data-safe={safe.chains.join(",")}>
      <div className="flex justify-between gap-3 mono text-[10px] text-tan-3">
        <span>safe{chains}</span>
        <span>
          threshold <span className="text-tan">{safe.threshold} / {safe.owners.length}</span>
        </span>
      </div>
      {safe.atlas && (
        <div className="mono text-[10px]" style={{ color: "var(--warn)" }} data-atlas-disagrees>
          Atlas states {safe.atlas.required} / {safe.atlas.total}
          {safe.atlas.docId && <> · <AtlasLink to={atlasHref(safe.atlas.docId)} className="link-accent">{safe.atlas.name}</AtlasLink></>}
        </div>
      )}
      <ul className="mt-0.5 space-y-0.5" aria-label="Owners">
        {safe.owners.map((o) => (
          <li key={o} className="mono text-[10px]">
            <a href={explorerUrl(o, { chain: safe.chains[0] })} target="_blank" rel="noopener noreferrer" title={o} className="link-accent">
              {shortAddr(o)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
