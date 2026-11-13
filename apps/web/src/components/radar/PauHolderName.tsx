import { Address } from "../Address";
import { entityLink, plumbLitTint } from "@/lib/pauPlumbingLinks";

interface HolderNameProps {
  /** Its part or contract name (holderNames); absent for an account nothing names. */
  name?: string;
  /** Its box in the diagram, as a link token (pauPlumbingLinks.ts). */
  link?: string;
  account: string;
  chain: string;
}

/**
 * A role row's account: its name, the word linked to its box and to every word
 * naming the same address, then its address. An unnamed account's address
 * takes the links instead.
 */
export function HolderName({ name, link, account, chain }: HolderNameProps) {
  const tags = { "data-link": link, "data-ent": entityLink(account), "data-part": "holder", className: "rounded", style: { background: plumbLitTint("transparent"), color: "var(--tan-2)" } };
  if (!name) return <span {...tags}><Address address={account} chain={chain} /></span>;
  return (
    <span className="inline-flex items-baseline gap-x-2">
      <span {...tags}>{name}</span>
      <Address address={account} chain={chain} />
    </span>
  );
}
