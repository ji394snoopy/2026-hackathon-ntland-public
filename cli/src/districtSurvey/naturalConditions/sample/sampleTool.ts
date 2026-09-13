import type { ToolDefinition } from "../../../shared/tool.js";
import { ref } from "../../shared/jsonSchemaRef.js";

const leafValueDef = {
  type: "object",
  description:
    "A plain (non-facility) item's printed answer, tagged by how it should be read.",
  properties: {
    type: {
      type: "string",
      enum: ["text", "number", "measurement"],
      description:
        '"text" for a bare descriptive sentence/label with no separate number, e.g. 良好, or an ' +
        'empty string if nothing is printed. "number" for a bare number with a trailing unit and ' +
        'no place-name/label attached, e.g. 5%. "measurement" for a place/street name plus a ' +
        "number and unit.",
    },
    raw: {
      type: "string",
      description:
        "The exact printed cell text, verbatim — kept only so the model can cross-check its " +
        "own consistency against the other fields below. Never read by downstream code; the " +
        "actual value always comes from text/value+unit instead.",
    },
    text: {
      type: "string",
      description:
        "Only for type=text. The answer content to use for filling — same content as raw, " +
        "or an empty string if nothing is printed.",
    },
    label: {
      type: "string",
      description: "Only for type=measurement. The place-name portion of the cell.",
    },
    value: {
      type: "number",
      description:
        "Only for type=number or type=measurement. The parsed numeric portion of the cell.",
    },
    unit: {
      type: "string",
      description:
        "Only for type=number or type=measurement. The trailing unit text (e.g. %), if present.",
    },
  },
  required: ["type", "raw"],
  additionalProperties: false,
};

const leafItemDef = {
  type: "object",
  description: "One plain (non-facility) 自然條件 item.",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese item label exactly as printed (leading numeric code stripped).",
    },
    value: ref("leafValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

function buildNaturalConditionsTool(): ToolDefinition {
  return {
    name: "extract_natural_conditions_items",
    description:
      "Extract every item under 自然條件 (natural conditions), one main-category block of the " +
      "表1 地價區段勘查表: seven bare-text/number items, in printed order — 日照, 景觀, 傾斜度, " +
      "保（排）水之良否, 地勢, 風勢, 土質.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        leafValue: leafValueDef,
        leafItem: leafItemDef,
      },
      properties: {
        sunlight: ref("leafItem"),
        view: ref("leafItem"),
        slope: ref("leafItem"),
        drainageQuality: ref("leafItem"),
        terrain: ref("leafItem"),
        windCondition: ref("leafItem"),
        soilQuality: ref("leafItem"),
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
      additionalProperties: false,
    },
  };
}

export { buildNaturalConditionsTool };
