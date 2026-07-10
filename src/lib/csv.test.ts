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

  it("neutralizes formula-triggering string cells (=, +, -, @) with a leading quote", () => {
    const csv = toCSV(["x"], [["=1+1"], ["+cmd"], ["-2+3"], ["@SUM(A1)"]]);
    expect(csv).toBe('"x"\r\n"\'=1+1"\r\n"\'+cmd"\r\n"\'-2+3"\r\n"\'@SUM(A1)"');
  });

  it("leaves ordinary strings and numeric cells (incl. negatives) untouched", () => {
    // A negative NUMBER is not a formula payload — must stay numeric, not quoted.
    expect(toCSV(["n", "s"], [[-30, "hello"]])).toBe('"n","s"\r\n"-30","hello"');
  });
});
