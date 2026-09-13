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
        '"text" for a bare descriptive sentence/label with no separate number, e.g. 已完全開發, ' +
        'or an empty string if nothing is printed. "number" for a bare number with a trailing ' +
        'unit and no place-name/label attached, e.g. 12 M. "measurement" for a place/street ' +
        "name plus a number and unit, e.g. 中山路 18 M.",
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
      description:
        'Only for type=measurement. The place-name portion of the cell, e.g. "中山路".',
    },
    value: {
      type: "number",
      description:
        "Only for type=number or type=measurement. The parsed numeric portion of the cell.",
    },
    unit: {
      type: "string",
      description:
        "Only for type=number or type=measurement. The trailing unit text (e.g. M), if present.",
    },
  },
  required: ["type", "raw"],
  additionalProperties: false,
};

const stationFacilityValueDef = {
  type: "object",
  description:
    "A 大型車站 sub-item's or 交流道's printed answer: the repeated 名稱:X ○本區段內/●本區段外" +
    "(距 N M) checkbox pattern.",
  properties: {
    type: {
      type: "string",
      enum: ["majorStationFacility", "interchangeFacility"],
      description:
        "majorStationFacility for one of 大型車站's four sub-items (高鐵站/火車站/客運站/捷運站); " +
        "interchangeFacility for 交流道.",
    },
    raw: {
      type: "string",
      description: "The exact printed cell text, verbatim.",
    },
    name: {
      type: "string",
      description:
        "The printed 名稱 text: the actual facility name when one is filled in (e.g. " +
        '國光客運金山站), or the printed placeholder text itself (e.g. "無高鐵站") when nothing ' +
        "is filled in.",
    },
    isExist: {
      type: "boolean",
      description:
        "true when an actual facility name is filled in, false when the 無... placeholder is " +
        "what's printed/circled.",
    },
    inSection: {
      type: "boolean",
      description:
        "Only when 本區段內 or 本區段外 is actually marked (●); leave unset if neither is marked " +
        "(the usual case when isExist is false). true for 本區段內, false for 本區段外.",
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

const busStopValueDef = {
  type: "object",
  description: "站牌's printed answer: the 名稱:X + 密集程度 checkbox pattern.",
  properties: {
    type: {
      type: "string",
      enum: ["busStopFacility"],
    },
    raw: {
      type: "string",
      description: "The exact printed cell text, verbatim (both the 名稱 and 密集程度 lines).",
    },
    name: {
      type: "string",
      description:
        "The printed 名稱 text: the actual stop name when one is filled in, or the printed " +
        "placeholder text itself when nothing is filled in.",
    },
    isExist: {
      type: "boolean",
      description:
        "true when an actual stop name is filled in, false when a 無... placeholder is what's " +
        "printed/circled.",
    },
    densityLevel: {
      type: "number",
      enum: [0, 1, 2],
      description:
        "The checked 密集程度 option's 0-based position in the printed order 非常密集, 密集, " +
        "不密集 (0=非常密集, 1=密集, 2=不密集).",
    },
    inSection: {
      type: "boolean",
      description:
        "Only when 本區段內 or 本區段外 is actually marked (●); leave unset if neither is marked. " +
        "true for 本區段內, false for 本區段外.",
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
  required: ["type", "raw", "name", "isExist", "densityLevel"],
  additionalProperties: false,
};

const leafItemDef = {
  type: "object",
  description: "One plain (non-facility) 交通運輸 item.",
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

const stationFacilityItemDef = {
  type: "object",
  description: "One 大型車站 sub-item, or the 交流道 item.",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese item label exactly as printed (leading numeric code stripped).",
    },
    value: ref("stationFacilityValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

const busStopItemDef = {
  type: "object",
  description: "The 站牌 item.",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese item label exactly as printed (leading numeric code stripped).",
    },
    value: ref("busStopValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

const majorStationGroupDef = {
  type: "object",
  description:
    "The 大型車站 group row, bundling its four separate 有/無 + 本區段內/外 checks (高鐵站, 火車站, " +
    "客運站, 捷運站) into one printed row.",
  properties: {
    raw: {
      type: "string",
      description: 'The Chinese group label exactly as printed, i.e. "大型車站".',
    },
    items: {
      type: "array",
      description:
        "The four station sub-items (高鐵站, 火車站, 客運站, 捷運站), in printed order.",
      items: ref("stationFacilityItem"),
    },
  },
  required: ["raw", "items"],
  additionalProperties: false,
};

function buildTrafficAndTransportTool(): ToolDefinition {
  return {
    name: "extract_traffic_and_transport_items",
    description:
      "Extract every item under 交通運輸 (traffic and transport), one main-category block of " +
      "the 表1 地價區段勘查表 (district survey table).",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        leafValue: leafValueDef,
        stationFacilityValue: stationFacilityValueDef,
        busStopValue: busStopValueDef,
        leafItem: leafItemDef,
        stationFacilityItem: stationFacilityItemDef,
        busStopItem: busStopItemDef,
      },
      properties: {
        mainRoad: ref("leafItem"),
        averageRoadWidthInSection: ref("leafItem"),
        majorStation: majorStationGroupDef,
        busStop: ref("busStopItem"),
        interchange: ref("stationFacilityItem"),
        proximityToSettlement: ref("leafItem"),
        proximityToDistributionCenter: ref("leafItem"),
        proximityToMarket: ref("leafItem"),
        roadConstructionLevel: ref("leafItem"),
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
      additionalProperties: false,
    },
  };
}

export { buildTrafficAndTransportTool };
