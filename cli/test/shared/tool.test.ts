import { test } from "node:test";
import assert from "node:assert/strict";
import { extractResult } from "../../src/shared/tool.js";

test("extractResult: happy path returns the matching tool_use block's input", () => {
  const responseBody = {
    content: [
      {
        type: "tool_use",
        name: "extract_grading_item",
        input: { itemKey: "insideOutsideUrbanPlan" },
      },
    ],
  };
  assert.deepEqual(extractResult(responseBody, "extract_grading_item"), {
    itemKey: "insideOutsideUrbanPlan",
  });
});

test("extractResult: ignores a leading text block and finds the tool_use block", () => {
  const responseBody = {
    content: [
      { type: "text", text: "Here is the extracted item:" },
      {
        type: "tool_use",
        name: "extract_grading_item",
        input: { itemKey: "insideOutsideUrbanPlan" },
      },
    ],
  };
  assert.deepEqual(extractResult(responseBody, "extract_grading_item"), {
    itemKey: "insideOutsideUrbanPlan",
  });
});

test("extractResult: throws when no matching tool_use block is present", () => {
  const responseBody = {
    content: [{ type: "text", text: "no tool call here" }],
  };
  assert.throws(() => extractResult(responseBody, "extract_grading_item"));
});

test("extractResult: throws when the tool_use block is for a different tool", () => {
  const responseBody = {
    content: [{ type: "tool_use", name: "some_other_tool", input: {} }],
  };
  assert.throws(() => extractResult(responseBody, "extract_grading_item"));
});

test("extractResult: throws when the response body has no content array", () => {
  assert.throws(() => extractResult({}, "extract_grading_item"));
  assert.throws(() => extractResult(null, "extract_grading_item"));
});
