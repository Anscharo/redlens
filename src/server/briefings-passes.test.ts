// The embed pass's tolerance for what the driver hands back and for failing
// slices, and the runner's refusal to work on an empty atlas.
import { describe, it, expect } from "bun:test";
import { embedPass, runBriefings } from "./briefings-passes.ts";
import type { BriefingDeps, Live } from "./briefings-deps.ts";
import type { ToEmbed } from "./briefings-store.ts";
import { briefingEmbedText } from "../../scripts/lib/doc-briefings.mjs";

const row = (n: number, questions: unknown): ToEmbed => ({ doc_id: `u${n}`, briefing: `B${n}`, questions, briefing_hash: `h${n}` });

function setup(rows: ToEmbed[], embedBatch: BriefingDeps["embedBatch"], batch = 50) {
  const written: string[] = [];
  const deps = {
    store: {
      loadToEmbed: async () => rows,
      writeVector: async (id: string) => void written.push(id),
    },
    embedBatch,
    embedBatchSize: batch,
    now: () => Date.now(),
    sleep: async () => {},
  } as unknown as BriefingDeps;
  return { deps, written };
}
const LIVE = { docs: [] } as unknown as Live;

describe("embed pass question handling", () => {
  it("accepts an array, a JSON string, an unparseable string and a non-array", async () => {
    const seen: string[][] = [];
    const { deps } = setup(
      [row(1, ["Q1?", 7]), row(2, '["Q2?"]'), row(3, "not json"), row(4, { a: 1 }), row(5, '"just a string"')],
      async (t) => (seen.push(t), t.map(() => [1])),
    );
    expect(await embedPass(deps, LIVE)).toBe(5);
    const text = (briefing: string, questions: string[]) => briefingEmbedText({ briefing, questions });
    expect(seen[0]).toEqual([text("B1", ["Q1?"]), text("B2", ["Q2?"]), text("B3", []), text("B4", []), text("B5", [])]);
  });
});

describe("embed pass failures", () => {
  it("skips a slice that keeps failing and still embeds the next one", async () => {
    let calls = 0;
    const warns: string[] = [];
    const warn = console.warn;
    console.warn = (...a) => void warns.push(a.join(" "));
    const { deps, written } = setup([row(1, []), row(2, []), row(3, [])], async (t) => {
      calls++;
      if (t[0]!.startsWith("B1")) throw new Error("provider down");
      return t.map(() => [1]);
    }, 2);
    try {
      expect(await embedPass(deps, LIVE)).toBe(1);
    } finally {
      console.warn = warn;
    }
    expect(calls).toBe(4); // three attempts at the first slice, one at the second
    expect(written).toEqual(["u3"]);
    expect(warns.join()).toContain("embed @0 (2 rows) failed after retries: provider down");
  });
});

describe("runBriefings", () => {
  it("stops with a warning when atlas_doc_meta is empty", async () => {
    const warns: string[] = [];
    const warn = console.warn;
    console.warn = (...a) => void warns.push(a.join(" "));
    let migrated = false;
    const deps = {
      runMigrations: async () => void (migrated = true),
      store: {
        loadSnapshot: async () => ({ atlasSha: null, docs: [] }),
        loadSeedHash: async () => assertUnreached(),
      },
    } as unknown as BriefingDeps;
    try {
      await runBriefings(deps);
    } finally {
      console.warn = warn;
    }
    expect(migrated).toBe(true);
    expect(warns.join()).toContain("atlas_doc_meta is empty");
  });
});

function assertUnreached(): never {
  throw new Error("no pass may run on an empty atlas");
}
