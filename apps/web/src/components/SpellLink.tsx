// The address of an executive's cast spell, linked to its block explorer. Shown
// only for a spell that has been cast: a deployed spell still awaiting votes
// has an address too, so the caller passes one only when the record says cast.
import { Address } from "./Address";
import { shortAddr } from "../lib/format";

export function SpellLink({ address }: { address: string }) {
  return (
    <Address address={address} chain="ethereum" title={`Cast spell ${address}`} className="text-xs">
      spell {shortAddr(address)}
    </Address>
  );
}
