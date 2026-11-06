import { describe, it, expect } from "bun:test";
import { cardFromQuery, cardToQuery, type QueryCardSpec } from "./og-card-spec.ts";

describe("cardFromQuery", () => {
  const spec = (q: string) => cardFromQuery(new URLSearchParams(q));
  it("maps each kind (and defaults on unknown/missing)", () => {
    expect(spec("kind=radar")).toEqual({ kind: "radar" });
    expect(spec("kind=radar-actor&name=Spark")).toEqual({ kind: "radarActor", agent: "Spark" });
    expect(spec("kind=reports")).toEqual({ kind: "reports" });
    expect(spec("kind=report&name=Stale Dates")).toEqual({ kind: "report", name: "Stale Dates" });
    expect(spec("kind=connect")).toEqual({ kind: "connect" });
    expect(spec("kind=preview&label=PR #1")).toEqual({ kind: "preview", label: "PR #1" });
    expect(spec("")).toEqual({ kind: "default" });
    expect(spec("kind=nonsense")).toEqual({ kind: "default" });
  });
});

// cardToQuery (og.ts's encoder) and cardFromQuery (the /api/og.png decoder)
// are a paired contract — every variant must survive the round trip, and a
// query string that isn't one cardToQuery could have produced must still
// degrade to the default card rather than erroring or fabricating a card.
describe("cardToQuery / cardFromQuery round-trip", () => {
  const SPECS: QueryCardSpec[] = [
    { kind: "default" },
    { kind: "radar" },
    { kind: "radarActor", agent: "Spark Protocol" },
    { kind: "reports" },
    { kind: "report", name: "Stale Dates" },
    { kind: "connect" },
    { kind: "preview", label: "PR #184" },
  ];

  it("every QueryCardSpec variant encodes then decodes back to itself", () => {
    for (const spec of SPECS) {
      const query = cardToQuery(spec);
      expect(cardFromQuery(new URLSearchParams(query))).toEqual(spec);
    }
  });

  it("percent-encodes name/label values that contain query-syntax characters", () => {
    const query = cardToQuery({ kind: "report", name: "R&D / Risk" });
    expect(query).toBe("kind=report&name=R%26D%20%2F%20Risk");
    expect(cardFromQuery(new URLSearchParams(query))).toEqual({ kind: "report", name: "R&D / Risk" });
  });

  it("malformed/unrecognized kind degrades to the default card", () => {
    expect(cardFromQuery(new URLSearchParams("kind=totally-bogus"))).toEqual({ kind: "default" });
    expect(cardFromQuery(new URLSearchParams("name=Spark"))).toEqual({ kind: "default" }); // kind missing entirely
  });
});
