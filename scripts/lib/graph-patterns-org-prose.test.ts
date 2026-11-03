import { describe, it, expect } from "vitest";
import { PRIME_FOUNDATION_RE, PROVIDES_SERVICES_RE, cleanOrgProseName } from "./graph-patterns.mjs";

function names(re: RegExp, text: string): [string, string] | null {
  re.lastIndex = 0;
  const m = re.exec(text);
  return m ? [cleanOrgProseName(m[1]), cleanOrgProseName(m[2])] : null;
}

describe("PROVIDES_SERVICES_RE", () => {
  it("reads both article forms", () => {
    expect(names(PROVIDES_SERVICES_RE, "Phoenix Labs is a development company that provides services to the Spark Foundation.")).toEqual([
      "Phoenix Labs",
      "Spark Foundation",
    ]);
    expect(names(PROVIDES_SERVICES_RE, "Treadstone is the development company that provides services to Rubicon.")).toEqual([
      "Treadstone",
      "Rubicon",
    ]);
  });

  it("takes the current name before a parenthetical aside", () => {
    const text =
      'Grove Labs (formerly Grove Development Company) is a development company that provides services to the Grove Foundation. Grove Labs is a "Nested Contributor".';
    expect(names(PROVIDES_SERVICES_RE, text)).toEqual(["Grove Labs", "Grove Foundation"]);
  });

  it("accepts an aside after the second name", () => {
    expect(names(PROVIDES_SERVICES_RE, "Phoenix Labs is a development company that provides services to the Spark Foundation (the Foundation).")).toEqual([
      "Phoenix Labs",
      "Spark Foundation",
    ]);
  });
});

describe("PRIME_FOUNDATION_RE", () => {
  it("strips a leading article and skips an aside", () => {
    expect(names(PRIME_FOUNDATION_RE, "The Spark Foundation is the Prime Foundation associated with Spark.")).toEqual(["Spark Foundation", "Spark"]);
    expect(names(PRIME_FOUNDATION_RE, "Rubicon (formerly Obex Foundation) is the Prime Foundation associated with Obex.")).toEqual(["Rubicon", "Obex"]);
  });
});
