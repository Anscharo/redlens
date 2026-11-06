// Card specs for the Open Graph images and their /api/og.png query encoding.

// One card per route kind. `doc` carries the resolved title/number (+ a preview
// label when the doc is viewed inside a preview); the rest carry only the
// dynamic string they need (actor / report / preview label).
export type CardSpec =
  | { kind: "default" }
  | { kind: "doc"; docNo: string; title: string; preview?: string }
  | { kind: "radar" }
  | { kind: "radarActor"; agent: string }
  | { kind: "reports" }
  | { kind: "report"; name: string }
  | { kind: "connect" }
  | { kind: "preview"; label: string };

// The subset of CardSpec reachable through the /api/og.png?kind=… query
// string. `doc` is out-of-band — it's served by /api/og/<id>.png (a resolved
// lookup, not a query param) — so it's excluded here rather than left for
// cardToQuery to reject at runtime.
//
// cardToQuery/cardFromQuery are a paired contract: og.ts builds every
// og:image URL by calling cardToQuery() on a CardSpec object literal, so a
// typo'd kind string is now a compile error there, not a silently-wrong URL.
// cardFromQuery is the HTTP-boundary decoder for /api/og.png — an external,
// possibly malformed request still degrades to the default card there; that
// degradation is correct for the boundary, it's the internal string-building
// that's been made impossible to typo.
export type QueryCardSpec = Exclude<CardSpec, { kind: "doc" }>;

// Encode a QueryCardSpec as the /api/og.png query string (always leads with
// `kind`, matching the shape cardFromQuery expects).
export function cardToQuery(spec: QueryCardSpec): string {
  switch (spec.kind) {
    case "radar":
      return "kind=radar";
    case "radarActor":
      return `kind=radar-actor&name=${encodeURIComponent(spec.agent)}`;
    case "reports":
      return "kind=reports";
    case "report":
      return `kind=report&name=${encodeURIComponent(spec.name)}`;
    case "connect":
      return "kind=connect";
    case "preview":
      return `kind=preview&label=${encodeURIComponent(spec.label)}`;
    case "default":
      return "kind=default";
    default: {
      // Exhaustiveness guard: a new QueryCardSpec variant with no case above
      // is a compile error here, not a silent default-card degradation.
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

// Parse the /api/og.png query into a QueryCardSpec (doc is served by
// /api/og/<id>.png, not this route — see QueryCardSpec above). Unknown/missing
// kind → the default wordmark card; this is the HTTP boundary, so a malformed
// external request degrading gracefully is correct here.
export function cardFromQuery(params: URLSearchParams): QueryCardSpec {
  switch (params.get("kind")) {
    case "radar":
      return { kind: "radar" };
    case "radar-actor":
      return { kind: "radarActor", agent: params.get("name") ?? "" };
    case "reports":
      return { kind: "reports" };
    case "report":
      return { kind: "report", name: params.get("name") ?? "" };
    case "connect":
      return { kind: "connect" };
    case "preview":
      return { kind: "preview", label: params.get("label") ?? "" };
    default:
      return { kind: "default" };
  }
}
