// The cooldown store reads only cooldowns still running and never shortens one.
import { describe, expect, it } from "bun:test";
import { dbCooldownStore } from "./upstream-cooldowns.ts";

function fakeDb(rows: unknown[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const db = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?"), values });
    return rows;
  };
  return { db, queries };
}

describe("dbCooldownStore", () => {
  it("loads running cooldowns as epoch milliseconds", async () => {
    const { db, queries } = fakeDb([{ host: "rpc.example", until: new Date("2026-10-09T12:30:00Z") }, { host: "x.example", until: "2026-10-09T13:00:00Z" }]);
    expect(await dbCooldownStore(db).load()).toEqual([
      { host: "rpc.example", until: Date.parse("2026-10-09T12:30:00Z") },
      { host: "x.example", until: Date.parse("2026-10-09T13:00:00Z") },
    ]);
    expect(queries[0].text).toContain("until > now()");
  });

  it("saves a cooldown as a timestamp, keeping the later of two", async () => {
    const { db, queries } = fakeDb([]);
    await dbCooldownStore(db).save("rpc.example", Date.parse("2026-10-09T12:30:00Z"));
    expect(queries[0].values).toEqual(["rpc.example", new Date("2026-10-09T12:30:00Z")]);
    expect(queries[0].text).toContain("GREATEST(upstream_cooldown.until, excluded.until)");
  });
});
