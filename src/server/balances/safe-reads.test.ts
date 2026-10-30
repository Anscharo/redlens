// Pure tests for the Safe owner/threshold read's call plan and answer checks.
import { test, expect } from "bun:test";
import { planSafeCalls, assembleSafes } from "./safe-reads.ts";

const A = "0x148ef923d764cbdc1597ccadbbbc66499c1a1432";
const B = "0x44effc473e81632b12486866aa1678edbb7beec3";
const O1 = "0xAAAA000000000000000000000000000000000001";
const O2 = "0xbbbb000000000000000000000000000000000002";

const ok = (result: unknown) => ({ status: "success" as const, result });
const fail = { status: "failure" as const };

test("planSafeCalls: threshold then owners per distinct lowercased address", () => {
  const { calls, order } = planSafeCalls([A, A.toUpperCase().replace("0X", "0x"), B]);
  expect(order).toEqual([A, B]);
  expect(calls.map((c) => `${c.address}:${c.functionName}`)).toEqual([
    `${A}:getThreshold`, `${A}:getOwners`, `${B}:getThreshold`, `${B}:getOwners`,
  ]);
});

test("assembleSafes: keeps a Safe with owners lowercased, drops a non-Safe", () => {
  const safes = assembleSafes([A, B], [ok(2n), ok([O1, O2]), fail, fail]);
  expect(safes.get(A)).toEqual({ threshold: 2, owners: [O1.toLowerCase(), O2.toLowerCase()] });
  expect(safes.has(B)).toBe(false);
});

test("assembleSafes: rejects answers that cannot be a Safe's setup", () => {
  const cases = [
    [ok(0n), ok([O1])], // threshold below one
    [ok(3n), ok([O1, O2])], // threshold above the owner count
    [ok(1n), ok([])], // no owners
    [ok(1n), fail], // half a Safe
    [ok("1"), ok([O1])], // not a uint
  ];
  for (const [t, o] of cases) expect(assembleSafes([A], [t, o]).size).toBe(0);
});
