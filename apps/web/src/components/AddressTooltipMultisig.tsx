import type { MultisigFact } from "@/lib/addressGraphFacts";
import { atlasHref } from "@/lib/routes";
import { AtlasLink } from "./AtlasLink";

/** One multisig the address is: its name (linked to its atlas root), the
 *  M / N signing requirement and each signing party with its signer count. */
export function AddressTooltipMultisig({ ms }: { ms: MultisigFact }) {
  const chains = ms.chains.length > 1 ? ` · ${ms.chains.join(", ")}` : "";
  return (
    <section className="mt-1.5" aria-label={`${ms.name} signers`} data-multisig={ms.name}>
      <div className="flex justify-between gap-3 mono text-[10px] text-tan-3">
        <span>multisig{chains}</span>
        <span>
          threshold{" "}
          <span className="text-tan">{ms.threshold ? `${ms.threshold.required} / ${ms.threshold.total}` : "not stated"}</span>
        </span>
      </div>
      {ms.docId ? (
        <AtlasLink to={atlasHref(ms.docId)} className="link-accent block truncate">{ms.name}</AtlasLink>
      ) : (
        <div className="text-tan-2 truncate">{ms.name}</div>
      )}
      {ms.signers.length > 0 && (
        <ul className="mt-0.5 space-y-0.5" aria-label="Signers">
          {ms.signers.map((s) => (
            <li key={s.name} className="flex justify-between gap-3 mono text-[10px] text-tan-2">
              <span className="truncate">{s.name}</span>
              {s.count != null && <span>{s.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
