// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EntityChip, StatusPill, AddressLink } from "./RewardsCells";
import type { AddressInfo } from "@/types";

afterEach(cleanup);

describe("EntityChip", () => {
  it("links to the actor's radar page with its display name", () => {
    render(<EntityChip e={{ id: "sky-base", slug: "sky-base", name: "Sky Base" }} />);
    const link = screen.getByRole("link", { name: "Sky Base" });
    expect(link).toHaveAttribute("href", "/radar/sky-base");
  });
});

describe("StatusPill", () => {
  it.each(["Active", "Completed", "Suspended", "InProgress", "Inactive"])(
    "renders the %s status text",
    (status) => {
      render(<StatusPill s={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    },
  );

  it("falls back to no extra style class for an unknown status", () => {
    render(<StatusPill s="Mystery" />);
    const el = screen.getByText("Mystery");
    expect(el.className).toContain("mono");
    expect(el.className).not.toContain("bg-[var(--hover)]");
  });
});

describe("AddressLink", () => {
  const addr = "0x1234567890abcdef1234567890abcdef12345678";

  it("shows the shortened address with no label when the address isn't in the map", () => {
    render(<AddressLink addr={addr} addrMap={{}} />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("0x1234…5678");
    expect(link).toHaveAttribute("title", addr);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("prefixes the resolved name from the address map when known (case-insensitive key)", () => {
    const addrMap: Record<string, AddressInfo> = {
      [addr.toLowerCase()]: { chain: "ethereum", chainlogId: "MCD_MULTISIG" } as AddressInfo,
    };
    render(<AddressLink addr={addr} addrMap={addrMap} />);
    expect(screen.getByRole("link")).toHaveTextContent("MCD_MULTISIG · 0x1234…5678");
  });

  it("resolves the explorer URL from the chain hint", () => {
    render(<AddressLink addr={addr} chain="base" addrMap={{}} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", `https://basescan.org/address/${addr}`);
  });

  it("uses the precomputed explorerUrl from the address map when present", () => {
    const addrMap: Record<string, AddressInfo> = {
      [addr.toLowerCase()]: { chain: "ethereum", explorerUrl: "https://custom.example/x" } as AddressInfo,
    };
    render(<AddressLink addr={addr} addrMap={addrMap} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://custom.example/x");
  });
});
