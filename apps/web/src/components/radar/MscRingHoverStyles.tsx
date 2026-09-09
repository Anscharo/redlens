import { markId } from "./MscRingPills";
import type { MscRingPrime } from "./MscRingPrime";

/** How far the rest of the chart fades when one thing is in focus. Low
 *  enough that the lit marks are unmistakable, high enough that the faded
 *  ones still show where they are. */
export const DIM = 0.22;

/* Static CSS can't say "everything that is NOT the hovered prime", so the
   focus rules are generated per prime (the venue sankey's VenueHoverStyles
   trick). Three things put a prime in focus — hovering its pie, keyboard
   focus on its link, hovering its Sky wedge — and in that state every OTHER
   prime, the Sky disc and every other wedge fade to DIM, the prime's own
   wedge gets the text-ink outline, and its arrow and hole come up to full.

   Pills paint in a top layer, so they are no longer descendants of the
   mark they name and plain `.mark:hover .pill` can't reach them; one
   `:has()` rule per mark pairs them back up by id. Keyboard focus reveals
   that prime's pills (prefix match) since there is no per-mark focus
   target. */
export function RingHoverStyles({ primes }: { primes: MscRingPrime[] }) {
  const css = primes
    .flatMap((p) => {
      const id = p.flow.prime;
      const kinds = [...p.ring.slices.map((s) => s.kind as string), "share", "gross"];
      if (p.ring.hole) kinds.push("loss");
      if (p.ring.arrow) kinds.push(p.ring.arrow.kind);
      const rules = kinds.map((k) => {
        const mark = markId(id, k);
        return `.msc-ring:has(.msc-ring-mark[data-mark="${mark}"]:hover) .msc-ring-pill[data-mark="${mark}"] { opacity: 1; }`;
      });
      const focus = `.msc-ring:has(.msc-ring-prime[data-prime="${id}"]:hover, a:focus-visible > .msc-ring-prime[data-prime="${id}"], .msc-ring-mark[data-mark="${markId(id, "share")}"]:hover)`;
      const others = `:is(.msc-ring-prime:not([data-prime="${id}"]), .msc-ring-sky-disc, .msc-ring-sky-wedge:not([data-prime="${id}"]), .msc-ring-figure[data-kind="sky"]:not([data-prime="${id}"]))`;
      rules.push(
        `.msc-ring:has(a:focus-visible > .msc-ring-prime[data-prime="${id}"]) .msc-ring-pill[data-mark^="${id}::"] { opacity: 1; }`,
        `${focus} ${others} { opacity: ${DIM}; }`,
        `${focus} .msc-ring-sky-wedge[data-prime="${id}"] { stroke: var(--tan); stroke-width: 2.5; }`,
        `${focus} .msc-ring-prime[data-prime="${id}"] :is(.msc-ring-arrow, .msc-ring-hole) { opacity: 1; }`,
        `${focus} .msc-ring-prime[data-prime="${id}"] .msc-ring-rim { stroke-width: 4.5; stroke-opacity: 1; }`,
        `${focus} .msc-ring-prime[data-prime="${id}"] .msc-ring-label { fill: var(--tan); }`,
      );
      return rules;
    })
    .join("\n");
  return <style>{css}</style>;
}
