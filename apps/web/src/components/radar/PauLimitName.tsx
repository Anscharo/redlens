import { AtlasLink } from "../AtlasLink";
import { Address } from "../Address";
import { atlasHref } from "@/lib/routes";
import { EVM_ADDRESS_EXACT_RE } from "@/lib/patterns";
import { refsOnChain } from "@/lib/pauKeyChains";
import type { NamedIn } from "@/lib/pauConstantDocs";
import { limitName } from "@/lib/pauLimitOrder";
import type { AtlasKeyRef, DerivedKey, RetiredAddress } from "../../lib/pau";

const dim = { color: "var(--tan-3)" };

const derivation = (d: DerivedKey) => [d.constant, ...d.args].join(" · ");

/** A key no atlas doc states a value for, named by the controller constant and arguments that derive it, and by the one document that names the constant when there is one. */
function DerivedName({ k, d, retired, chain, namedIn }: { k: string; d: DerivedKey; retired?: RetiredAddress; chain: string; namedIn?: NamedIn }) {
  const doc = namedIn?.(d.constant, chain);
  return (
    <span title={`${k}\nderived from ${derivation(d)}; no atlas document states this key`}>
      {d.constant}
      {d.args.map((a) => (
        <span key={a}>
          {" · "}
          {EVM_ADDRESS_EXACT_RE.test(a) ? <Address address={a} chain={chain} noBalance /> : a}
        </span>
      ))}
      {retired && (
        <span style={dim} title={`the Atlas listed ${retired.address} until commit ${retired.commit.slice(0, 8)}`}>
          {` · dropped from the Atlas ${retired.removedAt.slice(0, 10)}`}
        </span>
      )}
      {doc && (
        <span style={dim}>
          {" · named in "}
          <AtlasLink to={atlasHref(doc.id)} className="text-accent hover:underline" title={`${doc.doc_no}: the one document in this Prime's artifact that names ${d.constant} on this chain; this link does not compare a value`}>
            {doc.title}
          </AtlasLink>
        </span>
      )}
    </span>
  );
}

const chainLabel = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);

/** A key's name: the atlas param that states it, else its derivation, else a note that nothing names it. */
export function PauLimitName({ r, chain, keyIndex, namedIn }: { r: { key: string; derived?: DerivedKey; retired?: RetiredAddress }; chain: string; keyIndex: Map<string, AtlasKeyRef[]>; namedIn?: NamedIn }) {
  const named = keyIndex.get(r.key.toLowerCase()) ?? [];
  const refs = refsOnChain(named, chain);
  const ref = refs[0];
  if (!ref && named.length > 0) {
    const title = `${r.key}\nnamed by the Atlas for ${chainLabel(named[0].chain!)} only`;
    return <span title={title}>{limitName(r, keyIndex, chain)}</span>;
  }
  if (!ref && r.derived) return <DerivedName k={r.key} d={r.derived} retired={r.retired} chain={chain} namedIn={namedIn} />;
  if (!ref) {
    return (
      <span title={r.key} style={dim}>
        {r.key.slice(0, 10)}… <span style={{ color: "var(--accent)" }}>no document or controller constant found referencing this limit</span>
      </span>
    );
  }
  const label = limitName(r, keyIndex, chain) + (ref.via ? " (matched by address)" : "");
  const viaNote = ref.via ? [`the atlas lists ${ref.via} for this instance, and this key is derived from that address`] : [];
  const title = [r.key, ...viaNote, ...(r.derived ? [`derived from ${derivation(r.derived)}`] : []), ...refs.slice(1).map((x) => `also ${x.label}`)].join("\n");
  if (!ref.docId) return <span title={title}>{label}</span>;
  return (
    <AtlasLink to={atlasHref(ref.docId)} className="text-accent hover:underline" title={title}>
      {label}
    </AtlasLink>
  );
}
