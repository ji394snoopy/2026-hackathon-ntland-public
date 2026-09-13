import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildCategoryContentTool,
  buildGroupContentTool,
  isGrammarTooLargeError,
  CATEGORY_KEYS,
  CATEGORY_GROUP_LABELS,
} from "../../src/fillDistrictSurvey/tool.js";
import type { CategoryKey } from "../../src/fillDistrictSurvey/tool.js";

test("CATEGORY_KEYS: has a group label for every category, and vice versa", () => {
  assert.deepEqual(Object.keys(CATEGORY_GROUP_LABELS).sort(), [...CATEGORY_KEYS].sort());
});

test("buildCategoryContentTool: every category gets a distinct, strict tool", () => {
  const names = new Set<string>();
  for (const categoryKey of CATEGORY_KEYS) {
    const tool = buildCategoryContentTool(categoryKey);
    assert.equal(tool.strict, true);
    const schema = tool.input_schema as { additionalProperties: boolean };
    assert.equal(schema.additionalProperties, false);
    assert.ok(!names.has(tool.name), `duplicate tool name: ${tool.name}`);
    names.add(tool.name);
  }
});

test("buildCategoryContentTool: each category's schema only covers that category's own fields", () => {
  const trafficTool = buildCategoryContentTool("trafficAndTransport");
  const schema = trafficTool.input_schema as { properties: Record<string, unknown>; required: string[] };
  assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
  assert.ok("majorStation" in schema.properties);
  assert.ok(!("landImprovement" in schema.properties));
});

test("buildCategoryContentTool: every $ref points at a $defs entry that actually exists", () => {
  for (const categoryKey of CATEGORY_KEYS) {
    const tool = buildCategoryContentTool(categoryKey);
    const schema = tool.input_schema as { $defs: Record<string, unknown> };
    const refs = new Set<string>();
    (function walk(node: unknown) {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === "object") {
        const ref = (node as { $ref?: string }).$ref;
        if (typeof ref === "string") refs.add(ref.replace("#/$defs/", ""));
        Object.values(node).forEach(walk);
      }
    })(schema);
    for (const name of refs) {
      assert.ok(name in schema.$defs, `${categoryKey}: missing $defs entry for $ref "${name}"`);
    }
  }
});

test("buildCategoryContentTool: fixed-order facility arrays declare the expected item count in their description", () => {
  const traffic = buildCategoryContentTool("trafficAndTransport").input_schema as {
    properties: { majorStation: { properties: { items: { description: string } } } };
  };
  assert.match(traffic.properties.majorStation.properties.items.description, /高鐵站, 火車站, 客運站, 捷運站/);

  const pollution = buildCategoryContentTool("environmentalPollution").input_schema as {
    properties: { environmentalPollution: { properties: { items: { description: string } } } };
  };
  assert.match(
    pollution.properties.environmentalPollution.properties.items.description,
    /水污染, 噪音污染, 廢氣污染, 廢棄物污染, 其他污染/,
  );
});

test("buildGroupContentTool: nests each category's own properties/required under its own top-level key", () => {
  const tool = buildGroupContentTool(["commercialActivity", "landUseRegulation"]);
  assert.equal(tool.strict, true);
  const schema = tool.input_schema as {
    properties: Record<string, { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }>;
    required: string[];
    additionalProperties: boolean;
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.sort(), ["commercialActivity", "landUseRegulation"]);

  const commercialTool = buildCategoryContentTool("commercialActivity").input_schema as {
    properties: Record<string, unknown>;
    required: string[];
  };
  const commercialActivityProperty = schema.properties.commercialActivity!;
  assert.deepEqual(commercialActivityProperty.properties, commercialTool.properties);
  assert.deepEqual(commercialActivityProperty.required, commercialTool.required);
  assert.equal(commercialActivityProperty.additionalProperties, false);
});

test("buildGroupContentTool: tool name is derived from every given categoryKey", () => {
  const tool = buildGroupContentTool(["trafficAndTransport", "publicInfrastructure"]);
  assert.match(tool.name, /trafficAndTransport/);
  assert.match(tool.name, /publicInfrastructure/);
});

test("buildGroupContentTool: every $ref in the merged schema resolves against $defs", () => {
  const tool = buildGroupContentTool(["landImprovement", "specialFacilities", "environmentalPollution"]);
  const schema = tool.input_schema as { $defs: Record<string, unknown> };
  const refs = new Set<string>();
  (function walk(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const ref = (node as { $ref?: string }).$ref;
      if (typeof ref === "string") refs.add(ref.replace("#/$defs/", ""));
      Object.values(node).forEach(walk);
    }
  })(schema);
  assert.ok(refs.size > 0);
  for (const name of refs) {
    assert.ok(name in schema.$defs, `missing $defs entry for $ref "${name}"`);
  }
});

test("isGrammarTooLargeError: true for a 400 APIError whose message mentions grammar", () => {
  const err = new Anthropic.APIError(400, { message: "compiled grammar is too large" }, undefined, new Headers());
  assert.equal(isGrammarTooLargeError(err), true);
});

test("isGrammarTooLargeError: false for a 400 APIError with an unrelated message", () => {
  const err = new Anthropic.APIError(400, { message: "invalid request: missing field" }, undefined, new Headers());
  assert.equal(isGrammarTooLargeError(err), false);
});

test("isGrammarTooLargeError: false for a non-APIError value", () => {
  assert.equal(isGrammarTooLargeError(new Error("compiled grammar is too large")), false);
});

test("CATEGORY_GROUP_LABELS: matches the raw sample-data.json's own survey group labels", () => {
  const expected: Record<CategoryKey, string> = {
    landImprovement: "土地改良",
    specialFacilities: "特殊設施",
    commercialActivity: "工商活動",
    landUseRegulation: "土地使用管制",
    trafficAndTransport: "交通運輸",
    publicInfrastructure: "公共建設",
    environmentalPollution: "環境污染",
    naturalConditions: "自然條件",
    otherFactors: "其他影響因素",
    buildingCondition: "房屋建築現況",
    landUseStatus: "土地利用現況",
  };
  assert.deepEqual(CATEGORY_GROUP_LABELS, expected);
});
