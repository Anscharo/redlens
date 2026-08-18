import { expect, test } from "bun:test";
import { fromUuidArray, toUuidArrayLiteral } from "./pg-array.ts";

const a = "575ab954-d26c-460e-8a11-ebe7f5586dff";
const b = "9a8120c4-0a5b-426f-97a5-283c708413f5";

test("toUuidArrayLiteral formats a uuid[] as a Postgres brace literal", () => {
  expect(toUuidArrayLiteral([a])).toBe(`{${a}}`);
  expect(toUuidArrayLiteral([a, b])).toBe(`{${a},${b}}`);
  expect(toUuidArrayLiteral([])).toBe("{}");
});

test("fromUuidArray accepts a JS array, a Postgres text literal, and empty/null", () => {
  expect(fromUuidArray([a, b])).toEqual([a, b]);
  expect(fromUuidArray(`{${a},${b}}`)).toEqual([a, b]);
  expect(fromUuidArray(`{${a}}`)).toEqual([a]);
  expect(fromUuidArray(`{"${a}","${b}"}`)).toEqual([a, b]);
  expect(fromUuidArray(`{${a},,${b}}`)).toEqual([a, b]);
  expect(fromUuidArray("{}")).toEqual([]);
  expect(fromUuidArray("")).toEqual([]);
  expect(fromUuidArray(null)).toEqual([]);
  expect(fromUuidArray(undefined)).toEqual([]);
  expect(fromUuidArray(1)).toEqual([]);
  expect(fromUuidArray(a)).toEqual([a]);
});
