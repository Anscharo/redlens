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

  it("is unaffected by fields outside the embed text (doc_no/parent/depth aren't hashed)", () => {
    // buildEmbedText only reads title/content, so any extra fields on the
    // input object can't perturb the hash — this is the documented contract
    // ("a pure renumber doesn't churn embeddings").
    const a = contentHash({ title: "T", content: "C" });
    const b = contentHash({ title: "T", content: "C", extra: "ignored" } as never);
    expect(a).toBe(b);
  });
});
