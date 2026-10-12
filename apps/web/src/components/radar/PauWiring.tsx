import type { PauSnapshot } from "../../lib/pau";
import { controllerWiring, type ControllerWiring } from "@/lib/pauWiring";

function missing(w: ControllerWiring): string | null {
  if (w.proxy && w.rateLimits) return null;
  if (!w.proxy && !w.rateLimits) return "This controller holds the CONTROLLER role on neither its ALM proxy nor its rate limits, so it cannot move funds.";
  if (!w.proxy) return "This controller holds the CONTROLLER role on its rate limits but not on its ALM proxy, so it cannot move the proxy's funds.";
  return "This controller holds the CONTROLLER role on its ALM proxy but not on its rate limits, so its rate-limited actions revert.";
}

/** A pill saying the deployment's controller is not, or only partly, granted the roles it needs; nothing when it is, or when the roles are not all read. */
export function PauWiring({ snap }: { snap: PauSnapshot }) {
  const w = controllerWiring(snap);
  const why = w && missing(w);
  if (!w || !why) return null;
  return (
    <span className="text-[11px] px-1.5 rounded" style={{ color: "var(--error-text)", border: "1px solid var(--red)" }} title={why} data-wiring={w.proxy || w.rateLimits ? "partly" : "unwired"}>
      {w.proxy || w.rateLimits ? "partly wired" : "not wired"}
      <span className="sr-only">: {why}</span>
    </span>
  );
}
