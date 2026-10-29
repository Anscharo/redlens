// @vitest-environment jsdom
// The rate-limit table keys each row and its "Matches Atlas" mark by contract
// and key, so two RateLimits of one deployment holding the same key are two
// rows, each marked only when its own values match the atlas.
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { elsewhereId, matchId } from "@/lib/pauAtlasMatch";
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
    const cells = within(container).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[3]);
    expect(cells.map((c) => c.textContent)).toEqual(["✗", "?", ""]);
    expect(within(cells[0]).getByRole("link")).toHaveAttribute("href", "/atlas?id=doc-1&view=onchain");
    expect(within(cells[1]).getByRole("link")).toHaveAttribute("href", "/atlas?id=doc-2&view=onchain");
    expect(within(cells[2]).queryByRole("link")).toBeNull();
  });

  it("marks a key the Atlas values for another deployment on the same chain only, never linking into another chain's document", () => {
    const keyIndex = new Map([[KEY, [{ docId: "key-doc", label: "Aggregate CCTP" }]]]);
    const verdicts = new Map([[elsewhereId(KEY), { mark: "elsewhere" as const, docId: "value-doc", on: ["arbitrum diamond"] }]]);
    const cell = (chain: string) => {
      const { container } = render(<PauRateLimits chain={chain} limits={[limit(RL1)]} keyIndex={keyIndex} verdicts={verdicts} anchor={{ id: chain, aliases: [] }} />);
      return within(container).getAllByRole("row")[1].querySelectorAll("td")[3];
    };
    const sameChain = cell("arbitrum");
    expect([sameChain.textContent, within(sameChain).getByRole("link").getAttribute("href")]).toEqual(["?", "/atlas?id=value-doc&view=onchain"]);
    expect(within(cell("ethereum")).queryByRole("link")).toBeNull();
  });

  it("shows a key's name without a link on a chain its naming document is not under", () => {
    const keyIndex = new Map([[KEY, [{ docId: "key-doc", label: "Aggregate CCTP", chain: "arbitrum" }]]]);
    const name = (chain: string) => {
      const { container } = render(<PauRateLimits chain={chain} limits={[limit(RL1)]} keyIndex={keyIndex} verdicts={new Map()} anchor={{ id: chain, aliases: [] }} />);
      return within(container).getAllByRole("row")[1].querySelectorAll("td")[0];
    };
    expect(within(name("arbitrum")).getByRole("link", { name: "Aggregate CCTP" })).toHaveAttribute("href", "/atlas?id=key-doc");
    const other = name("ethereum");
    expect([other.textContent, within(other).queryByRole("link")]).toEqual(["Aggregate CCTP", null]);
  });

  it("adds the controller constant to an address-matched name that another key also carries", () => {
    const vault = "0x" + "7".repeat(40);
    const mk = (key: string, constant: string): ContractLimit => ({ ...limit(RL1), key, derived: { constant, args: [vault] } });
    const [withdraw, redeem, deposit] = ["0x" + "b".repeat(64), "0x" + "c".repeat(64), "0x" + "d".repeat(64)];
    const keyIndex = new Map([
      [withdraw, [{ docId: "maple", label: "Maple USDC · Outflow", via: vault, shared: true }]],
      [redeem, [{ docId: "maple", label: "Maple USDC · Outflow", via: vault, shared: true }]],
      [deposit, [{ docId: "maple", label: "Maple USDC · Inflow", via: vault }]],
    ]);
    const limits = [mk(withdraw, "LIMIT_4626_WITHDRAW"), mk(redeem, "LIMIT_MAPLE_REDEEM"), mk(deposit, "LIMIT_4626_DEPOSIT")];
    const { container } = render(<PauRateLimits chain="ethereum" limits={limits} keyIndex={keyIndex} verdicts={new Map()} anchor={{ id: "ethereum", aliases: [] }} />);
    const names = within(container).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names.sort()).toEqual([
      "Maple USDC · Inflow (matched by address)",
      "Maple USDC · Outflow · LIMIT_4626_WITHDRAW (matched by address)",
      "Maple USDC · Outflow · LIMIT_MAPLE_REDEEM (matched by address)",
    ]);
  });

  it("says when a constant-named limit's address was dropped from the Atlas", () => {
    const retired = { address: "0x" + "e9".repeat(20), removedAt: "2025-08-25T14:36:55Z", commit: "dd131566aa" };
    const row: ContractLimit = { ...limit(RL1), derived: { constant: "LIMIT_7540_DEPOSIT", args: [] }, retired };
    const { container } = render(<PauRateLimits chain="ethereum" limits={[row]} keyIndex={new Map()} verdicts={new Map()} anchor={{ id: "ethereum", aliases: [] }} />);
    expect(container.querySelector("td")?.textContent).toBe("LIMIT_7540_DEPOSIT · dropped from the Atlas 2025-08-25");
  });

  it("names the one document that names a constant-named limit's controller constant, beside it", () => {
    const row: ContractLimit = { ...limit(RL1), derived: { constant: "LIMIT_USDS_MINT", args: [] } };
    const doc = { id: "check-doc", title: "Check RateLimits", doc_no: "A.6.1" } as never;
    const render1 = (namedIn: (c: string, chain: string) => unknown) =>
      render(<PauRateLimits chain="ethereum" limits={[row]} keyIndex={new Map()} namedIn={namedIn as never} verdicts={new Map()} anchor={{ id: "ethereum", aliases: [] }} />);
    const { container, unmount } = render1((c, chain) => (c === "LIMIT_USDS_MINT" && chain === "ethereum" ? doc : null));
    const link = within(container).getByRole("link", { name: "Check RateLimits" });
    expect([link.getAttribute("href"), link.closest("td")?.textContent]).toEqual(["/atlas?id=check-doc", "LIMIT_USDS_MINT · named in Check RateLimits"]);
    unmount();
    const none = render1(() => null);
    expect(within(none.container.querySelector("td")!).queryByRole("link")).toBeNull();
  });
});
