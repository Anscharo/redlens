// Pure row-builder tests. Run under `bun test`.
//
// These lock the DB round-trip contract the in-process updater depends on:
// a node written to atlas_doc_meta by sync must rebuild to the SAME node shape
// when the updater reads it back (docRowToNode). The review found contentHash
// and addressRefs were silently dropped on that path; these tests would have
// caught it — and also catch the tempting-but-wrong "reuse content_hash" fix,
// since content_hash is the embed-text hash, not the parser hash OEA keys on.
import { expect, test } from "bun:test";
import { nodeToDocRow, buildChainStateByAddr, buildAddrRows } from "./doc-rows.ts";
import { docRowToNode, type DocMetaRow, type AtlasNode } from "./indexes.ts";
import { contentHash as embedContentHash } from "./embed-text.ts";

const SHA = "a".repeat(40);

// Mimic the updater's SELECT column aliasing (parent_id AS "parentId",
// ord AS "order", node_content_hash AS "contentHash", address_refs AS "addressRefs").
function writeRowToReadRow(w: ReturnType<typeof nodeToDocRow>): DocMetaRow {
  return {
    id: w.id,
    doc_no: w.doc_no,
    title: w.title,
    type: w.type,
    depth: w.depth,
    parentId: w.parent_id,
    content: w.content,
    order: w.ord,
    contentHash: w.node_content_hash ?? undefined,
    addressRefs: w.address_refs,
  };
}

const sampleNode: AtlasNode = {
  id: "11111111-1111-1111-1111-111111111111",
  doc_no: "A.1.2.3",
  title: "Sample Node",
  type: "Core",
  depth: 4,
  parentId: "22222222-2222-2222-2222-222222222222",
  order: 7,
  content: "Body mentioning 0xAbC0000000000000000000000000000000000001 and more.",
  contentHash: "parserhash_sha256_of_raw_slice",
  addressRefs: ["0xabc0000000000000000000000000000000000001"],
};

test("docRowToNode(nodeToDocRow(n)) round-trips every persisted field, incl. contentHash + addressRefs", () => {
  const back = docRowToNode(writeRowToReadRow(nodeToDocRow(sampleNode, SHA)));
  expect(back).toEqual({
    id: sampleNode.id,
    doc_no: sampleNode.doc_no,
    title: sampleNode.title,
    type: sampleNode.type,
    depth: sampleNode.depth,
    parentId: sampleNode.parentId,
    content: sampleNode.content,
    order: sampleNode.order,
    contentHash: sampleNode.contentHash,
    addressRefs: sampleNode.addressRefs,
  });
});

test("node_content_hash is the parser hash, NOT the embed-text content_hash (they must differ)", () => {
  const row = nodeToDocRow(sampleNode, SHA);
  expect(row.node_content_hash).toBe(sampleNode.contentHash!);
  expect(row.content_hash).toBe(embedContentHash(sampleNode));
  // The whole point of the dedicated column: these two hashes are not equal, so
  // filling contentHash from content_hash (the review's quick-win) would flip
  // every OEA row stale.
  expect(row.content_hash).not.toBe(row.node_content_hash);
});

test("a node with no addressRefs/contentHash round-trips to [] / undefined (no crash)", () => {
  const bare: AtlasNode = {
    id: "33333333-3333-3333-3333-333333333333",
    doc_no: "A.9",
    title: "Bare",
    type: "Scope",
    depth: 1,
    parentId: null,
    order: 0,
    content: "",
    addressRefs: [],
  };
  const back = docRowToNode(writeRowToReadRow(nodeToDocRow(bare, SHA)));
  expect(back.addressRefs).toEqual([]);
  expect(back.contentHash).toBeUndefined();
  expect(back.parentId).toBeNull();
});

// ── Solana casing (review exec #2 / BUILD B2) ────────────────────────────────

const SOLANA = "So11111111111111111111111111111111111111112"; // mixed-case base58
const EVM_UPPER = "0xABCDEF0000000000000000000000000000000001";

test("buildChainStateByAddr preserves Solana case and lowercases EVM keys", () => {
  const cs = buildChainStateByAddr({
    chains: {
      solana: { slot: 5, values: { [SOLANA]: { balance: 1 } } },
      ethereum: { block: 9, values: { [EVM_UPPER]: { balance: 2 } } },
    },
  });
  expect(cs[SOLANA]).toBeDefined(); // exact case retained
  expect(cs[SOLANA].block).toBe(5);
  expect(cs[EVM_UPPER.toLowerCase()]).toBeDefined();
  expect(cs[EVM_UPPER]).toBeUndefined(); // original (upper) key not used for EVM
});

test("buildAddrRows keeps Solana case, lowercases EVM, and joins chain-state by normalized key", () => {
  const chainStateByAddr = buildChainStateByAddr({
    chains: {
      solana: { slot: 5, values: { [SOLANA]: { balance: 1 } } },
      ethereum: { block: 9, values: { [EVM_UPPER]: { balance: 2 } } },
    },
  });
  const rows = buildAddrRows(
    {
      [SOLANA]: { chain: "solana", entityLabel: "Sol Thing" },
      [EVM_UPPER]: { chain: "ethereum", entityLabel: "Evm Thing" },
    },
    {},
    chainStateByAddr,
    SHA,
  );
  const sol = rows.find((r) => r.chain === "solana")!;
  const evm = rows.find((r) => r.chain === "ethereum")!;
  expect(sol.address).toBe(SOLANA); // NOT lowercased
  expect(sol.chain_state).toMatchObject({ block: 5, balance: 1 });
  expect(evm.address).toBe(EVM_UPPER.toLowerCase());
  expect(evm.chain_state).toMatchObject({ block: 9, balance: 2 });
});

test("buildChainStateByAddr handles the flat (no `chains`) shape — top-level values/block", () => {
  const cs = buildChainStateByAddr({
    block: 42,
    values: { [EVM_UPPER]: { balance: 3 } },
  });
  expect(cs[EVM_UPPER.toLowerCase()]).toMatchObject({ block: 42, values: { balance: 3 } });
});

test("buildChainStateByAddr on the flat shape defaults block to null when omitted", () => {
  const cs = buildChainStateByAddr({ values: { [EVM_UPPER]: { balance: 1 } } });
  expect(cs[EVM_UPPER.toLowerCase()].block).toBeNull();
});

test("buildAddrRows dedupes case-variant EVM addresses by (address, chain) — no duplicate PK", () => {
  const rows = buildAddrRows(
    {
      "0xABCDEF0000000000000000000000000000000001": { chain: "ethereum", entityLabel: "A" },
      "0xabcdef0000000000000000000000000000000001": { chain: "ethereum", entityLabel: "B" },
    },
    {},
    {},
    SHA,
  );
  const eth = rows.filter((r) => r.chain === "ethereum");
  expect(eth).toHaveLength(1);
  expect(eth[0].address).toBe("0xabcdef0000000000000000000000000000000001");
});
