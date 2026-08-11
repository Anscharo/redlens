// PALETTE_TOKENS is the registry every part of the admin editor (and
// ALLOWED_TOKEN_NAMES in palette-storage.ts) trusts to enumerate "every
// editable token" and to resolve a --name back to its group/label. A
// duplicate or unlabeled entry here silently drops or misfiles a token
// everywhere downstream, so these are integrity checks on the data, not
// just line coverage.
import { describe, it, expect } from "vitest";
import { GROUP_LABEL, GROUP_ORDER, PALETTE_TOKENS, TOKEN_BY_NAME } from "./palette-tokens";

describe("PALETTE_TOKENS registry", () => {
  it("has no duplicate token names", () => {
    const names = PALETTE_TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every token has a non-empty name and label", () => {
    for (const t of PALETTE_TOKENS) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("every token's group is one of the declared groups", () => {
    for (const t of PALETTE_TOKENS) {
      expect(GROUP_ORDER).toContain(t.group);
    }
  });

  it("every declared group has a display label", () => {
    for (const g of GROUP_ORDER) {
      expect(GROUP_LABEL[g]).toBeTruthy();
    }
  });

  it("TOKEN_BY_NAME indexes every token by name, one-to-one", () => {
    expect(TOKEN_BY_NAME.size).toBe(PALETTE_TOKENS.length);
    for (const t of PALETTE_TOKENS) {
      expect(TOKEN_BY_NAME.get(t.name)).toBe(t);
    }
  });

  it("the depth group is a contiguous depth-1..depth-17 sequence", () => {
    const depthNames = PALETTE_TOKENS.filter((t) => t.group === "depth").map((t) => t.name);
    expect(depthNames).toEqual(Array.from({ length: 17 }, (_, i) => `depth-${i + 1}`));
  });
});
