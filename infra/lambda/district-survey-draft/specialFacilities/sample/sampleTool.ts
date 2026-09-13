import type { ToolDefinition } from "../../../shared/tool.js";
import { ref } from "../../shared/jsonSchemaRef.js";

const facilityValueDef = {
  type: "object",
  description:
    "A 名稱：+checkbox facility item's printed answer: the 名稱:X ○本區段內/●本區段外(距 N M) " +
    "pattern, with no leading existence checkbox of its own. Unlike checkedFacilityValue items " +
    "elsewhere in this category, these fields print no 無... placeholder — the 名稱 field is " +
    "either filled in or left entirely blank.",
  properties: {
    type: {
      type: "string",
      enum: ["utilityGasFacility"],
      description: "Which field this value belongs to.",
    },
    raw: {
      type: "string",
      description: "The exact printed cell text, verbatim (both the 名稱 and checkbox lines).",
    },
    name: {
      type: "string",
      description:
        "The printed 名稱 text, if anything is filled in; empty string if the name field is " +
        "blank.",
    },
    isExist: {
      type: "boolean",
      description: "true when a name is actually filled in, false when the name field is blank.",
    },
    inSection: {
      type: "boolean",
      description:
        "Only when 本區段內 or 本區段外 is actually marked (●); leave unset if neither is " +
        "marked. true for 本區段內, false for 本區段外.",
    },
    distanceValue: {
      type: "number",
      description: "Only when a distance number is actually printed (距 N M).",
    },
    distanceUnit: {
      type: "string",
      description: "Only with distanceValue set. The distance unit, e.g. M.",
    },
  },
  required: ["type", "raw", "name", "isExist"],
  additionalProperties: false,
};

const checkedFacilityValueDef = {
  type: "object",
  description:
    "One 殯葬/廢棄物處理 sub-item's printed answer: a leading checkbox (○/●) before the item's " +
    "own fixed printed label, plus a separate 名稱：field, plus ○本區段內/●本區段外(距 N M). " +
    "Unlike facilityValue, isExist is driven by the leading checkbox, not by whether 名稱 is " +
    "filled in — but per how this form is actually filled out, the two always agree in practice: " +
    "名稱 is only ever filled in (and 本區段內/外/距離 only ever marked) when the leading checkbox " +
    "is marked.",
  properties: {
    type: {
      type: "string",
      enum: ["funeralFacility", "wasteFacility"],
      description: "Which group this sub-item belongs to.",
    },
    raw: {
      type: "string",
      description: "The exact printed cell text, verbatim, including the leading checkbox.",
    },
    isExist: {
      type: "boolean",
      description:
        "true when the leading checkbox before this sub-item's own fixed label is marked (●), " +
        "false when it is not.",
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

const facilityItemDef = {
  type: "object",
  description: "One 名稱：+checkbox facility 特殊設施 item (電業氣體燃料's sub-items).",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese item label exactly as printed (leading numeric code stripped).",
    },
    value: ref("facilityValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

const checkedFacilityItemDef = {
  type: "object",
  description:
    "One checkbox+名稱 特殊設施 sub-item under 殯葬/廢棄物處理.",
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

function buildSpecialFacilitiesTool(): ToolDefinition {
  return {
    name: "extract_special_facilities_items",
    description:
      "Extract every item under 特殊設施 (special facilities), one main-category block of the " +
      "表1 地價區段勘查表 (district survey table), spanning three group rows: 電業氣體燃料, 殯葬, " +
      "廢棄物處理.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        facilityValue: facilityValueDef,
        checkedFacilityValue: checkedFacilityValueDef,
        facilityItem: facilityItemDef,
        checkedFacilityItem: checkedFacilityItemDef,
      },
      properties: {
        utilityGasFacility: groupItemDef(
          "The 電業氣體燃料 group row, bundling 變電所或高壓鐵塔/瓦斯槽或儲油槽 into one printed " +
            "block.",
          "facilityItem",
        ),
        funeralFacility: groupItemDef(
          "The 殯葬 group row, bundling 墓地/殯儀館/火葬場/納骨塔 into one printed block.",
          "checkedFacilityItem",
        ),
        wasteFacility: groupItemDef(
          "The 廢棄物處理 group row, bundling 污水處理場/垃圾場或掩埋場/焚化爐 into one printed " +
            "block.",
          "checkedFacilityItem",
        ),
      },
      required: ["utilityGasFacility", "funeralFacility", "wasteFacility"],
      additionalProperties: false,
    },
  };
}

export { buildSpecialFacilitiesTool };
