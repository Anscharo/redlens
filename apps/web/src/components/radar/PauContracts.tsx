import type { ComponentProps } from "react";
import { Address } from "../Address";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { StoredPauSnapshot } from "../../lib/pau";
import { roleWhy } from "@/lib/pauRoleWhy";
import { contractLabel } from "@/lib/pauHolderNames";

const dim = { color: "var(--tan-3)" };

interface AtlasDocLinkProps extends Omit<ComponentProps<typeof AtlasLink>, "to" | "title"> {
  /** The atlas documents stating it (registry provenance); the link goes to the first. */
  docs?: string[];
  /** The tooltip (`roleWhy`), which says how many documents state the contract. */
  title: string;
}

/** Text linked to the first atlas document that states the contract's address; else plain, with the tooltip alone and a dotted rule saying there is one. */
function AtlasDocLink({ docs, title, className, style, children, ...rest }: AtlasDocLinkProps) {
  if (!docs?.length) return <span className={`${className ?? ""} ${title ? "underline decoration-dotted underline-offset-2" : ""}`} style={style} title={title || undefined}>{children}</span>;
  return (
    <AtlasLink {...rest} to={atlasHref(docs[0])} className={`${className ?? ""} hover:underline`} style={style} title={title || "the atlas document stating this contract"}>
      {children}
    </AtlasLink>
  );
}

/** A deployment's contracts by role, each role linked to the atlas document that states it. */
export function PauContracts({ snap }: { snap: StoredPauSnapshot }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {snap.contracts.map((c) => (
        <li key={c.address} className="mono text-[11px]" style={dim}>
          <AtlasDocLink docs={c.atlasDocs} title={roleWhy(c, snap)}>{contractLabel(c)}</AtlasDocLink> <Address address={c.address} chain={snap.chain} />
        </li>
      ))}
    </ul>
  );
}
