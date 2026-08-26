import { describe, it, expect } from "bun:test";
import { renderOgTags, plainSummary, clampDescription, escapeHtml, defaultOgTags, isUnknownRoute, type OgDoc } from "./og.ts";

const DOC: OgDoc = {
  title: "Accessibility Scope",
  doc_no: "A.1",
  content: "The <!-- UUID: x --> **Accessibility Scope** governs how [users](u) reach the protocol.\n\n| a | b |\n|---|---|",
};

function tags(
  pathname: string,
  query = "",
  lookup: (id: string) => OgDoc | undefined = () => undefined,
  actor?: (slug: string) => string | undefined,
) {
  return renderOgTags({
    pathname,
    searchParams: new URLSearchParams(query),
    origin: "https://example.com",
    lookup,
    actor,
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

describe("isUnknownRoute", () => {
  const actor = (s: string) => (s === "spark" ? "Spark" : undefined);
  it("is true only for an unresolved radar actor slug", () => {
    expect(isUnknownRoute("/radar/redline", actor)).toBe(true); // no such actor
    expect(isUnknownRoute("/radar/spark", actor)).toBe(false); // resolves
    expect(isUnknownRoute("/radar/spark/settlements", actor)).toBe(false); // nested actor page
    expect(isUnknownRoute("/radar", actor)).toBe(false); // index, not an actor route
    expect(isUnknownRoute("/atlas", actor)).toBe(false); // unrelated route
    expect(isUnknownRoute("/preview/184/radar/redline", actor)).toBe(true); // unwrapped
    expect(isUnknownRoute("/radar/redline")).toBe(true); // no resolver → unknown
  });
});

describe("renderOgTags", () => {
  it("emits exactly one <title> for the site default", () => {
    const html = tags("/");
    expect(html.match(/<title>/g)?.length).toBe(1);
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="website"');
    // Every route now gets a generated large card + dimensions.
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:image" content="https://example.com/api/og.png?kind=default"');
    expect(html).toContain('property="og:image:width" content="1200"');
  });

  it("uses the doc title + summary for a resolved /atlas?id= link", () => {
    const html = tags("/atlas", "id=abc", (id) => (id === "abc" ? DOC : undefined));
    expect(html).toContain("<title>Accessibility Scope · Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="og:title" content="Accessibility Scope · Sky Atlas by Redline"');
    expect(html).toContain("A.1 — The Accessibility Scope governs how users reach the protocol");
    expect(html).toContain('property="og:url" content="https://example.com/atlas?id=abc"');
    expect(html).toContain('rel="canonical" href="https://example.com/atlas?id=abc"');
    // Resolved docs advertise the generated large card image + its dimensions.
    expect(html).toContain('property="og:image" content="https://example.com/api/og/abc.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
  });

  it("falls back to the default card when the id does not resolve", () => {
    const html = tags("/atlas", "id=missing");
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain("api/og.png?kind=default");
  });

  it("radar index + actor pages get their own cards", () => {
    const idx = tags("/radar");
    expect(idx).toContain("<title>Radar · Sky Atlas by Redline</title>");
    expect(idx).toContain('property="og:image" content="https://example.com/api/og.png?kind=radar"');

    // Actor name resolved via the injected lookup.
    const actor = tags("/radar/spark-protocol", "", () => undefined, (s) => (s === "spark-protocol" ? "Spark Protocol" : undefined));
    expect(actor).toContain("<title>Spark Protocol · Radar · Sky Atlas</title>");
    expect(actor).toContain('property="og:type" content="profile"');
    expect(actor).toContain("api/og.png?kind=radar-actor&amp;name=Spark%20Protocol");

    const settlements = tags("/radar/spark-protocol/settlements", "", () => undefined, (s) => (s === "spark-protocol" ? "Spark Protocol" : undefined));
    expect(settlements).toContain("<title>Spark Protocol · Radar · Sky Atlas</title>");

    // Unresolved slug → NOT an actor card; falls through to the site default.
    const fallback = tags("/radar/redline");
    expect(fallback).toContain("<title>Sky Atlas by Redline</title>");
    expect(fallback).toContain("api/og.png?kind=default");
    expect(fallback).not.toContain("kind=radar-actor");
  });

  it("reports index + named report get their own cards", () => {
    const idx = tags("/reports");
    expect(idx).toContain("<title>Reports · Sky Atlas by Redline</title>");
    expect(idx).toContain("api/og.png?kind=reports");

    const rep = tags("/reports/stale-dates");
    expect(rep).toContain("<title>Stale Dates · Sky Atlas Reports</title>");
    expect(rep).toContain("api/og.png?kind=report&amp;name=Stale%20Dates");

    // Unknown report sub-page → reports index card.
    const rubric = tags("/reports/risk-rules/rubric");
    expect(rubric).toContain("api/og.png?kind=report&amp;name=Risk%20Rules%20Assessment");
  });

  it("connect page gets its own card", () => {
    const html = tags("/connect");
    expect(html).toContain("<title>Connect · Sky Atlas by Redline</title>");
    expect(html).toContain("api/og.png?kind=connect");
  });

  it("preview landing gets a preview card labeled by PR number or ref", () => {
    const pr = tags("/preview/184");
    expect(pr).toContain("<title>Previewing PR #184 · Sky Atlas</title>");
    expect(pr).toContain("api/og.png?kind=preview&amp;label=PR%20%23184");

    const branch = tags("/preview/my-branch");
    expect(branch).toContain("Previewing my-branch · Sky Atlas");
  });

  it("a doc viewed inside a preview is marked as a preview", () => {
    const html = tags("/preview/184/atlas", "id=abc", () => DOC);
    expect(html).toContain("<title>Preview · Accessibility Scope · Sky Atlas by Redline</title>");
    // Doc card route carries the preview label so the image says PREVIEW.
    expect(html).toContain("api/og/abc.png?preview=PR%20%23184");
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
