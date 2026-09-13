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
        '"text" for a bare descriptive sentence/label with no separate number, or an empty ' +
        'string if nothing is printed. "number" for a bare number with a trailing unit and no ' +
        'place-name/label attached. "measurement" for a place/street name plus a number and ' +
        "unit.",
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
        "Only for type=number or type=measurement. The trailing unit text, if present.",
    },
  },
  required: ["type", "raw"],
  additionalProperties: false,
};

const facilityValueDef = {
  type: "object",
  description:
    "A 名稱：+checkbox facility item's printed answer: the 名稱:X ○本區段內/●本區段外(距 N M) " +
    "pattern. Unlike interchange-style items elsewhere in this form, these fields print no " +
    "無... placeholder — the 名稱 field is either filled in or left entirely blank.",
  properties: {
    type: {
      type: "string",
      enum: [
        "touristRecreationFacility",
        "parkingAreaFacility",
        "serviceFacilityProximityFacility",
        "wastewaterTreatmentFacility",
      ],
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

const existenceCheckValueDef = {
  type: "object",
  description:
    "One fixed-label existence-checkbox item's printed answer: a checkbox before either the " +
    "item's fixed printed label or, when actually filled in, a real facility name written in " +
    "its place, plus ○本區段內/●本區段外(距 N M).",
  properties: {
    type: {
      type: "string",
      enum: ["schoolFacility", "marketFacility", "parkFacility"],
      description: "Which group this sub-item belongs to.",
    },
    raw: {
      type: "string",
      description: "The exact printed cell text, verbatim.",
    },
    name: {
      type: "string",
      description:
        "The printed name text: a real facility name when one is written in place of the " +
        "fixed label (e.g. an actual supermarket name replacing 超級市場), or the item's own " +
        "fixed printed label itself (e.g. 超級市場) when nothing more specific is filled in.",
    },
    isExist: {
      type: "boolean",
      description:
        "true when this item's own checkbox (before its fixed label or a filled-in name) is " +
        "marked (●), false when it is not.",
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

const leafItemDef = {
  type: "object",
  description: "One plain (non-facility) 公共建設 item.",
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

const facilityItemDef = {
  type: "object",
  description: "One 名稱：+checkbox facility 公共建設 item.",
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

const existenceCheckItemDef = {
  type: "object",
  description: "One fixed-label existence-checkbox sub-item under 學校/市場/公園廣場徒步區.",
  properties: {
    raw: {
      type: "string",
      description:
        "The item's fixed Chinese label — even for 傳統市場 and 里鄰公園, whose cells print " +
        "no label text at all; use the known fixed label anyway.",
    },
    value: ref("existenceCheckValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

function groupItemDef(description: string) {
  return {
    type: "object",
    description,
    properties: {
      raw: {
        type: "string",
        description: 'The Chinese group label exactly as printed.',
      },
      items: {
        type: "array",
        description: "The sub-items, in fixed printed order.",
        items: ref("existenceCheckItem"),
      },
    },
    required: ["raw", "items"],
    additionalProperties: false,
  };
}

function buildPublicInfrastructureTool(): ToolDefinition {
  return {
    name: "extract_public_infrastructure_items",
    description:
      "Extract every item under 公共建設 (public infrastructure), one main-category block of " +
      "the 表1 地價區段勘查表 (district survey table), spanning two separate blocks on the page.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        leafValue: leafValueDef,
        facilityValue: facilityValueDef,
        existenceCheckValue: existenceCheckValueDef,
        leafItem: leafItemDef,
        facilityItem: facilityItemDef,
        existenceCheckItem: existenceCheckItemDef,
      },
      properties: {
        touristRecreationFacility: ref("facilityItem"),
        parkingArea: ref("facilityItem"),
        proximityToServiceFacility: ref("facilityItem"),
        electricPowerResources: ref("leafItem"),
        industrialWaterSupply: ref("leafItem"),
        wastewaterTreatmentFacility: ref("facilityItem"),
        school: groupItemDef(
          "The 學校 group row, bundling 國小/國中/高中/大專院校 into one printed block.",
        ),
        market: groupItemDef(
          "The 市場 group row, bundling 傳統市場/超級市場/超大型購物中心 into one printed block.",
        ),
        parkPlazaPedestrianZone: groupItemDef(
          "The 公園廣場徒步區 group row, bundling 里鄰公園/一般公園/廣場.徒步區 into one " +
            "printed block.",
        ),
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
      additionalProperties: false,
    },
  };
}

export { buildPublicInfrastructureTool };
