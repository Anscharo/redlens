// system-prompt.ts: pure prompt builder. Exercises buildSystemPrompt against the
// real in-memory indexes (loadIndexes() reads pre-built disk artifacts, no
// network/DB), plus the pure helpers pageContextLine / validReportTool.
import { describe, it, expect } from "bun:test";
import { loadIndexes } from "../retrieval/indexes.ts";
import { agentArtifactRoster, buildSystemPrompt, pageContextLine, validReportTool } from "./system-prompt.ts";

const ix = loadIndexes();

describe("pageContextLine", () => {
  it("returns null when there's no context", () => {
    expect(pageContextLine(undefined)).toBeNull();
  });

  it("prefers nodeId, formatting title + doc_no + uuid", () => {
    const line = pageContextLine({ nodeId: "abc-123", nodeTitle: "Stability Scope", nodeDocNo: "A.1.2" });
    expect(line).toBe('Atlas node "Stability Scope" (A.1.2), UUID abc-123');
  });

  it("falls back to nodeId alone when title is missing", () => {
    expect(pageContextLine({ nodeId: "abc-123" })).toBe("Atlas node \"abc-123\", UUID abc-123");
  });

  it("falls back through actorSlug, reportName, path in priority order", () => {
    expect(pageContextLine({ actorSlug: "op-facilitator" })).toBe('Radar actor page for "op-facilitator"');
    expect(
      pageContextLine({ actorSlug: "spark", path: "/radar/spark/settlements", mscMonth: "2026-07" }),
    ).toContain("ask_external_msc");
    expect(pageContextLine({ reportName: "Stale Dates" })).toBe("Report: Stale Dates");
    expect(pageContextLine({ path: "/atlas" })).toBe("Route /atlas");
  });

  it("returns null when ctx has none of the recognized fields", () => {
    expect(pageContextLine({})).toBeNull();
  });

  it("prioritizes nodeId over actorSlug/reportName/path when several are set", () => {
    expect(pageContextLine({ nodeId: "n1", actorSlug: "a1", reportName: "r1", path: "/p1" })).toContain("UUID n1");
  });
});

describe("validReportTool", () => {
  it("returns null when ctx is undefined or reportTool is missing", () => {
    expect(validReportTool(undefined)).toBeNull();
    expect(validReportTool({})).toBeNull();
  });

  it("returns null for a value that doesn't start with atlas_report_", () => {
    expect(validReportTool({ reportTool: "atlas_query" })).toBeNull();
  });

  it("returns null for a fake/unregistered atlas_report_ tool name", () => {
    expect(validReportTool({ reportTool: "atlas_report_does_not_exist" })).toBeNull();
  });

  it("returns the tool name when it's a real registered atlas_report_ tool", () => {
    expect(validReportTool({ reportTool: "atlas_report_multisigs" })).toBe("atlas_report_multisigs");
  });
});

describe("agentArtifactRoster", () => {
  it("lists each live agent with its A.6 root and the ownership rule", () => {
    const roster = agentArtifactRoster(ix);
    expect(roster).not.toBeNull();
    expect(roster).toContain("Every document under an agent's root belongs to that agent");
    expect(roster).toMatch(/Prime Agents: .*Spark @ A\.6\.1\.1\.1/);
    expect(roster).toMatch(/Executor Agents: .*Amatsu @ A\.6\.1\.2\.1/);
  });
});

