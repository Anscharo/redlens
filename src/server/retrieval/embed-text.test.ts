// Pure text/hash builder tests. Run under `bun test`.
import { describe, it, expect } from "bun:test";
import { buildEmbedText, contentHash } from "./embed-text.ts";

describe("buildEmbedText", () => {
  it("joins title + content with a blank line when content is present", () => {
    expect(buildEmbedText({ title: "Title", content: "Body text" })).toBe("Title\n\nBody text");
  });

  it("falls back to just the title when content is empty or missing", () => {
    expect(buildEmbedText({ title: "Title", content: "" })).toBe("Title");
    expect(buildEmbedText({ title: "Title", content: "   " })).toBe("Title");
    expect(buildEmbedText({ title: "Title", content: undefined as unknown as string })).toBe("Title");
  });

  it("trims content before joining", () => {
    expect(buildEmbedText({ title: "Title", content: "  padded  " })).toBe("Title\n\npadded");
  });

  // Link stripping: 93% of atlas links target a bare doc UUID, which is pure
  // token cost in a vector. Anchor text is kept; only the target is dropped.
  it("collapses an internal cross-reference to its anchor text, dropping the UUID", () => {
    const content = "See [A.1.2 - Objective of Prime TRC Management](9a8120c4-0a5b-426f-97a5-283c708413f5).";
    expect(buildEmbedText({ title: "T", content })).toBe("T\n\nSee A.1.2 - Objective of Prime TRC Management.");
  });

  it("strips images too, keeping alt text", () => {
    expect(buildEmbedText({ title: "T", content: "![alt text](img.png)" })).toBe("T\n\nalt text");
  });

  it("falls back to the title when content is nothing but a link with no anchor text", () => {
    expect(buildEmbedText({ title: "T", content: "[](9a8120c4-0a5b-426f-97a5-283c708413f5)" })).toBe("T");
  });

  it("leaves a self-link's URL in place — anchor text IS the URL (known limit)", () => {
    // The 144 self-links in the atlas are only halved by this rule, not removed.
    // Documented in the embed-text.ts header; fixing them needs a separate
    // URL-anchor rule that would also drop on-chain addresses from embed text.
    const content = "[https://etherscan.io/address/0xabc](https://etherscan.io/address/0xabc)";
    expect(buildEmbedText({ title: "T", content })).toBe("T\n\nhttps://etherscan.io/address/0xabc");
  });
});

describe("contentHash", () => {
  it("is a stable sha256 hex digest of the embed text", () => {
    const h = contentHash({ title: "Title", content: "Body" });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(contentHash({ title: "Title", content: "Body" }));
  });

  it("changes when the embed text changes (title or content)", () => {
    const base = contentHash({ title: "Title", content: "Body" });
    expect(contentHash({ title: "Other", content: "Body" })).not.toBe(base);
    expect(contentHash({ title: "Title", content: "Different" })).not.toBe(base);
  });

  it("is INSENSITIVE to a link-target-only edit (deliberate — vectors shouldn't churn)", () => {
    // The vector genuinely doesn't move when only a link target changes, so the
    // embed hash must not churn. The cost is that this hash cannot serve as a
    // general "did this doc change" key — that is why atlas-refresh.ts's
    // changeKey exists. Keep these two facts locked together.
    const a = contentHash({ title: "T", content: "See [Label](uuid-one)." });
    const b = contentHash({ title: "T", content: "See [Label](uuid-two)." });
    expect(a).toBe(b);
  });

  it("is unaffected by fields outside the embed text (doc_no/parent/depth aren't hashed)", () => {
    // buildEmbedText only reads title/content, so any extra fields on the
    // input object can't perturb the hash — this is the documented contract
    // ("a pure renumber doesn't churn embeddings").
    const a = contentHash({ title: "T", content: "C" });
    const b = contentHash({ title: "T", content: "C", extra: "ignored" } as never);
    expect(a).toBe(b);
  });
});
