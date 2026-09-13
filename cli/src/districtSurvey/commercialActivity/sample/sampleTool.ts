import type { ToolDefinition } from "../../../shared/tool.js";
import { ref } from "../../shared/jsonSchemaRef.js";

const facilityWithQuantityValueDef = {
  type: "object",
  description:
    "A 名稱：+數量+checkbox facility item's printed answer: the 名稱:X 數量:N " +
    "○本區段內/●本區段外(距 N M) pattern, with no leading existence checkbox of its own. Unlike " +
    "facilityValue elsewhere in this form, this shape also carries a printed 數量 (quantity) " +
    "count. These fields print no 無... placeholder — 名稱/數量 are either filled in together or " +
    "left entirely blank.",
  properties: {
    type: {
      type: "string",
      enum: [
        "departmentStore",
        "financialInstitution",
        "entertainmentFacility",
        "exhibitionCenterOrHotel",
      ],
      description: "Which field this value belongs to.",
    },
    raw: {
      type: "string",
      description:
        "The exact printed cell text, verbatim (the 名稱/數量 line and the checkbox line).",
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
    quantity: {
      type: "number",
      description: "Only when isExist is true and a quantity number is actually printed after 數量:.",
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

const facilityWithQuantityItemDef = {
  type: "object",
  description: "One 名稱：+數量+checkbox facility 工商活動 item.",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese item label exactly as printed (leading numeric code stripped).",
    },
    value: ref("facilityWithQuantityValue"),
  },
  required: ["raw", "value"],
  additionalProperties: false,
};

const leafItemDef = {
  type: "object",
  description: "One plain (non-facility) 工商活動 item.",
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

function buildCommercialActivityTool(): ToolDefinition {
  return {
    name: "extract_commercial_activity_items",
    description:
      "Extract every item under 工商活動 (commercial activity), one main-category block of the " +
      "表1 地價區段勘查表 (district survey table): four 名稱：+數量+checkbox facility items " +
      "(百貨公司, 金融機構, 娛樂設施, 大型展示中心或觀光飯店) plus two bare-text items " +
      "(顧客之通行量, 店鋪之毗連狀態).",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        facilityWithQuantityValue: facilityWithQuantityValueDef,
        leafValue: leafValueDef,
        facilityWithQuantityItem: facilityWithQuantityItemDef,
        leafItem: leafItemDef,
      },
      properties: {
        departmentStore: ref("facilityWithQuantityItem"),
        financialInstitution: ref("facilityWithQuantityItem"),
        entertainmentFacility: ref("facilityWithQuantityItem"),
        exhibitionCenterOrHotel: ref("facilityWithQuantityItem"),
        customerTraffic: ref("leafItem"),
        storeContiguity: ref("leafItem"),
      },
      required: [
        "departmentStore",
        "financialInstitution",
        "entertainmentFacility",
        "exhibitionCenterOrHotel",
        "customerTraffic",
        "storeContiguity",
      ],
      additionalProperties: false,
    },
  };
}

export { buildCommercialActivityTool };
