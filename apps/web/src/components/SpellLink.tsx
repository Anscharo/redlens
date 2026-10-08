// The address of an executive's cast spell, linked to its block explorer. Shown
// only for a spell that has been cast: a deployed spell still awaiting votes
// has an address too, so the caller passes one only when the record says cast.
import { explorerUrl } from "@/lib/explorer";
import { shortAddr } from "../lib/format";

export function SpellLink({ address }: { address: string }) {
  return (
    <a
      href={explorerUrl(address, { chain: "ethereum" })}
      target="_blank"
      rel="noreferrer"
      title={`Cast spell ${address}`}
      className="mono text-xs text-accent hover:underline"
    >
      spell {shortAddr(address)}
    </a>
  );
}
