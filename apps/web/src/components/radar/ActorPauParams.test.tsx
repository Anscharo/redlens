// @vitest-environment jsdom
// A PAU's parameters: each address renders through Address (named by its token
// symbol when read), guards read as words, and a guard no rate limit lets act is
// not shown.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { StoredPauSnapshot } from "../../lib/pau";
import { PauParams } from "./ActorPauParams";

const [ATOKEN, POOL, RECIPIENT] = ["2", "3", "4"].map((c) => "0x" + c.repeat(40));
const at = { block: 1, time: "2026-09-01T00:00:00.000Z", tx: "0x" + "9".repeat(64) };
const lim = (constant: string, args: string[], maxAmount: string) => ({
  key: "0x" + constant.length.toString(16).padStart(64, "0"), configured: { maxAmount, slope: "0" }, setAt: at, changes: 1, available: null,
  data: { maxAmount, slope: "0", lastAmount: maxAmount, lastUpdated: "1" }, derived: { constant, args },
});
const snap: StoredPauSnapshot = {
  deployment: "p:ethereum:monolithic", prime: "p", primeName: "Spark", chain: "ethereum", kind: "monolithic", fetchedAt: at.time,
  contracts: [
    { role: "controller", address: "0x" + "c".repeat(40), events: 3, historyComplete: true, params: [
      { event: "MaxSlippageSet", subject: ATOKEN, args: { pool: ATOKEN, maxSlippage: "999990000000000000" }, setAt: at, subjectToken: { decimals: 6, symbol: "spUSDC", token: ATOKEN, source: "token" } },
      { event: "MaxSlippageSet", subject: POOL, args: { pool: POOL, maxSlippage: "998000000000000000" }, setAt: at },
      { event: "MintRecipientSet", subject: "3", args: { destinationDomain: "3", mintRecipient: "0x000000000000000000000000" + RECIPIENT.slice(2) }, setAt: at },
    ] },
    { role: "rateLimits", address: "0x" + "1".repeat(40), events: 2, historyComplete: true, rateLimits: [lim("LIMIT_AAVE_DEPOSIT", [ATOKEN], "5"), lim("LIMIT_CURVE_SWAP", [POOL], "0")] },
  ],
};

afterEach(cleanup);

describe("PauParams", () => {
  it("shows a guard in use with its subject's symbol, its kind and its value in words", () => {
    render(<PauParams snap={snap} anchor={{ id: "spark-ethereum", aliases: [] }} />);
    const row = document.querySelector('li[data-use="on"]') as HTMLElement;
    expect(row).toHaveTextContent(/^Max slippage spUSDC Aave market → at most 0.001% loss \(≥ 99.999% back\) set 2026-09-01/);
    expect(row).toHaveAttribute("title", expect.stringContaining("LIMIT_AAVE_DEPOSIT"));
    expect(within(row).getByRole("link", { name: /spUSDC/ })).toHaveAttribute("data-address", ATOKEN);
  });

  it("leaves out a guard whose rate limits are 0", () => {
    render(<PauParams snap={snap} anchor={{ id: "spark-ethereum", aliases: [] }} />);
    expect(document.querySelectorAll("li")).toHaveLength(2);
    expect(document.querySelector(`[data-address="${POOL}"]`)).toBeNull();
  });

  it("shows nothing when every setting is inactive", () => {
    const quiet = { ...snap, contracts: snap.contracts.map((c) => ({ ...c, params: c.params?.filter((p) => p.subject === POOL) })) };
    const { container } = render(<PauParams snap={quiet} anchor={{ id: "spark-ethereum", aliases: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a padded bytes32 recipient as the address it holds", () => {
    render(<PauParams snap={snap} anchor={{ id: "spark-ethereum", aliases: [] }} />);
    const row = [...document.querySelectorAll("li")].find((li) => li.textContent?.startsWith("CCTP mint recipient")) as HTMLElement;
    expect(row).toHaveTextContent("CCTP destination domain 3 (Arbitrum) →");
    expect(row.querySelector(`[data-address="${RECIPIENT}"]`)).not.toBeNull();
    expect(row).not.toHaveAttribute("data-use");
  });
});
