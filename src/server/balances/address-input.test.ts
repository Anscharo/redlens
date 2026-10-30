// Which atlas_addresses rows count as a labelled multisig for the Safe read.
import { test, expect } from "bun:test";
import { isLabelledMultisig, toAddressInput } from "./address-input.ts";

test("isLabelledMultisig: a multisig role or a verified SafeProxy, from decoded or string jsonb", () => {
  expect(isLabelledMultisig(["multisig", "operator"], null)).toBe(true);
  expect(isLabelledMultisig('["multisig"]', null)).toBe(true);
  expect(isLabelledMultisig([], "SafeProxy")).toBe(true);
  expect(isLabelledMultisig(["token"], "Dai")).toBe(false);
  expect(isLabelledMultisig(null, null)).toBe(false);
  expect(isLabelledMultisig("not json", null)).toBe(false);
});

test("toAddressInput: carries the multisig label next to the balance fields", () => {
  expect(toAddressInput({ address: "0xa", chain: "base", expected_tokens: null, is_contract: null, roles: ["multisig"], etherscan_name: null }))
    .toEqual({ address: "0xa", chain: "base", expectedTokens: [], isContract: false, multisig: true });
});
