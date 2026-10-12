// @vitest-environment jsdom
// The wiring pill: shown only for a controller missing a CONTROLLER grant, naming which.
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import type { ContractState, PauSnapshot } from "../../lib/pau";
import { PauWiring } from "./PauWiring";

const CTRL = "0x" + "c".repeat(40);
const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const c = (role: ContractState["role"], address: string, controller: string | null): ContractState => ({
  role, address, events: 1, historyComplete: true, roles: controller ? [{ role: "0xr", name: "CONTROLLER", account: controller, since: at, holds: true }] : [],
});
const snap = (proxy: string | null, limits: string | null): PauSnapshot => ({
  deployment: "d", prime: "p", primeName: "P", chain: "plasma", kind: "monolithic",
  contracts: [c("controller", CTRL, null), c("almProxy", "0x" + "1".repeat(40), proxy), c("rateLimits", "0x" + "2".repeat(40), limits)],
});

describe("PauWiring", () => {
  it("flags a controller granted neither role, and says which one a partly wired controller lacks", () => {
    const { rerender } = render(<PauWiring snap={snap(null, null)} />);
    expect(screen.getByText("not wired")).toHaveAttribute("data-wiring", "unwired");
    expect(screen.getByText(/neither its ALM proxy nor its rate limits/)).toBeInTheDocument();
    rerender(<PauWiring snap={snap(null, CTRL)} />);
    expect(screen.getByText("partly wired")).toHaveAttribute("title", expect.stringMatching(/not on its ALM proxy/));
  });
  it("shows nothing for a wired controller", () => {
    const { container } = render(<PauWiring snap={snap(CTRL, CTRL)} />);
    expect(container).toBeEmptyDOMElement();
  });
});
