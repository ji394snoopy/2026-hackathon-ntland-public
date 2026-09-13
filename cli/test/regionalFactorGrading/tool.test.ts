import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGradeRegionalFactorsTool } from "../../src/regionalFactorGrading/tool.js";
import type {
  RegionalFactorsTree,
  RangeCriteria,
  EnumCriteria,
} from "../../src/regionalFactorGrading/resolveGrades.js";

function grade(
  key: string,
  raw: string,
  value: number,
  criteria: RangeCriteria | EnumCriteria,
) {
  return { key, raw, value, criteria };
}

function item(key: string, raw: string, grades: ReturnType<typeof grade>[]) {
  return { key, raw, grades };
}

function category(key: string, raw: string, items: ReturnType<typeof item>[]) {
  return { key, raw, items };
}

/** A trimmed 2-category slice of references/factor-standard.json's regionalFactors tree. */
const SAMPLE_TREE: RegionalFactorsTree = {
  raw: "區域因素",
  categories: [
    category("landUseRegulation", "土地使用管制", [
      item("insideOutsideUrbanPlan", "都市計畫內外", [
        grade("superior", "優", 0, {
          type: "enum",
          raw: "都市計畫內",
          value: "insideUrbanPlan",
        }),
        grade("inferior", "劣", -20, {
          type: "enum",
          raw: "都市計畫外",
          value: "outsideUrbanPlan",
        }),
      ]),
    ]),
    category("trafficAndTransport", "交通運輸", [
      item("mainRoadWidth", "主要道路寬度", [
        grade("superior", "優", 0, { type: "range", raw: "30m以上", min: 30, max: null, unit: "m" }),
        grade("average", "普通", -7.5, {
          type: "range",
          raw: "15m以上未滿20m",
          min: 15,
          max: 20,
          unit: "m",
        }),
        grade("inferior", "劣", -15, {
          type: "range",
          raw: "未滿10m",
          min: null,
          max: 10,
          unit: "m",
        }),
      ]),
    ]),
  ],
};

function extractionSchemaOf(tool: ReturnType<typeof buildGradeRegionalFactorsTool>) {
  const inputSchema = tool.input_schema as {
    properties: {
      extractions: {
        items: {
          properties: {
            categoryKey: { enum: string[] };
            itemKey: { enum: string[] };
            evidence: { properties: Record<string, { enum?: string[] }> };
          };
        };
      };
    };
  };
  return inputSchema.properties.extractions.items.properties;
}

test("buildGradeRegionalFactorsTool: categoryKey enum matches the tree's category keys", () => {
  const tool = buildGradeRegionalFactorsTool(SAMPLE_TREE);
  const properties = extractionSchemaOf(tool);
  assert.deepEqual(properties.categoryKey.enum, [
    "landUseRegulation",
    "trafficAndTransport",
  ]);
});

test("buildGradeRegionalFactorsTool: itemKey enum matches item keys across all categories", () => {
  const tool = buildGradeRegionalFactorsTool(SAMPLE_TREE);
  const properties = extractionSchemaOf(tool);
  assert.deepEqual(properties.itemKey.enum, ["insideOutsideUrbanPlan", "mainRoadWidth"]);
});

test("buildGradeRegionalFactorsTool: evidence.enumValue enum matches distinct criteria.values across all enum-type grades", () => {
  const tool = buildGradeRegionalFactorsTool(SAMPLE_TREE);
  const properties = extractionSchemaOf(tool);
  assert.deepEqual(properties.evidence.properties.enumValue!.enum, [
    "insideUrbanPlan",
    "outsideUrbanPlan",
  ]);
});

test("buildGradeRegionalFactorsTool: tool name and strict schema flags", () => {
  const tool = buildGradeRegionalFactorsTool(SAMPLE_TREE);
  assert.equal(tool.name, "grade_regional_factors");
  assert.equal(tool.strict, true);
});
