import { test, expect } from "bun:test";
import {
  ASK_EXTERNAL_MSC,
  EXTERNAL_MSC,
  MSC_REQUIRED_DISCLAIMER,
  MSC_SOURCE_CLASS,
  answerHasMscDisclaimer,
  isExternalMscTool,
  mscEnvelope,
  workbookUrl,
} from "./envelope.ts";

test("envelope is always not_atlas with the required disclaimer", () => {
  const env = mscEnvelope([{ kind: "soter_workbook", prime: "spark", month: "2026-07", url: workbookUrl("spark", "2026-07") }]);
  expect(env.source_class).toBe(MSC_SOURCE_CLASS);
  expect(env.not_atlas).toBe(true);
  expect(env.required_disclaimer).toBe(MSC_REQUIRED_DISCLAIMER);
  expect(env.sources[0]).toMatchObject({ kind: "soter_workbook", prime: "spark", month: "2026-07" });
});

test("isExternalMscTool keys the chat vs MCP names", () => {
  expect(isExternalMscTool(ASK_EXTERNAL_MSC)).toBe(true);
  expect(isExternalMscTool(EXTERNAL_MSC)).toBe(true);
  expect(isExternalMscTool("atlas_get")).toBe(false);
});

test("answerHasMscDisclaimer requires not-from-atlas plus a real source name", () => {
  expect(answerHasMscDisclaimer("Spark sent $5 to Sky.")).toBe(false);
  expect(answerHasMscDisclaimer("These figures are not from the Atlas. They come from Soter Labs workbooks.")).toBe(true);
  expect(answerHasMscDisclaimer("Not from the Atlas — see the Sky Forum post.")).toBe(true);
});
