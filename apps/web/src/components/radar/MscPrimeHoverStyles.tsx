import { DIM } from "./MscRingHoverStyles";

/* Cross-chart hover: a To-Sky segment in the SELECTED month lights the
   same money on the ring (that prime's To-Sky slices, arrow and Sky
   wedge), and the ring's To-Sky marks light the segment back. Other months' layers describe
   different numbers than the ring shows, so they don't. Either way the
   rest of the other chart fades to DIM, so the pairing is unmistakable
   rather than an outline you have to look for. Static CSS can't express
   "same data-prime as the hovered element", so the rules are generated per
   prime — the same trick as the venue sankey's VenueHoverStyles. */
export function PrimeHoverStyles({ primes }: { primes: string[] }) {
  const css = primes
    .map((p) => {
      const seg = (flow: string) =>
        `.msc-overview-row:has(.msc-bar-col[data-active="true"] .msc-ts-seg[data-prime="${p}"][data-flow="${flow}"]:hover)`;
      const prime = `.msc-ring-prime[data-prime="${p}"]`;
      const mark = (kinds: string[]) =>
        `.msc-overview-row:has(${kinds.map((k) => `.msc-ring-mark[data-mark="${p}::${k}"]:hover`).join(", ")})`;
      const layer = (flow: string) =>
        `.msc-bar-col[data-active="true"] .msc-ts-seg[data-prime="${p}"][data-flow="${flow}"]`;
      // Lit marks get an outline in the text ink (fills never change, so
      // the audited fill/ink pairs hold at rest and when lit).
      const lit = "{ opacity: 1; stroke: var(--tan); stroke-width: 2.5; }";
      // Everything on the ring that is not prime p.
      const ringOthers = `.msc-ring :is(.msc-ring-prime:not([data-prime="${p}"]), .msc-ring-sky-disc, .msc-ring-sky-wedge:not([data-prime="${p}"]), .msc-ring-figure[data-kind="sky"]:not([data-prime="${p}"]))`;
      // Every segment of the selected month that is not prime p's.
      const colOthers = `.msc-bar-col[data-active="true"] .msc-ts-seg:not([data-prime="${p}"])`;
      return [
        // Timeseries → ring: a To-Sky segment = the two To-Sky slices, the
        // arrow and the wedge of that Prime.
        `${seg("sky")} ${ringOthers} { opacity: ${DIM}; }`,
        `${seg("sky")} ${prime} .msc-ring-label { fill: var(--tan); }`,
        `${seg("sky")} ${prime} :is(.msc-ring-cof, .msc-ring-sde, .msc-ring-arrow) ${lit}`,
        `${seg("sky")} .msc-ring-sky-wedge[data-prime="${p}"] ${lit}`,
        // Ring → timeseries: the prime's pie (or its wedge) in focus fades
        // the month's other primes; the To-Sky marks name its segment.
        `.msc-overview-row:has(${prime}:hover, .msc-ring-mark[data-mark="${p}::share"]:hover) ${colOthers} { opacity: ${DIM}; }`,
        `${mark(["cof", "sde", "sky", "share"])} ${layer("sky")} { outline: 2px solid var(--tan); outline-offset: -2px; }`,
      ].join("\n");
    })
    .join("\n");
  return <style>{css}</style>;
}
