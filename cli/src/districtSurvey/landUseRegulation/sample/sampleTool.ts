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
        '"text" for a bare descriptive sentence/label with no separate number, e.g. 無, or an ' +
        'empty string if nothing is printed. "number" for a bare number with a trailing unit and ' +
        'no place-name/label attached, e.g. 70%. "measurement" for a place/street name plus a ' +
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

const singleChoiceValueDef = {
  type: "object",
  description:
    "都市計畫（內外）'s printed answer. This row prints no checkbox options — the surveyor writes " +
    "a free-text answer directly into the blank cell — but that answer always states one of two " +
    "fixed outcomes, so it's classified into an enum alongside the verbatim text.",
  properties: {
    type: {
      type: "string",
      enum: ["singleChoice"],
    },
    raw: {
      type: "string",
      description:
        "The exact printed/handwritten cell text, verbatim, e.g. 都市計畫內 — kept only for the " +
        "model's own consistency cross-check against selected. Never read by downstream code.",
    },
    selected: {
      type: "string",
      enum: ["insideUrbanPlan", "outsideUrbanPlan"],
      description:
        "insideUrbanPlan if raw states 都市計畫內 (inside the urban plan), outsideUrbanPlan if " +
        "raw states 都市計畫外 (outside the urban plan).",
    },
  },
  required: ["type", "raw", "selected"],
  additionalProperties: false,
};

const leafItemDef = {
  type: "object",
  description: "One plain (non-facility) 土地使用管制 item.",
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

const singleChoiceItemDef = {
  type: "object",
  description: "The 都市計畫（內外） item.",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese item label exactly as printed (leading numeric code stripped).",
    },
    value: ref("singleChoiceValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

function buildLandUseRegulationTool(): ToolDefinition {
  return {
    name: "extract_land_use_regulation_items",
    description:
      "Extract every item under 土地使用管制 (land use regulation), one main-category block of " +
      "the 表1 地價區段勘查表 (district survey table): 都市計畫（內外）（分類選項）plus five " +
      "bare-text/number items (使用分區（使用地類別）, 建蔽率, 容積率, 有無禁止建築, " +
      "有無限制建築（整體開發、面積限制、高度限制）).",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        leafValue: leafValueDef,
        singleChoiceValue: singleChoiceValueDef,
        leafItem: leafItemDef,
        singleChoiceItem: singleChoiceItemDef,
      },
      properties: {
        insideOutsideUrbanPlan: ref("singleChoiceItem"),
        zoningDesignation: ref("leafItem"),
        buildingCoverageRatio: ref("leafItem"),
        floorAreaRatio: ref("leafItem"),
        buildingProhibition: ref("leafItem"),
        buildingRestriction: ref("leafItem"),
      },
      required: [
        "insideOutsideUrbanPlan",
        "zoningDesignation",
        "buildingCoverageRatio",
        "floorAreaRatio",
        "buildingProhibition",
        "buildingRestriction",
      ],
      additionalProperties: false,
    },
  };
}

export { buildLandUseRegulationTool };
