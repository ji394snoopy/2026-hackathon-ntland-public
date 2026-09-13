import type { ToolDefinition } from "../../../shared/tool.js";
import { ref } from "../../shared/jsonSchemaRef.js";

const checkedFacilityValueDef = {
  type: "object",
  description:
    "One 環境污染 item's printed answer: a leading checkbox (○/●) before the item's own fixed " +
    "printed label, plus a separate 名稱：field, plus ○本區段內/●本區段外(距 N M). isExist is " +
    "driven by the leading checkbox, not by whether 名稱 is filled in — but per how this form is " +
    "actually filled out, the two always agree in practice: 名稱 is only ever filled in (and " +
    "本區段內/外/距離 only ever marked) when the leading checkbox is marked.",
  properties: {
    type: {
      type: "string",
      enum: [
        "waterPollution",
        "noisePollution",
        "airPollution",
        "wastePollution",
        "otherPollution",
      ],
      description: "Which item this value belongs to.",
    },
    raw: {
      type: "string",
      description: "The exact printed cell text, verbatim, including the leading checkbox.",
    },
    isExist: {
      type: "boolean",
      description:
        "true when the leading checkbox before this item's own fixed label is marked (●), false " +
        "when it is not.",
    },
    name: {
      type: "string",
      description:
        "The printed 名稱：text, only when isExist is true; empty string when isExist is false " +
        "— never fill in a name for an unmarked row.",
    },
    inSection: {
      type: "boolean",
      description:
        "Only when isExist is true and 本區段內 or 本區段外 is actually marked (●); leave unset " +
        "when isExist is false. true for 本區段內, false for 本區段外.",
    },
    distanceValue: {
      type: "number",
      description:
        "Only when isExist is true and a distance number is actually printed (距 N M).",
    },
    distanceUnit: {
      type: "string",
      description: "Only with distanceValue set. The distance unit, e.g. M.",
    },
  },
  required: ["type", "raw", "isExist", "name"],
  additionalProperties: false,
};

const checkedFacilityItemDef = {
  type: "object",
  description: "One checkbox+名稱 環境污染 item.",
  properties: {
    raw: {
      type: "string",
      description: "The item's fixed Chinese label, exactly as printed.",
    },
    value: ref("checkedFacilityValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

function groupItemDef(description: string, itemRef: string) {
  return {
    type: "object",
    description,
    properties: {
      raw: {
        type: "string",
        description: "The Chinese group label exactly as printed.",
      },
      items: {
        type: "array",
        description: "The sub-items, in fixed printed order.",
        items: ref(itemRef),
      },
    },
    required: ["raw", "items"],
    additionalProperties: false,
  };
}

function buildEnvironmentalPollutionTool(): ToolDefinition {
  return {
    name: "extract_environmental_pollution_items",
    description:
      "Extract every item under 環境污染 (environmental pollution), one main-category block of " +
      "the 表1 地價區段勘查表 (district survey table) — a single group of 5 fixed-order items: " +
      "水污染, 噪音污染, 廢氣污染, 廢棄物污染, 其他污染.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        checkedFacilityValue: checkedFacilityValueDef,
        checkedFacilityItem: checkedFacilityItemDef,
      },
      properties: {
        environmentalPollution: groupItemDef(
          "The 環境污染 group row, bundling 水污染/噪音污染/廢氣污染/廢棄物污染/其他污染 into " +
            "one printed block.",
          "checkedFacilityItem",
        ),
      },
      required: ["environmentalPollution"],
      additionalProperties: false,
    },
  };
}

export { buildEnvironmentalPollutionTool };
