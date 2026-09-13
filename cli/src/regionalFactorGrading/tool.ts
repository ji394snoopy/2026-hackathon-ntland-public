import type { ToolDefinition } from "../shared/tool.js";
import type { RegionalFactorsTree } from "./resolveGrades.js";

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function collectCategoryKeys(regionalFactors: RegionalFactorsTree): string[] {
  return regionalFactors.categories.map((category) => category.key);
}

function collectItemKeys(regionalFactors: RegionalFactorsTree): string[] {
  return uniqueInOrder(
    regionalFactors.categories.flatMap((category) =>
      category.items.map((item) => item.key),
    ),
  );
}

function collectEnumCriteriaValues(regionalFactors: RegionalFactorsTree): string[] {
  const values: string[] = [];
  for (const category of regionalFactors.categories) {
    for (const item of category.items) {
      for (const grade of item.grades) {
        if (grade.criteria.type === "enum") {
          values.push(grade.criteria.value);
        }
      }
    }
  }
  return uniqueInOrder(values);
}

function buildGradeRegionalFactorsTool(
  regionalFactors: RegionalFactorsTree,
): ToolDefinition {
  const categoryKeyEnum = collectCategoryKeys(regionalFactors);
  const itemKeyEnum = collectItemKeys(regionalFactors);
  const enumCriteriaValueEnum = collectEnumCriteriaValues(regionalFactors);

  return {
    name: "grade_regional_factors",
    description:
      "Extract, per regionalFactors item the district survey gives enough information to judge, " +
      "the raw evidence (a number+unit, a closed-vocabulary classification, or a presence/absence " +
      "flag) needed to grade this parcel's regional factors (區域因素) — not the grade itself. The " +
      "grade is computed afterward from this evidence against the factor-standard grading " +
      "definitions. Do not include an item you cannot confidently supply evidence for.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        extractions: {
          type: "array",
          description:
            "One entry per (item, matching survey fact) pair. An item fed by more than one survey " +
            "fact (e.g. two different named hazards near the same category) gets one entry per " +
            "fact, all sharing the same categoryKey/itemKey — the closest one is resolved into the " +
            "final grade automatically. Omit items with no matching fact rather than guessing.",
          items: {
            type: "object",
            properties: {
              categoryKey: {
                type: "string",
                enum: categoryKeyEnum,
                description: "The regionalFactors main-category (主要項目) this item belongs to.",
              },
              itemKey: {
                type: "string",
                enum: itemKeyEnum,
                description: "The regionalFactors sub-item (細項) this evidence is for.",
              },
              evidence: {
                type: "object",
                description:
                  "The raw fact from the district survey, tagged by how it should be read. type " +
                  "picks which of the other fields apply.",
                properties: {
                  type: {
                    type: "string",
                    enum: ["range", "enum", "boolean"],
                    description:
                      '"range" for a number+unit (e.g. a distance or percentage), "enum" for a ' +
                      "closed-vocabulary classification (e.g. an \"in the section\" state or a " +
                      "development-level label), \"boolean\" for a 有/無 (present/absent) fact — " +
                      "including reporting that a specific named sub-facility (e.g. a crematorium) " +
                      "does not exist at all.",
                  },
                  raw: {
                    type: "string",
                    description: "The relevant district-survey text this evidence was read from.",
                  },
                  value: {
                    type: "number",
                    description: "Only for type=range. The numeric value, e.g. 18 for \"18M\".",
                  },
                  unit: {
                    type: "string",
                    description: "Only for type=range. The unit, e.g. m, m2, %.",
                  },
                  enumValue: {
                    type: "string",
                    enum: enumCriteriaValueEnum,
                    description:
                      "Only for type=enum. The exact key from the factor-standard grading table's " +
                      "enum criteria that this survey fact matches.",
                  },
                  present: {
                    type: "boolean",
                    description:
                      "Only for type=boolean. true if the surveyed thing is present/exists, false " +
                      "if the survey says 無 (absent/does not exist).",
                  },
                },
                required: ["type", "raw"],
                additionalProperties: false,
              },
            },
            required: ["categoryKey", "itemKey", "evidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["extractions"],
      additionalProperties: false,
    },
  };
}

export { buildGradeRegionalFactorsTool };
