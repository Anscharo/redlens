// Intra-era split/merge lineage (plan §4.1, prototype B). matchNodes finds the
// birth/death, findContainer confirms the carve-out/absorption; detectLineage emits
// uuid→uuid extracted_from / merged_into for the freeze's docMeta.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
// @ts-expect-error — .mjs without types
import { detectLineage } from "../scripts/lib/history-lineage.mjs";

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const node = (uuid: string, title: string, content: string, key: string, order: number) => ({
  uuid, title, content, contentHash: md5(content), structuralKey: key, section: "S", order, doc_no: null, type: "Core",
});
const child = "junior risk capital is tranched into senior and mezzanine layers each quarter reliably";
const gone = "the allocation conduit forwards idle balances to the chosen yield venue every block";

describe("detectLineage", () => {
  it("records extracted_from when a born doc's prose was carved from a larger parent", () => {
    const parentBody = `risk capital sourcing preamble text and ${child} plus a trailing governance clause here`;
    const older = [node("P", "Risk Capital Sourcing", parentBody, "kP", 0)];
    const newer = [node("P", "Risk Capital Sourcing", parentBody + " updated", "kP", 0), node("C", "Junior Risk Capital Types", child, "kC", 1)];
    const { extractedFrom, splits } = detectLineage([{ sha: "o", nodes: older }, { sha: "n", nodes: newer }]);
    expect(extractedFrom.get("C")).toBe("P");
    expect(splits[0]).toMatchObject({ childUuid: "C", parentUuid: "P" });
  });

  it("records merged_into when a died doc's prose was absorbed into a successor", () => {
    const host = "allocation system process base text";
    const older = [node("G", "Allocation Conduit Ongoing Management", gone, "kG", 0), node("H", "Allocation System Process Definition", host, "kH", 1)];
    const newer = [node("H", "Allocation System Process Definition", `${host} and ${gone} appended`, "kH", 0)];
    const { mergedInto } = detectLineage([{ sha: "o", nodes: older }, { sha: "n", nodes: newer }]);
    expect(mergedInto.get("G")).toBe("H");
  });

  it("ignores a same-title container (a continuation the matcher missed, not a split)", () => {
    const parentBody = `intro text then ${child} and an extra trailing clause to pad the parent body`;
    const older = [node("P", "Same Title", parentBody, "kP", 0)];
    const newer = [node("P", "Same Title", parentBody + " edited", "kP", 0), node("C", "Same Title", child, "kC", 1)];
    const { extractedFrom } = detectLineage([{ sha: "o", nodes: older }, { sha: "n", nodes: newer }]);
    expect(extractedFrom.has("C")).toBe(false); // same title → not a lineage event
  });
});
