// What the atlas states that an svm snapshot probes: the Integration accounts
// and mints of a prime's Solana instances and invocations, and only values
// written as a 32-byte address.
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atlasSvmProbe } from "./svm-probe.ts";

const INT = "H5Vix4RGchYq1cemoe61y7J4j4v3XgWPGLBeqvPEgvzr";
const MINT = "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA";
const entity = (name: string, entity_type: string, params: Record<string, string>, agent = "keel") => ({
  name, entity_type, meta: JSON.stringify({ agent_doc_id: agent, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v, "doc"]])) }),
});
const probe = (entities: unknown[]) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "svm-probe-")), "graph.json");
  fs.writeFileSync(file, JSON.stringify({ entities }));
  return atlasSvmProbe(file);
};

describe("atlasSvmProbe", () => {
  it("reads the accounts of Solana instances and invocations, by prime", () => {
    const out = probe([
      entity("Solana - Kamino USDS", "instance", { Network: "Solana", "Integration Account Address": INT, "Underlying Asset Address": MINT }),
      entity("Solana - Drift USDS", "invocation", { "Underlying Asset Address": MINT }),
      entity("Ethereum Mainnet - Aave USDS", "instance", { "Integration Account Address": INT }),
      entity("Solana - A primitive", "primitive", { "Integration Account Address": INT }),
    ]);
    expect([...out]).toEqual([["keel", { integrations: [INT], mints: [MINT] }]]);
  });
  it("leaves out a value that is not a 32-byte address, a param of another name, and an instance whose name and Network disagree", () => {
    const out = probe([
      entity("Solana - Kamino USDS", "instance", { "Integration Account Address": INT.slice(0, 40), "Underlying Asset Address": "N/A", "Old Integration Account Address": INT }),
      entity("Solana - Kamino USDC", "instance", { Network: "Base", "Integration Account Address": INT }),
    ]);
    expect([...out]).toEqual([["keel", { integrations: [], mints: [] }]]);
  });
  it("probes nothing when the graph is not built", () => {
    expect(atlasSvmProbe("/nonexistent/graph.json").size).toBe(0);
  });
});
