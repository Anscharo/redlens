// @vitest-environment jsdom
// A RateLimitID in atlas prose: hovering it shows what the PAU contracts holding
// the key have it set to on chain, leaving out a chain where it is not set; a key
// none holds that live reads found never set says so; a hash no contract holds
// or lists, and a transaction hash, stay as they were.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import NodeContentInner from "./NodeContentInner";
import type { PauResponse } from "@/lib/pau";

const KEY = "0x" + "ab".repeat(32);
const UNKNOWN = "0x" + "cd".repeat(32);
const UNSET = "0x" + "12".repeat(32);
const TX = "0x" + "ef".repeat(32);
const M = 10n ** 6n;

const res: PauResponse = {
  deployments: [
    {
      deployment: "spark:ethereum", prime: "p", primeName: "Spark", chain: "ethereum", kind: "monolithic", fetchedAt: "2026-10-28T12:34:56Z",
      contracts: [{
        role: "rateLimits", address: "0x1", events: 1, historyComplete: true, unsetKeys: [UNSET],
        rateLimits: [{
          key: KEY,
          configured: { maxAmount: (50_000_000n * M).toString(), slope: "1" },
          setAt: { block: 1, time: "2026-01-01T00:00:00Z", tx: "0x" },
          changes: 1,
          data: { maxAmount: (50_000_000n * M).toString(), slope: ((20_000_000n * M) / 86_400n).toString(), lastAmount: "0", lastUpdated: "0" },
          available: "0",
          derived: { constant: "LIMIT_USDC_TO_CCTP", args: [] },
          unit: { decimals: 6, symbol: "USDC", source: "constant" },
        }],
      }],
    },
    {
      deployment: "spark:base", prime: "p", primeName: "Spark", chain: "base", kind: "monolithic", fetchedAt: "2026-10-28T12:34:56Z",
      contracts: [{ role: "rateLimits", address: "0x2", events: 0, historyComplete: true, unsetKeys: [KEY, UNSET] }],
    },
  ],
};

vi.mock("../lib/pau", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadPau: () => Promise.resolve(res),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

async function settle(ms = 0) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("rate-limit key hover", () => {
  it("shows the key's on-chain maxAmount and slope", async () => {
    const { container } = render(<NodeContentInner content={`The CCTP RateLimitID is: \`${KEY}\`.`} />);
    await settle();
    const code = container.querySelector(`code[data-rate-limit-key="${KEY}"]`)!;
    expect(code).not.toBeNull();
    fireEvent.mouseEnter(code);
    await settle(800);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Spark · Ethereum");
    expect(tip).toHaveTextContent("LIMIT_USDC_TO_CCTP");
    expect(tip).toHaveTextContent("maxAmount50M USDC");
    expect(tip).toHaveTextContent("slope20M USDC per day");
    expect(tip).toHaveTextContent("read 2026-10-28 12:34 UTC");
    // Base's RateLimits was probed and never set the key, so the card leaves that chain out.
    expect(tip).not.toHaveTextContent("Base");
  });

  it("says a key no PAU contract holds is not set on any chain when every one read it live", async () => {
    const { container } = render(<NodeContentInner content={`The transfer RateLimitID is: \`${UNSET}\``} />);
    await settle();
    fireEvent.mouseEnter(container.querySelector(`code[data-rate-limit-key="${UNSET}"]`)!);
    await settle(800);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Not set on any chain");
    expect(tip).toHaveTextContent("never been set on Spark: Ethereum, Base");
    expect(tip).not.toHaveTextContent("Not read yet");
    expect(tip).toHaveTextContent("read 2026-10-28 12:34 UTC");
  });

  it("leaves a hash no PAU contract holds, and a transaction hash, without a hover card", async () => {
    const { container } = render(<NodeContentInner content={`Pool ID: \`${UNKNOWN}\`. Transaction Hash: \`${TX}\``} />);
    await settle();
    expect(container.querySelector("code.rl-key")).toBeNull();
    expect(container.querySelectorAll("code")).toHaveLength(2);
    expect(screen.getByRole("link", { name: TX })).toHaveAttribute("href", `https://etherscan.io/tx/${TX}`);
  });
});
