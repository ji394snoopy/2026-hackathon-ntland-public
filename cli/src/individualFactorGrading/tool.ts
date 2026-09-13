import type { ToolDefinition } from "../shared/tool.js";
import type { IndividualFactorsTree } from "./resolveGrades.js";

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function collectCategoryKeys(individualFactors: IndividualFactorsTree): string[] {
  return individualFactors.categories.map((category) => category.key);
}

function collectItemKeys(individualFactors: IndividualFactorsTree): string[] {
  return uniqueInOrder(
    individualFactors.categories.flatMap((category) =>
      category.items.map((item) => item.key),
    ),
  );
}

function collectEnumCriteriaValues(individualFactors: IndividualFactorsTree): string[] {
  const values: string[] = [];
  for (const category of individualFactors.categories) {
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

function buildGradeIndividualFactorsTool(
  individualFactors: IndividualFactorsTree,
): ToolDefinition {
  const categoryKeyEnum = collectCategoryKeys(individualFactors);
  const itemKeyEnum = collectItemKeys(individualFactors);
  const enumCriteriaValueEnum = collectEnumCriteriaValues(individualFactors);

  return {
    name: "grade_individual_factors",
    description:
      "Extract, per individualFactors item the benchmark parcel data gives enough information to " +
      "judge, the raw evidence (a number+unit, a closed-vocabulary classification, or a " +
      "presence/absence flag) needed to grade this parcel's individual factors (個別因素) — not " +
      "the grade itself. The grade is computed afterward from this evidence against the " +
      "factor-standard grading definitions. Do not include an item you cannot confidently supply " +
      "evidence for.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        extractions: {
          type: "array",
          description:
            "One entry per (item, matching fact) pair. An item fed by more than one fact gets one " +
            "entry per fact, all sharing the same categoryKey/itemKey — the closest one is " +
            "resolved into the final grade automatically. Omit items with no matching fact rather " +
            "than guessing.",
          items: {
            type: "object",
            properties: {
              categoryKey: {
                type: "string",
                enum: categoryKeyEnum,
                description: "The individualFactors main-category (主要項目) this item belongs to.",
              },
              itemKey: {
                type: "string",
                enum: itemKeyEnum,
                description: "The individualFactors sub-item (細項) this evidence is for.",
              },
              evidence: {
                type: "object",
                description:
                  "The raw fact from the parcel's benchmark data, tagged by how it should be " +
                  "read. type picks which of the other fields apply.",
                properties: {
                  type: {
                    type: "string",
                    enum: ["range", "enum", "boolean"],
                    description:
                      '"range" for a number+unit (e.g. a distance, area, or percentage), "enum" ' +
                      'for a closed-vocabulary classification (e.g. a zoning type or shape label), ' +
                      '"boolean" for a 有/無 (present/absent) fact.',
                  },
                  raw: {
                    type: "string",
                    description: "The relevant benchmark-data text this evidence was read from.",
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
                      "enum criteria that this benchmark fact matches.",
                  },
                  present: {
                    type: "boolean",
                    description:
                      "Only for type=boolean. true if the fact is present/exists, false if it is " +
                      "recorded as 無 (absent/does not exist).",
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

export { buildGradeIndividualFactorsTool };