describe("buildSystemPrompt", () => {
  it("builds a prompt with atlas structure, entity chains, tools, and citation rules — no page context", () => {
    const prompt = buildSystemPrompt(ix);
    expect(prompt).toContain("Sky Atlas by Redline assistant");
    expect(prompt).toContain("## Atlas structure");
    expect(prompt).toContain("The atlas is a tree of");
    expect(prompt).toContain("Every document under an agent's root belongs to that agent");
    expect(prompt).toContain("## Entity traversal (live graph)");
    expect(prompt).toContain("## Tools");
    expect(prompt).toContain("atlas_query");
    expect(prompt).toContain("complete class listing");
    expect(prompt).not.toContain("answer immediately once you have the evidence");
    expect(prompt).toContain("## Citations & rendering");
    expect(prompt).not.toContain("## Current page");
  });

  it("names the tool-round budget passed in, independent of the atlas load", () => {
    expect(buildSystemPrompt(ix, undefined, "inline", undefined, 6)).toContain("You may call tools up to 6 rounds");
    expect(buildSystemPrompt(ix)).toContain("You may call tools up to 4 rounds");
  });

  // The atlas is the documents; entities/relations/addresses/params/censuses
  // are OUR parse of them. Presenting one as the other is the failure this
  // line exists to prevent — it is also what the features fact's vocabulary
  // block reinforces when the question is about the app (facts/features.ts).
  it("says the graph is our extraction, not atlas text", () => {
    const prompt = buildSystemPrompt(ix);
    expect(prompt).toContain("SAbR's own EXTRACTION from the atlas documents");
    expect(prompt).toContain("our extraction shows");
  });

  it("has a third bucket for external MSC figures", () => {
    const prompt = buildSystemPrompt(ix);
    const ext = prompt.indexOf("## External sources (not Atlas)");
    const tools = prompt.indexOf("## Tools");
    const entity = prompt.indexOf("## Entity traversal");
    expect(ext).toBeGreaterThan(entity);
    expect(tools).toBeGreaterThan(ext);
    expect(prompt).toContain("ask_external_msc");
    expect(prompt).toContain("never `[amount](/atlas/<uuid>)`");
  });

  // Which format the prompt ASKS for is per-model (docs/plans/reference-citations.md):
  // the bakeoff measured the definition block working on the strong tier and
  // misfiring on the default one. Inline is the default because it is the form
  // every measured model follows.
  it("asks for inline citations by default and reference style only when selected", () => {
    const inline = buildSystemPrompt(ix);
    expect(inline).toContain("[link text](/atlas/<uuid>)");
    expect(inline).not.toContain("definition block");
    expect(inline).not.toContain("[link text][label]");

    const reference = buildSystemPrompt(ix, undefined, "reference");
    expect(reference).toContain("definition block");
    expect(reference).toContain("[link text][label]");
    // The placement rule is the one the default tier failed 14/14 times.
    expect(reference).toContain("FIRST thing in the answer");
    // Format-agnostic rules survive in both.
    for (const p of [inline, reference]) {
      expect(p).toContain("## Citations & rendering");
      expect(p).toContain("Never emit placeholder citations");
      expect(p).toContain("make that value the link text");
    }
  });

  // The date is injected rather than recomputed after the call: a run that
  // straddles UTC midnight would otherwise compare two different days.
  it("includes today's date and the atlas commit when present", () => {
    const today = "2026-02-14";
    const prompt = buildSystemPrompt(ix, undefined, "inline", today);
    expect(prompt).toContain(`Today's date is ${today}`);
    if (ix.meta?.atlasCommit) {
      expect(prompt).toContain(`commit ${ix.meta.atlasCommit.slice(0, 7)}`);
    } else {
      expect(prompt).toContain("(unknown commit)");
    }
    // …and the default (no injection) still stamps a real ISO date.
    expect(buildSystemPrompt(ix)).toMatch(/Today's date is \d{4}-\d{2}-\d{2}\./);
  });

  it("appends a Current page section when ctx has a page context", () => {
    const prompt = buildSystemPrompt(ix, { path: "/atlas" });
    expect(prompt).toContain("## Current page");
    expect(prompt).toContain("The user is viewing: Route /atlas.");
    expect(prompt).toContain('Treat references like "this", "here", or "this primitive" as that node unless they say otherwise.');
  });

  it("wires in report-tool guidance + sanitized filter when reportTool is valid", () => {
    const prompt = buildSystemPrompt(ix, {
      reportName: "Multisigs",
      reportTool: "atlas_report_multisigs",
      reportFilter: "PSM\n`danger`  extra",
    });
    expect(prompt).toContain("`atlas_report_multisigs` tool");
    // backticks and newlines stripped, collapsed to single line, trimmed
    expect(prompt).toContain('pass `filter: "PSM danger   extra"`');
    expect(prompt).not.toContain("PSM\n");
    expect(prompt).toContain('Treat references like "this", "here", or "this primitive" as that report unless they say otherwise.');
  });

  it("omits filter guidance when reportFilter is empty, but still mentions the report tool", () => {
    const prompt = buildSystemPrompt(ix, { reportName: "Multisigs", reportTool: "atlas_report_multisigs" });
    expect(prompt).toContain("`atlas_report_multisigs` tool");
    expect(prompt).not.toContain("pass `filter:");
  });

  it("ignores an invalid/unregistered reportTool hint — no report guidance emitted", () => {
    const prompt = buildSystemPrompt(ix, { reportName: "Fake", reportTool: "atlas_report_nonexistent" });
    expect(prompt).toContain("## Current page");
    expect(prompt).not.toContain("This report is backed by");
  });

  it("names a report page without a tool and still treats 'this' as the report", () => {
    const prompt = buildSystemPrompt(ix, { path: "/reports/stale-dates", reportName: "Stale Dates" });
    expect(prompt).toContain('Report: Stale Dates');
    expect(prompt).not.toContain("This report is backed by");
    expect(prompt).toContain('as that report unless they say otherwise');
  });

  it("truncates a long reportFilter to 100 chars", () => {
    const long = "x".repeat(200);
    const prompt = buildSystemPrompt(ix, { reportTool: "atlas_report_multisigs", reportName: "R", reportFilter: long });
    const match = prompt.match(/pass `filter: "([^"]*)"`/);
    expect(match).not.toBeNull();
    expect((match?.[1] ?? "").length).toBeLessThanOrEqual(100 + " (adjusted to their question)".length);
  });
});
