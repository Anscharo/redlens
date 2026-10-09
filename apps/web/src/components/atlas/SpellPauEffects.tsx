import { Link } from "../Link";
import { actorPageHref } from "@/lib/routes";
import { useLoaded } from "../../hooks/useAtlasData";
import { loadGraph } from "../../lib/graph";
import { loadPauHistory, spellEffects } from "../../lib/pau";

/**
 * The PAU settings a cast spell changed, with a link to each prime's change
 * history. Nothing shows until the history loads, or when the spell changed none.
 */
export function SpellPauEffects({ spell }: { spell: string }) {
  const res = useLoaded(loadPauHistory, { soft: true });
  const graph = useLoaded(loadGraph, { soft: true });
  const fx = res ? spellEffects(res, spell) : null;
  if (!fx || fx.changes === 0) return null;
  const actors = fx.primes.map((id) => graph?.participants.find((e) => e.id === id)).filter((e) => !!e);
  const chains = fx.chains.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(", ");
  return (
    <p className="text-[11px] mono text-tan-3" data-spell-effects={spell}>
      changed {fx.changes} PAU setting{fx.changes === 1 ? "" : "s"} on {chains}
      {actors.map((a) => (
        <span key={a.id}>
          {" · "}
          <Link to={actorPageHref(a.slug, "pau", "pau-history")} className="text-accent hover:underline">
            {a.name} PAU history
          </Link>
        </span>
      ))}
    </p>
  );
}
