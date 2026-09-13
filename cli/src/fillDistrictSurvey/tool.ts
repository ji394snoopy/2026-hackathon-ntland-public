import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "../shared/tool.js";

// The fixed content-tree schema fillEngine.ts fills the PDF from — see its own file for the
// full slot-key rule table. Unlike every vocabulary-driven tool.ts elsewhere in this repo, this
// schema has no vocabulary file behind it: input/district-survey.pdf is one specific template
// with a fixed set of fields, so the shape is hand-derived from input/coordinates.json (a
// committed copy of districtSurvey's own coordinates-merged.json) once, the same way
// districtSurvey/*/sample/sampleTool.ts's per-category schemas were.
//
// One tool call per category, not one big combined call: a single tool covering all 8
// categories hit Bedrock's "compiled grammar is too large" error (strict-mode constrained
// decoding), the same wall districtSurvey's own per-category sampleTool.ts split already
// worked around for this exact PDF template.

const CATEGORY_KEYS = [
  "landImprovement",
  "specialFacilities",
  "commercialActivity",
  "landUseRegulation",
  "trafficAndTransport",
  "publicInfrastructure",
  "environmentalPollution",
  "naturalConditions",
  "otherFactors",
  "buildingCondition",
  "landUseStatus",
] as const;

type CategoryKey = (typeof CATEGORY_KEYS)[number];

// The raw district-survey fact list's own `group` field, verbatim — used to filter which facts
// get sent to each category's call (see pipeline.ts).
const CATEGORY_GROUP_LABELS: Record<CategoryKey, string> = {
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

function ref(defName: string): { $ref: string } {
  return { $ref: `#/$defs/${defName}` };
}

const facilityValueDef = {
  type: "object",
  description:
    "A single named-facility row that starts out as a pre-printed placeholder on the PDF " +
    "(either a 無/○ label, or — for a few rows — a blank cell) and only gets overwritten when " +
    "the district survey confirms a real facility exists. isExist:false means leave the row " +
    "alone: omit name (and inSection/distanceValue), even if the survey names the absent thing " +
    '(e.g. "無高鐵站") — that placeholder text is already on the page. isExist:true means give ' +
    "the real facility's name; then set inSection to whether it is inside the surveyed section " +
    "(true) or outside it (false), and distanceValue (meters, no unit) only when inSection is " +
    "false.",
  properties: {
    name: {
      type: "string",
      description:
        "The real facility name. Empty string when isExist is false.",
    },
    isExist: {
      type: "boolean",
      description:
        "Whether this specific facility actually exists near the parcel.",
    },
    inSection: {
      type: "boolean",
      description:
        "true = inside the surveyed section (本區段內), false = outside (本區段外). Omit when isExist is false.",
    },
    distanceValue: {
      type: "number",
      description:
        "Distance in meters when inSection is false. Omit when inSection is true or isExist is false.",
    },
  },
  required: ["name", "isExist"],
  additionalProperties: false,
};

const facilityWithQuantityValueDef = {
  type: "object",
  description:
    "Same placeholder-overwrite rule as a plain facility row, plus a count of how many such " +
    "facilities exist. Always include quantity when isExist is true — default to 1 if the " +
    "survey doesn't state an explicit count. Never include it when isExist is false.",
  properties: {
    name: {
      type: "string",
      description:
        "The real facility name. Empty string when isExist is false.",
    },
    isExist: {
      type: "boolean",
      description:
        "Whether this facility type actually exists near the parcel.",
    },
    quantity: {
      type: "integer",
      description:
        "How many such facilities. Required whenever isExist is true (default to 1 if the survey gives no count); omit when isExist is false.",
    },
    inSection: {
      type: "boolean",
      description:
        "true = inside the surveyed section, false = outside. Omit when isExist is false.",
    },
    distanceValue: {
      type: "number",
      description: "Distance in meters when inSection is false.",
    },
  },
  required: ["name", "isExist"],
  additionalProperties: false,
};

const textValueDef = {
  type: "object",
  description:
    "The exact final Chinese text to print for this field, already fully resolved (percent " +
    "signs, units, etc. included as they should appear). Empty string when the district survey " +
    "has no data for this field — never invent a value.",
  properties: {
    text: { type: "string" },
  },
  required: ["text"],
  additionalProperties: false,
};

const labelNumberValueDef = {
  type: "object",
  description:
    'A named road plus its width. Split a combined survey string like "中山路，寬度18M" into label and the bare number.',
  properties: {
    label: { type: "string", description: "The road name, e.g. 中山路." },
    value: {
      type: "number",
      description: "The width in meters, as a bare number (e.g. 18 for 18M).",
    },
  },
  required: ["label", "value"],
  additionalProperties: false,
};

const plainNumberValueDef = {
  type: "object",
  description: "A bare number with no label, e.g. an average width in meters.",
  properties: {
    value: { type: "number" },
  },
  required: ["value"],
  additionalProperties: false,
};

const busStopValueDef = {
  type: "object",
  description:
    "站牌 (bus stop) — always printed, unlike the placeholder-gated facility rows above, so always supply a name even if it must be inferred loosely.",
  properties: {
    name: { type: "string", description: "The bus stop's name." },
    inSection: {
      type: "boolean",
      description: "true = inside the surveyed section, false = outside.",
    },
    densityLevel: {
      type: "integer",
      enum: [0, 1, 2],
      description:
        "How densely served, in printed order: 0=非常密集, 1=密集, 2=不密集.",
    },
    distanceValue: {
      type: "number",
      description: "Distance in meters when inSection is false.",
    },
  },
  required: ["name"],
  additionalProperties: false,
};

const checkedItemDef = {
  type: "object",
  properties: {
    checked: { type: "boolean" },
  },
  required: ["checked"],
  additionalProperties: false,
};

const checkedOtherItemDef = {
  type: "object",
  description:
    'The trailing free-text "其他" checkbox row after the fixed option list.',
  properties: {
    checked: { type: "boolean" },
    text: {
      type: "string",
      description:
        "The free-text description. Only present when checked is true.",
    },
  },
  required: ["checked"],
  additionalProperties: false,
};

const ALL_DEFS = {
  facilityValue: facilityValueDef,
  facilityWithQuantityValue: facilityWithQuantityValueDef,
  textValue: textValueDef,
  labelNumberValue: labelNumberValueDef,
  plainNumberValue: plainNumberValueDef,
  busStopValue: busStopValueDef,
  checkedItem: checkedItemDef,
  checkedOtherItem: checkedOtherItemDef,
};

function facilityItems(count: number, order: string): unknown {
  return {
    type: "array",
    description: `Exactly ${count} entries, in this fixed printed order: ${order}.`,
    items: {
      type: "object",
      properties: { value: ref("facilityValue") },
      required: ["value"],
      additionalProperties: false,
    },
  };
}

function wrapped(defName: string): unknown {
  return {
    type: "object",
    properties: { value: ref(defName) },
    required: ["value"],
    additionalProperties: false,
  };
}

function checkboxGroup(itemCount: number, optionOrder: string): unknown {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: `Exactly ${itemCount} entries, one per fixed option, in this printed order: ${optionOrder}.`,
        items: ref("checkedItem"),
      },
      other: ref("checkedOtherItem"),
    },
    required: ["items", "other"],
    additionalProperties: false,
  };
}

