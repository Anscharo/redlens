import { describe, expect, it } from "vitest";
import type { StoredPauSnapshot, TargetState } from "./pau.ts";
import { addressCheckId } from "./pauAddressChecks.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { checkVaultRoles } from "./vaultRoleChecks.ts";
import { vaultRoleOf } from "./vaultRoles.ts";

const [VAULT, OWNER, CURATOR, ALLOC, OTHER, ZERO] = ["1", "2", "3", "4", "5", "0"].map((c) => "0x" + c.repeat(40));
const TBS = "This parameter will be specified in a future iteration.";

const snaps = (target: TargetState, chain = "ethereum"): StoredPauSnapshot[] => [
  { deployment: "d", prime: "p", primeName: "P", chain, kind: "monolithic", contracts: [], fetchedAt: "2026-11-09T00:00:00Z", targets: { [VAULT]: target } },
];
const src = (params: Record<string, string>, name = "Ethereum Mainnet - Vault"): ValueSource => ({
  name, docId: "i", params: Object.fromEntries(Object.entries({ "Token Address": VAULT, ...params }).map(([k, v]) => [k, [v, "i"]])),
});
const check = (params: Record<string, string>, target: TargetState, name: string, s = snaps(target)) => checkVaultRoles([src(params)], s).get(addressCheckId("i", name));

describe("vaultRoleOf", () => {
  it("names the role a param states, and nothing for any other param", () => {
    expect(["Owner Role Address", "Allocator Role Addresses", "Sentinel Role Address", "Token Address", "Owner Timelock Contract Address"].map(vaultRoleOf)).toEqual(["owner", "allocator", "sentinel", null, null]);
  });
});

describe("checkVaultRoles: owner and curator", () => {
  const target = { owner: OWNER, curator: CURATOR };
  it("matches when the vault's account is among those the atlas states, and differs otherwise", () => {
    expect(check({ "Owner Role Address": `Held by its SubProxy at \`${OWNER}\`.` }, target, "Owner Role Address")?.status).toBe("match");
    const off = check({ "Curator Role Address": OTHER }, target, "Curator Role Address");
    expect(off).toMatchObject({ status: "mismatch", lines: expect.arrayContaining([{ label: "Atlas", value: "0x5555…5555" }]) });
  });
  it("flags an account the chain holds that the atlas leaves to be specified, but not an empty one", () => {
    expect(check({ "Owner Role Address": TBS }, target, "Owner Role Address")?.status).toBe("candidate");
    expect(check({ "Curator Role Address": TBS }, { curator: ZERO }, "Curator Role Address")?.status).toBe("not-stated");
  });
  it("says why it cannot answer", () => {
    expect(check({ "Owner Role Address": "Grove" }, target, "Owner Role Address")?.head).toBe("Can't be checked");
    expect(check({ "Owner Role Address": OWNER }, {}, "Owner Role Address")?.lines).toEqual([{ text: "Param or contract not yet indexed." }]);
    expect(check({ "Owner Role Address": OWNER }, target, "Owner Role Address", snaps(target, "base"))?.lines).toEqual([{ text: "Param or contract not yet indexed." }]);
  });
});

describe("checkVaultRoles: allocators and sentinels", () => {
  it("matches only when every named account holds the role", () => {
    expect(check({ "Allocator Role Addresses": `${ALLOC} and ${OTHER}` }, { allocators: { [ALLOC]: true, [OTHER]: true } }, "Allocator Role Addresses")?.status).toBe("match");
    const one = check({ "Allocator Role Addresses": `${ALLOC} and ${OTHER}` }, { allocators: { [ALLOC]: true, [OTHER]: false } }, "Allocator Role Addresses");
    expect(one).toMatchObject({ status: "mismatch", lines: expect.arrayContaining([{ label: "0x5555…5555", value: "Not an allocator" }]) });
    expect(check({ "Sentinel Role Address": ALLOC }, { sentinels: { [ALLOC]: true } }, "Sentinel Role Address")?.lines[0]).toEqual({ label: "0x4444…4444", value: "Sentinel" });
  });
  it("waits for an account the vault was not yet asked about, and has nothing to ask when the atlas names none", () => {
    expect(check({ "Allocator Role Address": ALLOC }, { owner: OWNER }, "Allocator Role Address")?.head).toBe("Can't be checked");
    expect(check({ "Allocator Role Address": TBS }, { owner: OWNER }, "Allocator Role Address")?.status).toBe("not-stated");
  });
  it("cannot check an instance that names no single vault", () => {
    const none = checkVaultRoles([{ ...src({ "Allocator Role Address": ALLOC }), params: { "Allocator Role Address": [ALLOC, "i"] } }], snaps({}));
    expect(none.get(addressCheckId("i", "Allocator Role Address"))?.lines).toEqual([{ text: "This instance lists no single vault address." }]);
  });
});
