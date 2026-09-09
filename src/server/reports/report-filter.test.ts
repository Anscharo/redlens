// Direct unit test for the server-side report filter wrapper. The underlying
// parseReportQuery/filterRows matching logic already has its own thorough
// suite (src/lib/reportFilter.test.ts) — this only pins that the wrapper
// wires an atlas_report_* tool's `filter` argument through it correctly:
// undefined/empty means "no filter", and the same broad/phrase semantics the
// report page's header box uses apply here too.
import { test, expect } from "bun:test";
import { applyReportFilter } from "./report-filter.ts";
import type { SearchField } from "../../lib/reportFilter.ts";

interface Row {
  title: string;
  docNo: string;
}

const rows: Row[] = [
  { title: "Onboard a Facilitator", docNo: "A.1.1" },
  { title: "Retire a Multisig Signer", docNo: "A.2.1" },
];
const fields = (r: Row): SearchField[] => [
  { label: "title", value: r.title },
  { label: "doc no", value: r.docNo },
];

test("no filter (undefined or empty string) returns every row untouched", () => {
  expect(applyReportFilter(rows, undefined, fields)).toEqual(rows);
  expect(applyReportFilter(rows, "", fields)).toEqual(rows);
});

test("a broad text filter narrows to rows matching every token, across fields", () => {
  expect(applyReportFilter(rows, "multisig", fields)).toEqual([rows[1]]);
  expect(applyReportFilter(rows, "A.1.1", fields)).toEqual([rows[0]]);
});

test("a quoted filter selects an exact phrase, same as the report page's strict mode", () => {
  expect(applyReportFilter(rows, '"Retire a Multisig Signer"', fields)).toEqual([rows[1]]);
  expect(applyReportFilter(rows, '"Multisig Retire"', fields)).toEqual([]); // words present, but not contiguous in that order
});

test("no match returns an empty array, not undefined/throw", () => {
  expect(applyReportFilter(rows, "nonexistent-token", fields)).toEqual([]);
});
