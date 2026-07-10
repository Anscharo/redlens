import { describe, it, expect } from "vitest";
import { toCSV } from "./csv";

describe("toCSV", () => {
  it("quotes every field and joins with CRLF", () => {
    const csv = toCSV(["A", "B"], [["1", "2"], ["3", "4"]]);
    expect(csv).toBe('"A","B"\r\n"1","2"\r\n"3","4"');
  });

  it("doubles embedded quotes", () => {
    const csv = toCSV(["Q"], [['he said "hi"']]);
    expect(csv).toBe('"Q"\r\n"he said ""hi"""');
  });

  it("keeps commas and newlines inside a quoted field", () => {
    const csv = toCSV(["Text"], [["a, b\nc"]]);
    expect(csv).toBe('"Text"\r\n"a, b\nc"');
  });

  it("renders null/undefined/number cells", () => {
    const csv = toCSV(["a", "b", "c"], [[null, undefined, 5]]);
    expect(csv).toBe('"a","b","c"\r\n"","","5"');
  });

  it("returns just the header line when there are no rows", () => {
    expect(toCSV(["a", "b"], [])).toBe('"a","b"');
  });
});
