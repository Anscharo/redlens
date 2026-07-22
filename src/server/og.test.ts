import { describe, it, expect } from "bun:test";
import { renderOgTags, plainSummary, escapeHtml, defaultOgTags, type OgDoc } from "./og.ts";

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

describe("renderOgTags", () => {
  it("emits exactly one <title> for the site default", () => {
    const html = tags("/");
    expect(html.match(/<title>/g)?.length).toBe(1);
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="website"');
  });

  it("uses the doc title + summary for a resolved /atlas?id= link", () => {
    const html = tags("/atlas", "id=abc", (id) => (id === "abc" ? DOC : undefined));
    expect(html).toContain("<title>Accessibility Scope · Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="og:title" content="Accessibility Scope · Sky Atlas by Redline"');
    expect(html).toContain("A.1 · Scope —");
    expect(html).toContain('property="og:url" content="https://example.com/atlas?id=abc"');
    expect(html).toContain('rel="canonical" href="https://example.com/atlas?id=abc"');
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
