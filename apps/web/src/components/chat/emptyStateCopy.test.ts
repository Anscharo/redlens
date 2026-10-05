import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/conversationsApi", () => ({ listConversations: vi.fn(async () => []) }));

import { STARTERS, emptyStateCopy } from "./ChatEmptyState";

const base = { short: "s", placeholder: "p", chip: "c" };

describe("emptyStateCopy", () => {
  it("offers the default starters off a report", () => {
    expect(emptyStateCopy(base)).toMatchObject({ title: "Ask the Atlas", starters: STARTERS });
  });
  it("names the report, and offers report-tool starters only when a tool backs it", () => {
    expect(emptyStateCopy({ ...base, reportName: "Multisigs", reportTool: "atlas_report_multisigs" }).starters[0]).toBe("Summarize the Multisigs report.");
    const nameOnly = emptyStateCopy({ ...base, reportName: "Multisigs" });
    expect(nameOnly.title).toBe("Viewing the Multisigs report");
    expect(nameOnly.starters[0]).toBe("What is the Multisigs report about?");
  });
});
