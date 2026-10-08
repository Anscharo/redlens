// @vitest-environment jsdom
// The right panel's "Atlas vs contract" table: one row per value the document
// states, the atlas and contract side by side under their column headings, a
// mismatch marked, and a value the contract cannot be compared on saying why.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, renderHook, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PauResponse } from "../../lib/pau";
import type { DocValueSources } from "@/lib/pauDocSources";

const KEY = "0x" + "1".repeat(64);
const at = { block: 1, time: "2025-12-15T00:00:00.000Z", tx: "0x" + "9".repeat(64) };
const limit = (maxAmount: string, slope: string) => ({ key: KEY, configured: { maxAmount, slope }, setAt: at, changes: 1, data: { maxAmount, slope, lastAmount: "0", lastUpdated: "0" }, available: "0", unit: { decimals: 6, symbol: "USDC", source: "token" as const } });
const served: PauResponse = {
  deployments: [{ deployment: "p:ethereum:monolithic", prime: "p", primeName: "Grove", chain: "ethereum", kind: "monolithic", fetchedAt: "t", contracts: [{ role: "rateLimits", address: "0x" + "f".repeat(40), events: 1, historyComplete: true, rateLimits: [limit("20000000000000", "231481481")] }] }],
};
vi.mock("../../lib/pau", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/pau")>()), loadPau: () => Promise.resolve(served) }));

import { AtlasVsContract, useAtlasVsContract } from "./AtlasVsContract";

const p = (v: string, n: string): [string, string] => [v, `doc-${n}`];
const sources: DocValueSources = {
  prime: "p",
  sources: [{ name: "Ethereum Mainnet - Vault", docId: "inst", params: {
    "Inflow RateLimitID": p(KEY, "key"), "Deposit Rate Limits / maxAmount": p("0", "max"), "Deposit Rate Limits / slope": p("20,000,000 USDC per day", "slope"),
    "Withdrawal Rate Limits / maxAmount": p("N/A", "na"),
  } }],
};

afterEach(cleanup);

describe("AtlasVsContract", () => {
  it("keeps the rows of the open document: all of an instance's, one for a value's own doc", async () => {
    const all = renderHook(() => useAtlasVsContract("inst", sources));
    await waitFor(() => expect(all.result.current).toHaveLength(3));
    const one = renderHook(() => useAtlasVsContract("doc-max", sources));
    await waitFor(() => expect(one.result.current.map((c) => c.label)).toEqual(["Deposit maxAmount"]));
  });
  it("lays the atlas and contract out under their headings, marks a mismatch, and says why a value is not compared", async () => {
    const { result } = renderHook(() => useAtlasVsContract("inst", sources));
    await waitFor(() => expect(result.current).toHaveLength(3));
    render(<AtlasVsContract rows={result.current} />);
    expect(screen.getByText("Atlas vs contract · 3")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Value", "Atlas", "Contract", "Status", "Set"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["mismatch", "match", "not-stated"]);
    expect(rows[0]).toHaveTextContent(/Deposit maxAmount\s*0\s*20M USDC\s*✗\s*2025-12-15/);
    expect(rows[1]).toHaveTextContent("20M USDC per day");
    expect(rows[2]).toHaveTextContent("the atlas sets no value yet");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", `https://etherscan.io/tx/${at.tx}`);
  });
});