function collectDefRefs(node: unknown, refs: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectDefRefs(item, refs);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === "string" && obj.$ref.startsWith("#/$defs/")) {
      refs.add(obj.$ref.slice("#/$defs/".length));
    }
    for (const value of Object.values(obj)) collectDefRefs(value, refs);
  }
}

// Most categories reference only 1-2 of ALL_DEFS' 8 entries (e.g. naturalConditions/
// landUseRegulation/otherFactors/buildingCondition each only need textValue) — sending the full
// ~1,200-token $defs block on every call regardless was wasted input tokens on every one of
// fillDistrictSurvey's 6 sequential calls per run. Scans the schema being built (transitively,
// since a referenced def could in principle $ref another) and includes only the defs actually
// reachable from it.
function usedDefs(properties: Record<string, unknown>): Record<string, unknown> {
  const refs = new Set<string>();
  collectDefRefs(properties, refs);
  for (const name of refs) collectDefRefs(ALL_DEFS[name as keyof typeof ALL_DEFS], refs);
  const result: Record<string, unknown> = {};
  for (const name of refs) result[name] = ALL_DEFS[name as keyof typeof ALL_DEFS];
  return result;
}

interface CategorySchema {
  properties: Record<string, unknown>;
  required: string[];
}

const CATEGORY_SCHEMAS: Record<CategoryKey, CategorySchema> = {
  landImprovement: {
    properties: {
      buildingSiteImprovement: checkboxGroup(
        6,
        "整平或填挖基地, 開挖水溝, 水土保持, 鋪築道路, 埋設管道, 修築駁嵌",
      ),
      farmlandImprovement: checkboxGroup(
        9,
        "耕地整理, 水土保持, 土壤改良, 修築農路, 灌溉, 排水, 防風, 防砂, 堤防",
      ),
    },
    required: ["buildingSiteImprovement", "farmlandImprovement"],
  },
  specialFacilities: {
    properties: {
      utilityGasFacility: facilityItems(2, "變電所或高壓鐵塔, 瓦斯槽或儲油槽"),
      funeralFacility: facilityItems(4, "墓地, 殯儀館, 火葬場, 納骨塔"),
      wasteFacility: facilityItems(3, "污水處理場, 垃圾場或掩埋場, 焚化爐"),
    },
    required: ["utilityGasFacility", "funeralFacility", "wasteFacility"],
  },
  commercialActivity: {
    properties: {
      departmentStore: wrapped("facilityWithQuantityValue"),
      financialInstitution: wrapped("facilityWithQuantityValue"),
      entertainmentFacility: wrapped("facilityWithQuantityValue"),
      exhibitionCenterOrHotel: wrapped("facilityWithQuantityValue"),
      customerTraffic: wrapped("textValue"),
      storeContiguity: wrapped("textValue"),
    },
    required: [
      "departmentStore",
      "financialInstitution",
      "entertainmentFacility",
      "exhibitionCenterOrHotel",
      "customerTraffic",
      "storeContiguity",
    ],
  },
  landUseRegulation: {
    properties: {
      insideOutsideUrbanPlan: wrapped("textValue"),
      zoningDesignation: wrapped("textValue"),
      buildingCoverageRatio: wrapped("textValue"),
      floorAreaRatio: wrapped("textValue"),
      buildingProhibition: wrapped("textValue"),
      buildingRestriction: wrapped("textValue"),
    },
    required: [
      "insideOutsideUrbanPlan",
      "zoningDesignation",
      "buildingCoverageRatio",
      "floorAreaRatio",
      "buildingProhibition",
      "buildingRestriction",
    ],
  },
  trafficAndTransport: {
    properties: {
      mainRoad: wrapped("labelNumberValue"),
      averageRoadWidthInSection: wrapped("plainNumberValue"),
      majorStation: {
        type: "object",
        properties: {
          items: facilityItems(4, "高鐵站, 火車站, 客運站, 捷運站"),
        },
        required: ["items"],
        additionalProperties: false,
      },
      busStop: wrapped("busStopValue"),
      interchange: wrapped("facilityValue"),
      proximityToSettlement: wrapped("textValue"),
      proximityToDistributionCenter: wrapped("textValue"),
      proximityToMarket: wrapped("textValue"),
      roadConstructionLevel: wrapped("textValue"),
    },
    required: [
      "mainRoad",
      "averageRoadWidthInSection",
      "majorStation",
      "busStop",
      "interchange",
      "proximityToSettlement",
      "proximityToDistributionCenter",
      "proximityToMarket",
      "roadConstructionLevel",
    ],
  },
  publicInfrastructure: {
    properties: {
      touristRecreationFacility: wrapped("facilityValue"),
      parkingArea: wrapped("facilityValue"),
      proximityToServiceFacility: wrapped("facilityValue"),
      electricPowerResources: wrapped("textValue"),
      industrialWaterSupply: wrapped("textValue"),
      wastewaterTreatmentFacility: wrapped("facilityValue"),
      school: {
        type: "object",
        properties: { items: facilityItems(4, "國小, 國中, 高中, 大專院校") },
        required: ["items"],
        additionalProperties: false,
      },
      market: {
        type: "object",
        description:
          "傳統市場's own row prints no label at all — if a named market fact doesn't clearly " +
          "match 超級市場 or 超大型購物中心, put it here anyway.",
        properties: {
          items: facilityItems(3, "傳統市場, 超級市場, 超大型購物中心"),
        },
        required: ["items"],
        additionalProperties: false,
      },
      parkPlazaPedestrianZone: {
        type: "object",
        description:
          "里鄰公園's own row prints no label at all — if a named park fact doesn't clearly " +
          "match 一般公園 or 廣場.徒步區, put it here anyway.",
        properties: {
          items: facilityItems(3, "里鄰公園, 一般公園, 廣場.徒步區"),
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    required: [
      "touristRecreationFacility",
      "parkingArea",
      "proximityToServiceFacility",
      "electricPowerResources",
      "industrialWaterSupply",
      "wastewaterTreatmentFacility",
      "school",
      "market",
      "parkPlazaPedestrianZone",
    ],
  },
  environmentalPollution: {
    properties: {
      environmentalPollution: {
        type: "object",
        properties: {
          items: facilityItems(
            5,
            "水污染, 噪音污染, 廢氣污染, 廢棄物污染, 其他污染",
          ),
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    required: ["environmentalPollution"],
  },
  naturalConditions: {
    properties: {
      sunlight: wrapped("textValue"),
      view: wrapped("textValue"),
      slope: wrapped("textValue"),
      drainageQuality: wrapped("textValue"),
      terrain: wrapped("textValue"),
      windCondition: wrapped("textValue"),
      soilQuality: wrapped("textValue"),
    },
    required: [
      "sunlight",
      "view",
      "slope",
      "drainageQuality",
      "terrain",
      "windCondition",
      "soilQuality",
    ],
  },
  otherFactors: {
    properties: {
      otherFactors: wrapped("textValue"),
    },
    required: ["otherFactors"],
  },
  buildingCondition: {
    properties: {
      buildingDensity: wrapped("textValue"),
      buildingType: wrapped("textValue"),
    },
    required: ["buildingDensity", "buildingType"],
  },
  landUseStatus: {
    properties: {
      landUseStatus: checkboxGroup(
        9,
        "商業用, 住宅用, 工業用, 住商混合, 住工混合, 農作用, 漁牧用, 空地, 公共設施",
      ),
    },
    required: ["landUseStatus"],
  },
};

const CATEGORY_TOOL_NAMES: Record<CategoryKey, string> = {
  landImprovement: "extract_land_improvement",
  specialFacilities: "extract_special_facilities",
  commercialActivity: "extract_commercial_activity",
  landUseRegulation: "extract_land_use_regulation",
  trafficAndTransport: "extract_traffic_and_transport",
  publicInfrastructure: "extract_public_infrastructure",
  environmentalPollution: "extract_environmental_pollution",
  naturalConditions: "extract_natural_conditions",
  otherFactors: "extract_other_factors",
  buildingCondition: "extract_building_condition",
  landUseStatus: "extract_land_use_status",
};

function buildCategoryContentTool(categoryKey: CategoryKey): ToolDefinition {
  const groupLabel = CATEGORY_GROUP_LABELS[categoryKey];
  const schema = CATEGORY_SCHEMAS[categoryKey];
  return {
    name: CATEGORY_TOOL_NAMES[categoryKey],
    description:
      `Map this parcel's ${groupLabel} district-survey facts onto the fixed field structure of ` +
      "the 表1 地價區段勘查表 PDF template's own printed slots for this category.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: usedDefs(schema.properties),
      properties: schema.properties,
      required: schema.required,
      additionalProperties: false,
    },
  };
}

// Merges several categories' existing schemas into one tool, each nested under its own
// top-level key (rather than one flat property bag) so a single response can still be routed
// back to the right category. Reuses CATEGORY_SCHEMAS/ALL_DEFS as-is — no duplicated field
// definitions — so a category's field structure only has to be correct in one place whether
// it's called solo (buildCategoryContentTool) or merged into a group.
function buildGroupContentTool(categoryKeys: CategoryKey[]): ToolDefinition {
  const properties: Record<string, unknown> = {};
  for (const categoryKey of categoryKeys) {
    const schema = CATEGORY_SCHEMAS[categoryKey];
    properties[categoryKey] = {
      type: "object",
      properties: schema.properties,
      required: schema.required,
      additionalProperties: false,
    };
  }
  const groupLabels = categoryKeys
    .map((categoryKey) => CATEGORY_GROUP_LABELS[categoryKey])
    .join("、");
  return {
    name: `extract_group_${categoryKeys.join("_")}`,
    description:
      `Map this parcel's ${groupLabels} district-survey facts onto the fixed field structure ` +
      "of the 表1 地價區段勘查表 PDF template's own printed slots for these categories, one " +
      "top-level key per category.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: usedDefs(properties),
      properties,
      required: [...categoryKeys],
      additionalProperties: false,
    },
  };
}

// A merged group tool can hit Bedrock's "compiled grammar is too large" error (strict-mode
// constrained decoding) once enough categories' schemas are combined into one call — the same
// wall a single all-8 call already hit (see this file's header comment). Callers use this to
// detect that specific, non-retryable 400 and fall back to per-category calls for that group,
// rather than treating every 400 as fatal.
function isGrammarTooLargeError(err: unknown): boolean {
  return (
    err instanceof Anthropic.APIError &&
    err.status === 400 &&
    /grammar/i.test(err.message ?? "")
  );
}

export {
  buildCategoryContentTool,
  buildGroupContentTool,
  isGrammarTooLargeError,
  CATEGORY_KEYS,
  CATEGORY_GROUP_LABELS,
  CATEGORY_SCHEMAS,
};
export type { CategoryKey };
