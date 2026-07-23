import { describe, it, expect } from "bun:test";
import { renderOgTags, plainSummary, clampDescription, escapeHtml, defaultOgTags, type OgDoc } from "./og.ts";

const DOC: OgDoc = {
  title: "Accessibility Scope",
  doc_no: "A.1",
  type: "Scope",
  content: "The <!-- UUID: x --> **Accessibility Scope** governs how [users](u) reach the protocol.\n\n| a | b |\n|---|---|",
};

function tags(pathname: string, query = "", lookup: (id: string) => OgDoc | undefined = () => undefined) {
  return renderOgTags({
    pathname,
    searchParams: new URLSearchParams(query),
    origin: "https://example.com",
    lookup,
  });
}

describe("escapeHtml", () => {
  it("escapes the five significant chars", () => {
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &#39; f");
  });
});

describe("plainSummary", () => {
  it("strips comments, links, emphasis, and table pipes", () => {
    const s = plainSummary(DOC.content);
    expect(s).not.toContain("UUID");
    expect(s).not.toContain("**");
    expect(s).not.toContain("[");
    expect(s).not.toContain("|");
    expect(s).toContain("Accessibility Scope governs how users reach the protocol");
  });

  it("truncates on a word boundary with an ellipsis", () => {
    const s = plainSummary("one two three four five", 10);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(11);
    expect(s).not.toContain("fiv"); // no mid-word cut
  });
});

describe("clampDescription", () => {
  it("ends at the first sentence when it fits in 140", () => {
    const out = clampDescription("A.1", "First sentence here. Second sentence follows.");
    expect(out).toBe("A.1 — First sentence here.");
  });

  it("returns the whole body when short and terminator-free", () => {
    expect(clampDescription("A.1", "no terminator")).toBe("A.1 — no terminator");
  });

  it("hard-caps at 140 chars (prefix included) with an ellipsis when 140 comes first", () => {
    const body = "word ".repeat(60).trim(); // ~299 chars, no sentence end
    const out = clampDescription("A.2.2.8.1", body);
    expect(out.length).toBeLessThanOrEqual(141); // 140 + the ellipsis char
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("A.2.2.8.1 — ")).toBe(true);
  });

  it("caps at 140 when the first sentence runs past it", () => {
    const body = `${"alpha ".repeat(40)}end.`; // sentence ends well past 140
    const out = clampDescription("A.1", body);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("end.");
  });

  it("does not treat periods in the doc number as sentence ends", () => {
    const out = clampDescription("A.2.2.8.1", "One clause then more text here.");
    expect(out).toBe("A.2.2.8.1 — One clause then more text here.");
  });

  it("falls back to the doc number for empty body", () => {
    expect(clampDescription("A.1", "   ")).toBe("A.1");
  });
});

describe("renderOgTags", () => {
  it("emits exactly one <title> for the site default", () => {
    const html = tags("/");
    expect(html.match(/<title>/g)?.length).toBe(1);
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="website"');
    // Non-doc routes keep the small square card + site icon.
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).toContain('property="og:image" content="https://example.com/icon-mid.png"');
  });

  it("uses the doc title + summary for a resolved /atlas?id= link", () => {
    const html = tags("/atlas", "id=abc", (id) => (id === "abc" ? DOC : undefined));
    expect(html).toContain("<title>Accessibility Scope · Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="og:title" content="Accessibility Scope · Sky Atlas by Redline"');
    expect(html).toContain("A.1 — The Accessibility Scope governs how users reach the protocol");
    expect(html).toContain('property="og:url" content="https://example.com/atlas?id=abc"');
    expect(html).toContain('rel="canonical" href="https://example.com/atlas?id=abc"');
    // Resolved docs advertise the generated large card image.
    expect(html).toContain('property="og:image" content="https://example.com/api/og/abc.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("falls back to the site default when the id does not resolve", () => {
    const html = tags("/atlas", "id=missing");
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="website"');
  });

  it("ignores view/split query params in the canonical URL", () => {
    const html = tags("/atlas", "id=abc&view=history&split=zzz", () => DOC);
    expect(html).toContain('property="og:url" content="https://example.com/atlas?id=abc"');
    expect(html).not.toContain("view=history");
  });

  it("escapes special chars in titles to keep the HTML well-formed", () => {
    const evil: OgDoc = { ...DOC, title: `A & B <script>"x"` };
    const html = tags("/atlas", "id=abc", () => evil);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;script&gt;");
  });

  it("defaultOgTags is a bare site-level block", () => {
    const html = defaultOgTags("https://example.com");
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
    expect(html).toContain('content="website"');
  });
});
