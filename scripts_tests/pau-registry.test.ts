// The committed PAU registry and the diff that keeps it honest.
//
// The registry is hand-curated, so its invariants are tested rather than
// trusted: structure (validatePauRegistry), and every member's verified
// explorer name in the committed .cache/etherscan/ cache agreeing with the
// role it is filed under — the check that would have caught an atlas
// copy-paste (a Base ForeignController filed as Plume's rate limits) had it
// reached the registry.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAIN_ID } from "../scripts/lib/chains.mjs";
import { EXPECTED_NAME, atlasConflicts, missingFromRegistry, staleMembers } from "../scripts/lib/pau-diff.ts";
import type { PauObservation } from "../scripts/lib/pau-discover.ts";
import { validatePauRegistry, type PauRegistry } from "../src/lib/pauRegistry.ts";
import type { AtlasNode } from "../src/types.ts";

const ROOT = path.resolve(__dirname, "..");
const registry: PauRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/pau-registry.json"), "utf8"));

function cachedName(chain: string, address: string): string | undefined {
  const file = path.join(ROOT, `.cache/etherscan/${CHAIN_ID[chain]}/${address}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).contractName || undefined : undefined;
}

describe("src/data/pau-registry.json", () => {
  it("is structurally valid", () => {
    expect(validatePauRegistry(registry)).toEqual([]);
  });
  it("files every member under a role its verified contract name agrees with", () => {
    const groups = [...registry.deployments, ...registry.shared];
    const wrong = groups.flatMap((g) =>
      g.members.flatMap((m) => {
        const name = cachedName(g.chain, m.address);
        return name && !EXPECTED_NAME[m.role].test(name) ? [`${g.chain} ${m.role} ${m.address} is ${name}`] : [];
      }),
    );
    expect(wrong).toEqual([]);
  });
  it("never both holds and ignores the same claim", () => {
    const held = new Set(registry.deployments.flatMap((d) => d.members.map((m) => `${d.prime}:${d.chain}:${m.role}:${m.address}`)));
    expect(registry.ignored.filter((g) => held.has(`${g.prime}:${g.chain}:${g.role}:${g.address}`))).toEqual([]);
  });
});

const P = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const obs = (o: Partial<PauObservation>): PauObservation => ({
  prime: P, chain: "base", chainFrom: "title", kind: "monolithic", role: "controller", address: A, doc: DOC, docNo: "A.6.1", title: "t", ...o,
});
const reg = (members: PauRegistry["deployments"][0]["members"], ignored: PauRegistry["ignored"] = []): PauRegistry => ({
  shared: [], ignored, deployments: [{ prime: P, primeName: "P", chain: "base", kind: "monolithic", members }],
});

describe("validatePauRegistry", () => {
  it("rejects mixed-case addresses, atlas provenance without a doc, and two controllers", () => {
    const errs = validatePauRegistry(
      reg([
        { role: "controller", address: A.toUpperCase().replace("0X", "0x"), provenance: [{ source: "atlas" }] },
        { role: "controller", address: B, provenance: [{ source: "manual" }] },
      ]),
    );
    expect(errs.join("\n")).toMatch(/lowercase/);
    expect(errs.join("\n")).toMatch(/needs a doc UUID/);
    expect(errs.join("\n")).toMatch(/more than one controller/);
  });
});

describe("missingFromRegistry", () => {
  it("drops held and ignored claims; an any-chain multisig matches any of the prime's chains", () => {
    const r = reg([{ role: "relayer", address: B, provenance: [{ source: "manual" }] }], [
      { prime: P, chain: "base", role: "controller", address: A, reason: "superseded" },
    ]);
    expect(missingFromRegistry([obs({}), obs({ role: "relayer", address: B, chain: "*", kind: null })], r)).toEqual([]);
    expect(missingFromRegistry([obs({ chain: "optimism" })], r)).toHaveLength(1);
  });
});

describe("staleMembers", () => {
  it("flags atlas provenance whose doc is gone or no longer names the address", () => {
    const r = reg([{ role: "controller", address: A, provenance: [{ source: "atlas", doc: DOC }] }]);
    const doc = { id: DOC, addressRefs: [B] } as AtlasNode;
    expect(staleMembers(r, { [DOC]: doc })[0].reason).toBe("address-removed");
    expect(staleMembers(r, {})[0].reason).toBe("doc-removed");
    expect(staleMembers(r, { [DOC]: { ...doc, addressRefs: [A] } })).toEqual([]);
  });
});

describe("atlasConflicts", () => {
  it("reports one address under two roles, and a verified name that contradicts the role", () => {
    const found = atlasConflicts(
      [obs({}), obs({ chain: "plume", role: "rateLimits" })],
      (_addr, chain) => (chain === "plume" ? "ForeignController" : undefined),
    );
    expect(found.map((c) => c.reason).sort()).toEqual(["explorer-name", "roles"]);
  });
});
