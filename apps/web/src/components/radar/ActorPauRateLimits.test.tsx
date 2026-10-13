// @vitest-environment jsdom
// The rate-limit table keys each row and its "Matches Atlas" mark by contract
// and key, so two RateLimits of one deployment holding the same key are two
// rows, each marked only when its own values match the atlas.
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { matchId } from "@/lib/pauAtlasMatch";
import { PauRateLimits, type ContractLimit } from "./ActorPauRateLimits";

vi.mock("../../lib/pau", async (orig) => ({ ...(await orig<typeof import("../../lib/pau")>()), loadPauHistory: () => new Promise(() => {}) }));

const KEY = "0x" + "a".repeat(64);
const [RL1, RL2] = ["0x" + "1".repeat(40), "0x" + "2".repeat(40)];
const limit = (contract: string): ContractLimit => ({
  contract, key: KEY, configured: { maxAmount: "1000000", slope: "0" }, setAt: { block: 1, time: "2026-01-01T00:00:00Z", tx: "0xt" }, changes: 1, data: null, available: null,
});

describe("PauRateLimits", () => {
  it("marks only the contract whose values match when two hold the same key", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PauRateLimits chain="ethereum" limits={[limit(RL1), limit(RL2)]} keyIndex={new Map()} verdicts={new Map([[matchId(RL2, KEY), { mark: "match" as const, docId: "doc-2" }]])} anchor={{ id: "ethereum", aliases: [] }} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => within(r).queryByRole("link", { name: /^matches the atlas/ }))).toHaveLength(1);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    errors.mockRestore();
  });

  it("groups linked atlas keys first, then constant-named keys with same-name siblings together, a switched-off key staying in its run", () => {
    const k = (n: number) => "0x" + String(n).repeat(64);
    const mk = (key: string, constant?: string, args: string[] = [], maxAmount = "1000000"): ContractLimit => ({
      ...limit(RL1), key, configured: { maxAmount, slope: "0" }, ...(constant ? { derived: { constant, args } } : {}),
    });
    const limits = [mk(k(1), "LIMIT_4626_DEPOSIT", ["a"], "0"), mk(k(2), "LIMIT_USDS_MINT"), mk(k(3), "LIMIT_4626_DEPOSIT", ["b"]), mk(k(4)), mk(k(5), "LIMIT_4626_DEPOSIT", ["c"])];
    const keyIndex = new Map([[k(4), [{ docId: "doc", label: "Linked param" }]]]);
    const { container } = render(<PauRateLimits chain="ethereum" limits={limits} keyIndex={keyIndex} verdicts={new Map()} anchor={{ id: "ethereum", aliases: [] }} />);
    const names = within(container).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Linked param", "LIMIT_4626_DEPOSIT · a", "LIMIT_4626_DEPOSIT · b", "LIMIT_4626_DEPOSIT · c", "LIMIT_USDS_MINT"]);
  });

  it("links each verdict's mark to the document's Onchain tab: ✓ match, ✗ mismatch, ? unsure, and nothing without a verdict", () => {
    const verdicts = new Map([
      [matchId(RL1, KEY), { mark: "mismatch" as const, docId: "doc-1" }],
      [matchId(RL2, KEY), { mark: "unsure" as const, docId: "doc-2" }],
    ]);
    const { container } = render(<PauRateLimits chain="ethereum" limits={[limit(RL1), limit(RL2), limit("0x" + "3".repeat(40))]} keyIndex={new Map()} verdicts={verdicts} anchor={{ id: "ethereum", aliases: [] }} />);
    const cells = within(container).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[4]);
    expect(cells.map((c) => c.textContent)).toEqual(["✗", "?", ""]);
    expect(within(cells[0]).getByRole("link")).toHaveAttribute("href", "/atlas?id=doc-1&view=onchain");
    expect(within(cells[1]).getByRole("link")).toHaveAttribute("href", "/atlas?id=doc-2&view=onchain");
    expect(within(cells[2]).queryByRole("link")).toBeNull();
  });
});
