// system-prompt.ts: pure prompt builder. Exercises buildSystemPrompt against the
// real in-memory indexes (loadIndexes() reads pre-built disk artifacts, no
// network/DB), plus the pure helpers pageContextLine / validReportTool.
import { describe, it, expect } from "bun:test";
import { loadIndexes } from "../retrieval/indexes.ts";
import { buildSystemPrompt, pageContextLine, validReportTool } from "./system-prompt.ts";

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

describe("buildSystemPrompt", () => {
  it("builds a prompt with atlas structure, entity chains, tools, and citation rules — no page context", () => {
    const prompt = buildSystemPrompt(ix);
    expect(prompt).toContain("Sky Atlas by Redline assistant");
    expect(prompt).toContain("## Atlas structure");
    expect(prompt).toContain("## Entity traversal (live graph)");
    expect(prompt).toContain("## Tools");
    expect(prompt).toContain("atlas_query");
    expect(prompt).toContain("## Citations & rendering");
    expect(prompt).not.toContain("## Current page");
  });

  it("includes today's date and the atlas commit when present", () => {
    const prompt = buildSystemPrompt(ix);
    const today = new Date().toISOString().slice(0, 10);
    expect(prompt).toContain(`Today's date is ${today}`);
    if (ix.meta?.atlasCommit) {
      expect(prompt).toContain(`commit ${ix.meta.atlasCommit.slice(0, 7)}`);
    } else {
      expect(prompt).toContain("(unknown commit)");
    }
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

  it("truncates a long reportFilter to 100 chars", () => {
    const long = "x".repeat(200);
    const prompt = buildSystemPrompt(ix, { reportTool: "atlas_report_multisigs", reportName: "R", reportFilter: long });
    const match = prompt.match(/pass `filter: "([^"]*)"`/);
    expect(match).not.toBeNull();
    expect((match?.[1] ?? "").length).toBeLessThanOrEqual(100 + " (adjusted to their question)".length);
  });
});
