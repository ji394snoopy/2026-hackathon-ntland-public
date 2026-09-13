import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGradeIndividualFactorsTool } from "../../src/individualFactorGrading/tool.js";
import type {
  IndividualFactorsTree,
  RangeCriteria,
  EnumCriteria,
} from "../../src/individualFactorGrading/resolveGrades.js";

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

/** A trimmed 2-category slice of factor-standard.json's individualFactors tree. */
const SAMPLE_TREE: IndividualFactorsTree = {
  raw: "個別因素",
  categories: [
    category("lotCondition", "宗地條件", [
      item("shape", "形狀", [
        grade("superior", "優", 0, { type: "enum", raw: "方形", value: "square" }),
        grade("inferior", "劣", -5, { type: "enum", raw: "不規則形", value: "irregularShape" }),
      ]),
    ]),
    category("roadCondition", "道路條件", [
      item("frontageRoadWidth", "面前道路寬度", [
        grade("superior", "優", 0, { type: "range", raw: "20m以上", min: 20, max: null, unit: "m" }),
        grade("average", "普通", -5, {
          type: "range",
          raw: "8m以上未滿15m",
          min: 8,
          max: 15,
          unit: "m",
        }),
        grade("inferior", "劣", -10, {
          type: "range",
          raw: "未滿4m",
          min: null,
          max: 4,
          unit: "m",
        }),
      ]),
    ]),
  ],
};

function extractionSchemaOf(tool: ReturnType<typeof buildGradeIndividualFactorsTool>) {
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

test("buildGradeIndividualFactorsTool: categoryKey enum matches the tree's category keys", () => {
  const tool = buildGradeIndividualFactorsTool(SAMPLE_TREE);
  const properties = extractionSchemaOf(tool);
  assert.deepEqual(properties.categoryKey.enum, ["lotCondition", "roadCondition"]);
});

test("buildGradeIndividualFactorsTool: itemKey enum matches item keys across all categories", () => {
  const tool = buildGradeIndividualFactorsTool(SAMPLE_TREE);
  const properties = extractionSchemaOf(tool);
  assert.deepEqual(properties.itemKey.enum, ["shape", "frontageRoadWidth"]);
});

test("buildGradeIndividualFactorsTool: evidence.enumValue enum matches distinct criteria.values across all enum-type grades", () => {
  const tool = buildGradeIndividualFactorsTool(SAMPLE_TREE);
  const properties = extractionSchemaOf(tool);
  assert.deepEqual(properties.evidence.properties.enumValue!.enum, [
    "square",
    "irregularShape",
  ]);
});

test("buildGradeIndividualFactorsTool: tool name is grade_individual_factors and strict schema flag is true", () => {
  const tool = buildGradeIndividualFactorsTool(SAMPLE_TREE);
  assert.equal(tool.name, "grade_individual_factors");
  assert.equal(tool.strict, true);
});
