import type { CategoryMapping, ToolDefinition } from "../shared/tool.js";

interface KeyedEntrySchemaOptions {
  mapping: Record<string, string>;
  keyDescription: string;
  properties: Record<string, unknown>;
  required: string[];
}

const criteriaDef = {
  type: "object",
  description:
    "The qualifying condition for this grade, tagged by how it should be read. type is chosen per " +
    "grade — grades within the same item can use different types.",
  properties: {
    type: {
      type: "string",
      enum: ["enum", "range", "boolean"],
      description:
        '"enum" for a categorical label, "range" for a numeric threshold/band, "boolean" for a ' +
        "有/無 (present/absent) pair.",
    },
    raw: {
      type: "string",
      description:
        "The Chinese criteria text printed for this grade, exactly as printed",
    },
    value: {
      type: "string",
      description:
        "Only for type=enum. The English key from the provided key vocabulary matching raw exactly; " +
        "reuse the original Chinese text only if no vocabulary entry matches.",
    },
    min: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description:
        "Only for type=range. The lower bound, or null if the range is open below.",
    },
    max: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description:
        "Only for type=range. The upper bound, or null if the range is open above.",
    },
    unit: {
      type: "string",
      description:
        "Only for type=range. The trailing unit text, e.g. %, m, m2.",
    },
    bands: {
      type: "array",
      description:
        "Only for type=range, and only in the rare case where the qualifying text is a union of " +
        'two or more disjoint numeric intervals joined by 或 (e.g. "7m以上未滿14m 或 40m以上未滿' +
        '50m"). Give one {min,max} entry per interval instead of collapsing them into a single ' +
        "min/max pair — set the top-level min/max to null when bands is used. Leave bands absent " +
        "for an ordinary single-interval range.",
      items: {
        type: "object",
        properties: {
          min: {
            anyOf: [{ type: "number" }, { type: "null" }],
            description: "The interval's lower bound, or null if open below.",
          },
          max: {
            anyOf: [{ type: "number" }, { type: "null" }],
            description: "The interval's upper bound, or null if open above.",
          },
        },
        required: ["min", "max"],
        additionalProperties: false,
      },
    },
    present: {
      type: "boolean",
      description: "Only for type=boolean. true for 有, false for 無.",
    },
  },
  required: ["type", "raw"],
  additionalProperties: false,
};

const itemsArrayDef = {
  type: "array",
  description: "Every sub-item (細項) under this category, in printed order.",
  items: ref("itemEntry"),
};

function ref(defName: string): { $ref: string } {
  return { $ref: `#/$defs/${defName}` };
}

function keyedEntrySchema({
  mapping,
  keyDescription,
  properties,
  required,
}: KeyedEntrySchemaOptions) {
  return {
    type: "object",
    properties: {
      key: {
        type: "string",
        enum: Object.values(mapping),
        description: keyDescription,
      },
      ...properties,
    },
    required: ["key", ...required],
    additionalProperties: false,
  };
}

function buildGradeEntryDef(gradeMapping: Record<string, string>) {
  return keyedEntrySchema({
    mapping: gradeMapping,
    keyDescription:
      "English grade name, from the fixed set of grade names (優/稍優/普通/稍劣/劣).",
    properties: {
      raw: {
        type: "string",
        description: "The Chinese grade label exactly as printed, e.g. 優",
      },
      value: {
        type: "number",
        description: "The price-correction-rate value printed for this grade",
      },
      criteria: ref("criteria"),
    },
    required: ["raw", "value", "criteria"],
  });
}

function buildItemEntryDef(itemMapping: Record<string, string>) {
  return keyedEntrySchema({
    mapping: itemMapping,
    keyDescription:
      "English camelCase key for this item, from the fixed item vocabulary.",
    properties: {
      raw: {
        type: "string",
        description: "The Chinese sub-item (細項) label exactly as printed",
      },
      remarks: {
        type: "string",
        description:
          "The Chinese remarks (備註) text for this item, if present",
      },
      grades: {
        type: "array",
        description:
          "Every grade row for this item, in printed order — include only the grades that " +
          "actually appear (some items only have superior/inferior).",
        items: ref("gradeEntry"),
      },
    },
    required: ["raw", "grades"],
  });
}

function buildCategoryEntryDef(
  categoryMapping: Record<string, string>,
  factorGroupLabel: string,
) {
  return keyedEntrySchema({
    mapping: categoryMapping,
    keyDescription: `English category name for a ${factorGroupLabel} main category (主要項目).`,
    properties: {
      raw: {
        type: "string",
        description:
          "The Chinese main-category (主要項目) label exactly as printed",
      },
      items: itemsArrayDef,
    },
    required: ["raw", "items"],
  });
}

function buildFactorGroupDef(
  rawDescription: string,
  categoryEntryDef: unknown,
) {
  return {
    type: "object",
    properties: {
      raw: { type: "string", description: rawDescription },
      categories: {
        type: "array",
        description: "Every main category (主要項目) in this table.",
        items: categoryEntryDef,
      },
    },
    required: ["raw", "categories"],
    additionalProperties: false,
  };
}

function buildExtractResultTool(
  gradeMapping: Record<string, string>,
  categoryMapping: CategoryMapping,
  itemMapping: Record<string, string>,
): ToolDefinition {
  const gradeEntryDef = buildGradeEntryDef(gradeMapping);
  const itemEntryDef = buildItemEntryDef(itemMapping);
  const regionalCategoryEntryDef = buildCategoryEntryDef(
    categoryMapping.regional,
    "區域因素",
  );
  const individualCategoryEntryDef = buildCategoryEntryDef(
    categoryMapping.individual,
    "個別因素",
  );

  return {
    name: "extract_land_valuation_table",
    description:
      "Extract the complete land-value appraisal grading table, covering both the regional-factors " +
      "table (區域因素) and the individual-factors table (個別因素), preserving every main category, " +
      "sub-item, and grade exactly as printed.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        criteria: criteriaDef,
        gradeEntry: gradeEntryDef,
        itemEntry: itemEntryDef,
      },
      properties: {
        regionalFactors: buildFactorGroupDef(
          "區域因素",
          regionalCategoryEntryDef,
        ),
        individualFactors: buildFactorGroupDef(
          "個別因素",
          individualCategoryEntryDef,
        ),
      },
      required: ["regionalFactors", "individualFactors"],
      additionalProperties: false,
    },
  };
}

export { buildExtractResultTool };
