// @vitest-environment jsdom
// Where no Atlas document is connected to a limit, the Atlas column flags it by
// how it was set: a spell always, a cBEAM only after two months, a switched-off
// limit or another origin never.
import { render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { LiveRateLimit } from "../../lib/pau";
import { PauAtlasMark } from "./PauAtlasMark";

const entry = (tx: string, kind: string) => ({ chain: "ethereum", tx, block: 1, time: "t", primes: [], origin: { kind }, executive: null, changes: [] });
vi.mock("../../lib/pau", async (orig) => ({
  ...(await orig<typeof import("../../lib/pau")>()),
  loadPauHistory: () => Promise.resolve({ entries: [entry("0xspell", "spell"), entry("0xold", "operator"), entry("0xnew", "operator"), entry("0xdirect", "direct")] }),
}));

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString();
const limit = (tx: string, time: string, maxAmount = "1000000"): LiveRateLimit => ({
  key: "0x" + "a".repeat(64), configured: { maxAmount, slope: "0" }, setAt: { block: 1, time, tx }, changes: 1, data: null, available: null,
});

describe("PauAtlasMark", () => {
  it("flags a spell-set limit with both explanations", async () => {
    render(<PauAtlasMark chain="ethereum" limit={limit("0xspell", day(1))} />);
    expect(await screen.findByRole("img", { name: /failed to connect.*executed before the Atlas was updated/ })).toHaveAttribute("data-atlas-flag", "spell");
  });
  it("flags a cBEAM-set limit only past two months", async () => {
    const { container } = render(<><PauAtlasMark chain="ethereum" limit={limit("0xold", day(90))} /><PauAtlasMark chain="ethereum" limit={limit("0xnew", day(10))} /></>);
    await waitFor(() => expect(container.querySelectorAll("[data-atlas-flag]")).toHaveLength(1));
    expect(container.querySelector("[data-atlas-flag]")).toHaveAttribute("data-atlas-flag", "cbeam");
  });
  it("leaves a switched-off limit and a direct call unflagged", async () => {
    const { container } = render(<><PauAtlasMark chain="ethereum" limit={limit("0xspell", day(1), "0")} /><PauAtlasMark chain="ethereum" limit={limit("0xdirect", day(1))} /></>);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelectorAll("[data-atlas-flag]")).toHaveLength(0);
  });
  it("shows the verdict mark, not a flag, where a document is connected", async () => {
    const { container } = render(<PauAtlasMark chain="ethereum" limit={limit("0xspell", day(1))} verdict={{ mark: "mismatch", docId: "doc-1" }} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(within(container).getByRole("link", { name: /^differs from the atlas/ })).toHaveAttribute("href", "/atlas?id=doc-1&view=onchain");
    expect(container.querySelector("[data-atlas-flag]")).toBeNull();
  });
});
