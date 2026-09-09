// Pure unit test for the onchain_addresses report builder. Runs under `bun
// test` (NOT vitest — src/server is excluded there). publicDir and the
// balances loader are both injectable, so this never touches a real DB.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOnchainAddressesReport } from "./onchain-addresses.ts";
import type { Indexes, AtlasNode } from "../retrieval/indexes.ts";
import type { AddressBalances } from "../../lib/balances.ts";

const ADDR = "0x1111111111111111111111111111111111dead";

function node(id: string, doc_no: string, title: string, addressRefs: string[]): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 3, parentId: null, order: 0, content: "", contentHash: `h-${id}`, addressRefs } as AtlasNode;
}

function makeIx(): Indexes {
  const docs = [node("A", "A.2.1", "Treasury Multisig", [ADDR])];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return {
    docMap,
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities: [],
    edges: [],
    meta: { atlasCommit: "test" },
  } as unknown as Indexes;
}

// `fn` is awaited BEFORE the temp dir is removed — the builder's own
// readPublicJson calls happen to run synchronously today (before its first
// `await`), so a bare `finally` would still pass, but only by accident: it
// would start deleting the dir out from under a future version of the
// builder that reads a file after an await (e.g. balances before addresses).
async function withAddressArtifacts<T>(fn: (publicDir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "addr-test-"));
  fs.writeFileSync(
    path.join(dir, "addresses.atlas.json"),
    JSON.stringify({
      addresses: {
        [ADDR]: { chain: "ethereum", roles: ["multisig"], aliases: [], expectedTokens: [] },
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "addresses.json"),
    JSON.stringify({
      [ADDR]: { chain: "ethereum", chainlogId: "MCD_TREASURY", isContract: true, isProxy: false },
    }),
  );
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const noBalances = async (): Promise<Record<string, AddressBalances>> => ({});

test("buildOnchainAddressesReport merges the two address artifacts and joins live doc mentions", async () => {
  await withAddressArtifacts(async (publicDir) => {
    const r = (await buildOnchainAddressesReport(makeIx(), { include_provenance: true }, publicDir, noBalances)) as any;
    expect(r.report).toBe("onchain_addresses");
    expect(r.total).toBe(1);
    const row = r.addresses[0];
    expect(row.chainlogId).toBe("MCD_TREASURY");
    expect(row.type).toBe("Multisig");
    expect(row.docs).toHaveLength(1);
    expect(row.docs[0].docNo).toBe("A.2.1");
  });
});

test("a cached balance for the address lands on its row — the one thing this tool has that atlas_get_address doesn't need", async () => {
  await withAddressArtifacts(async (publicDir) => {
    const withBalance = async (): Promise<Record<string, AddressBalances>> => ({
      [`${ADDR}|ethereum`]: {
        chain: "ethereum",
        checkedAt: "2026-09-01T00:00:00Z",
        balances: { ETH: { raw: "1500000000000000000", decimals: 18 } },
        hasCode: true,
      },
    });
    const r = (await buildOnchainAddressesReport(makeIx(), { include_provenance: true }, publicDir, withBalance)) as any;
    const row = r.addresses[0];
    expect(row.balances.ETH).toEqual({ raw: "1500000000000000000", decimals: 18 });
    expect(row.balancesCheckedAt).toBe("2026-09-01T00:00:00Z");
  });
});

test("include_provenance:false collapses the doc list to a count", async () => {
  await withAddressArtifacts(async (publicDir) => {
    const r = (await buildOnchainAddressesReport(makeIx(), { include_provenance: false }, publicDir, noBalances)) as any;
    const row = r.addresses[0];
    expect(row.docs).toEqual([]);
    expect(row.docCount).toBe(1);
    expect(row.chainlogId).toBe("MCD_TREASURY"); // resolved fields still present
  });
});

test("balances loader failure (e.g. DB unreachable) degrades to empty balances, not a throw", async () => {
  await withAddressArtifacts(async (publicDir) => {
    const failing = async (): Promise<Record<string, AddressBalances>> => {
      throw new Error("db down");
    };
    const r = (await buildOnchainAddressesReport(makeIx(), { include_provenance: true }, publicDir, failing)) as any;
    expect(r.report).toBe("onchain_addresses");
    expect(r.addresses[0].balances).toEqual({});
    // Everything not sourced from the balances table still answers.
    expect(r.addresses[0].chainlogId).toBe("MCD_TREASURY");
  });
});

test("missing address artifacts degrade to zero rows, not a throw", async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "addr-empty-"));
  try {
    const r = (await buildOnchainAddressesReport(makeIx(), { include_provenance: true }, emptyDir, noBalances)) as any;
    expect(r.report).toBe("onchain_addresses");
    expect(r.total).toBe(0);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
