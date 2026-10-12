// @vitest-environment jsdom
// The reader's line under a cast Executive Vote: how many PAU settings its
// spell changed, on which chains, linked to each prime's change history.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PauHistoryResponse } from "../../lib/pau";

const SPELL = "0x" + "5".repeat(40);
const GROVE = "grove-uuid";
const change = { deployments: [], contract: "0xrl", role: "rateLimits", event: "RateLimitDataSet", args: {}, subject: "0xk", label: null, before: null };
const entry = (chain: string, n: number) => ({
  chain, tx: `0x${chain}`, block: 1, time: "2026-10-01T00:00:00Z", primes: [GROVE], executive: null, changes: Array.from({ length: n }, () => change),
  origin: { kind: "spell", path: "starguard", spell: SPELL, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "" },
});
let history: PauHistoryResponse = { entries: [entry("ethereum", 2), entry("base", 1)] as PauHistoryResponse["entries"] };

vi.mock("../../lib/pau", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/pau")>()), loadPauHistory: () => Promise.resolve(history) }));
vi.mock("../../lib/graph", () => ({ loadGraph: () => Promise.resolve({ participants: [{ id: GROVE, slug: "grove", name: "Grove" }] }) }));

import { SpellPauEffects } from "./SpellPauEffects";

afterEach(cleanup);

describe("SpellPauEffects", () => {
  it("counts the spell's PAU changes by chain and links each prime's history", async () => {
    render(<SpellPauEffects spell={SPELL} />);
    expect(await screen.findByText(/changed 3 PAU settings on Ethereum, Base/)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Grove PAU history" })).toHaveAttribute("href", expect.stringContaining("grove"));
  });

  it("shows nothing for a spell that changed no PAU setting", async () => {
    history = { entries: [] };
    const { container } = render(<SpellPauEffects spell={SPELL} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
