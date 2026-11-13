// The Liquidity Layer page's addition to the chat system prompt.
import { PAU_CLASSES, PAU_LAYOUT } from "../../lib/pauLayout.ts";

/** A Radar slug safe to quote into the prompt as a tool argument. */
export const SLUG = /^[a-z0-9-]{1,64}$/;

/** The path segment after /radar/<slug>/, ignoring a query or a hash. */
export function subpage(path: string | undefined): string | undefined {
  return path?.match(/\/radar\/[^/?#]+\/([^/?#]+)/)?.[1];
}

/** The two tool calls for this prime. The entity argument is left out when the slug is not a slug, so a hostile path cannot enter the prompt as an argument. */
function calls(slug: string | null): string {
  const entity = slug ? ` entity="${slug}"` : "";
  const who = slug ?? "this prime";
  return [
    `How to query ${who}. Copy these arguments.`,
    `- Live readings and the classes above: redline_onchain${entity} with relation "mirrors", "differs", "pointed" or "chain-only". kind is rate-limit, parameter, role, member, beam-state, rate-limit-default or atlas-vs-contract. chain narrows to one chain. include_off lists a limit whose maximum is 0.`,
    `- Spells and every other configuration change, the value it replaced, and steps queued and not yet run: redline_liquidity_changes${entity}. origin "spell" keeps spells. Cite each row's url.`,
    "- A Diamond's facets are on the page. They are not their own tool rows. The limits and parameters those facets enforce are the rate-limit and parameter facts.",
  ].join("\n");
}

/** The block for /radar/<slug>/pau, or "" on any other page. */
export function pauPageBlock(ctx: { actorSlug?: string; path?: string } | undefined): string {
  if (!ctx || subpage(ctx.path) !== "pau" || !ctx.actorSlug) return "";
  const slug = ctx.actorSlug.trim().toLowerCase();
  const safe = SLUG.test(slug) ? slug : null;
  return `\n\n${PAU_LAYOUT}\n\n${PAU_CLASSES}\n\n${calls(safe)}`;
}
