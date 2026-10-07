import { describe, expect, it } from "vitest";
import { byDocNo, cmpDocNo } from "./docNo";

describe("docNo", () => {
  it("orders segments numerically", () => {
    expect(["A.2.10", "A.2.9", "A.1"].sort(cmpDocNo)).toEqual(["A.1", "A.2.9", "A.2.10"]);
  });

  it("byDocNo compares the doc_no field", () => {
    expect([{ doc_no: "A.10" }, { doc_no: "A.9" }].sort(byDocNo).map((d) => d.doc_no)).toEqual(["A.9", "A.10"]);
  });
});
