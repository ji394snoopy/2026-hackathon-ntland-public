import { test } from "node:test";
import assert from "node:assert/strict";
import { rawToolInputBuffer } from "../../src/fillDistrictSurvey/rawToolInputBuffer.js";

test("rawToolInputBuffer: reads the hidden __json_buf property off a tool_use block", () => {
  const block: Record<string, unknown> = { type: "tool_use", name: "extract_commercial_activity" };
  Object.defineProperty(block, "__json_buf", { value: '{"departmentStore":', enumerable: false });
  assert.equal(rawToolInputBuffer(block), '{"departmentStore":');
});

test("rawToolInputBuffer: returns undefined when the property is absent", () => {
  assert.equal(rawToolInputBuffer({ type: "tool_use", input: {} }), undefined);
});

test("rawToolInputBuffer: returns undefined for non-object input", () => {
  assert.equal(rawToolInputBuffer(undefined), undefined);
  assert.equal(rawToolInputBuffer(null), undefined);
  assert.equal(rawToolInputBuffer("not an object"), undefined);
});
