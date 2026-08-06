// Tests for the rehypeEthAddresses hast transformer.
// Builds plain hast trees (no unified pipeline needed) and calls the
// transformer directly so tests stay synchronous and dep-free.

import { describe, it, expect, beforeEach } from "vitest";
import type { Root, Element, Text } from "hast";
import type { AddressInfo } from "../types";
import { rehypeEthAddresses } from "./rehypeEthAddresses";
import { setAddressMap } from "./addressMap";

function addrInfo(explorerUrl: string): AddressInfo {
  return {
    chain: "ethereum",
    explorerUrl,
    label: null,
    isContract: false,
    isProxy: false,
    roles: [],
    aliases: [],
    expectedTokens: [],
  };
}

function makeTree(...texts: string[]): Root {
  return {
    type: "root",
    children: texts.map((value) => ({
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value }],
    })),
  };
}

function links(tree: Root): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  function walk(nodes: Root["children"]) {
    for (const node of nodes) {
      if (node.type === "element") {
        if (node.tagName === "a") {
          const text = node.children
            .filter((c): c is Text => c.type === "text")
            .map((c) => c.value)
            .join("");
          out.push({ text, href: String(node.properties?.href ?? "") });
        }
        walk((node as Element).children);
      }
    }
  }
  walk(tree.children);
  return out;
}

const transform = rehypeEthAddresses()();
const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const SOL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

beforeEach(() => setAddressMap({}));

describe("EVM address linkification", () => {
  it("links a bare EVM address to etherscan", () => {
    const tree = makeTree(`Check ${EVM} now`);
    transform(tree);
    const found = links(tree).find((l) => l.text === EVM);
    expect(found?.href).toBe(`https://etherscan.io/address/${EVM}`);
  });

  it("uses explorerUrl from address map when present", () => {
    setAddressMap({ [EVM.toLowerCase()]: addrInfo("https://custom.io/addr") });
    const tree = makeTree(EVM);
    transform(tree);
    expect(links(tree)[0]?.href).toBe("https://custom.io/addr");
  });

  it("does not link a 65-hex phantom (tx hash prefix)", () => {
    const phantom = EVM + "f"; // 42 hex chars after 0x — 41 hex = phantom
    const tree = makeTree(phantom);
    transform(tree);
    expect(links(tree)).toHaveLength(0);
  });

  it("does not re-link an address already inside an <a>", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "a",
          properties: { href: "https://etherscan.io" },
          children: [{ type: "text", value: EVM }],
        },
      ],
    };
    transform(tree);
    const hrefs = links(tree).map((l) => l.href);
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toBe("https://etherscan.io");
  });
});

describe("Solana address linkification", () => {
  it("links a Solana address to solscan", () => {
    const tree = makeTree(`Token program: ${SOL}`);
    transform(tree);
    const found = links(tree).find((l) => l.text === SOL);
    expect(found).toBeDefined();
    expect(found?.href).toContain(SOL);
  });
});

describe("transaction hash linkification", () => {
  it("links a tx hash inside <code> preceded by 'Transaction Hash:' text sibling", () => {
    const hash = "0x" + "a".repeat(64);
    // The plugin looks for a <code> element whose text is a 64-hex hash,
    // preceded by a text sibling ending with "Transaction Hash:".
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            { type: "text", value: "Transaction Hash: " },
            {
              type: "element",
              tagName: "code",
              properties: {},
              children: [{ type: "text", value: hash }],
            },
          ],
        },
      ],
    };
    transform(tree);
    const found = links(tree);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.href).toBe(`https://etherscan.io/tx/${hash}`);
  });

  it("does not link a bare 64-hex tx hash without the label", () => {
    const hash = "0x" + "b".repeat(64);
    const tree = makeTree(hash);
    transform(tree);
    expect(links(tree)).toHaveLength(0);
  });
});
