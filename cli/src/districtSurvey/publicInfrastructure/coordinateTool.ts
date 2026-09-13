import type { ToolDefinition } from "../../shared/tool.js";
import {
  ref,
  COORDINATE_DESCRIPTION,
  MATCHES_REFERENCE_PROPERTY,
} from "../shared/coordinateSchemaHelpers.js";

const facilityCoordinatesDef = {
  type: "object",
  description:
    `On-page draw positions for one 名稱：+checkbox facility item's row (its 名稱 answer sits ` +
    `on one line, its 本區段內/外+distance checkboxes on the line below). ${COORDINATE_DESCRIPTION}`,
  properties: {
    nameX: {
      type: "number",
      description: "X (left edge) of the facility-name answer text, right after 名稱：.",
    },
    nameY: { type: "number", description: "Y (baseline) of the facility-name answer text." },
    inSectionX: { type: "number", description: "X of the 本區段內 circle mark." },
    outSectionX: { type: "number", description: "X of the 本區段外 circle mark." },
    distanceEndX: {
      type: "number",
      description: "X where the right-aligned distance value's text ends.",
    },
    distanceY: {
      type: "number",
      description:
        "Y (baseline) of the checkbox/distance line — also the Y for the 本區段內/外 circle marks.",
    },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: [
    "nameX",
    "nameY",
    "inSectionX",
    "outSectionX",
    "distanceEndX",
    "distanceY",
    "matchesReference",
  ],
  additionalProperties: false,
};

const textFieldCoordinatesDef = {
  type: "object",
  description: `On-page draw position for one bare-text item's answer. ${COORDINATE_DESCRIPTION}`,
  properties: {
    x: { type: "number", description: "X (left edge) of the answer text." },
    y: { type: "number", description: "Y (baseline) of the answer text." },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: ["x", "y", "matchesReference"],
  additionalProperties: false,
};

const existenceCheckCoordinatesDef = {
  type: "object",
  description:
    "On-page draw positions for one fixed-label existence-checkbox item's row (a bare ○ before " +
    `the item's fixed printed label, plus ○本區段內/○本區段外(距 M)). ${COORDINATE_DESCRIPTION}`,
  properties: {
    checkX: {
      type: "number",
      description: "X of the existence checkbox (○) before the item's fixed printed label.",
    },
    checkY: {
      type: "number",
      description:
        "Y (baseline) of this row's existence checkbox — also the Y for the 本區段內/外 circle marks.",
    },
    nameGapEndX: {
      type: "number",
      description:
        "X where the fixed printed label / facility-name text region ends — the right edge of " +
        "the area that gets whited out and redrawn when a real facility name overrides the " +
        "fixed label.",
    },
    inSectionX: { type: "number", description: "X of the 本區段內 circle mark." },
    outSectionX: { type: "number", description: "X of the 本區段外 circle mark." },
    distanceEndX: {
      type: "number",
      description: "X where the right-aligned distance value's text ends.",
    },
    distanceY: {
      type: "number",
      description:
        "Y (baseline) of the distance value — may sit on a wrapped line below checkY for the " +
        "two items (傳統市場, 里鄰公園) whose row prints no label text at all.",
    },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: [
    "checkX",
    "checkY",
    "nameGapEndX",
    "inSectionX",
    "outSectionX",
    "distanceEndX",
    "distanceY",
    "matchesReference",
  ],
  additionalProperties: false,
};

function buildPublicInfrastructureCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_public_infrastructure_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates for " +
      "every 公共建設 (public infrastructure) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        facilityCoordinates: facilityCoordinatesDef,
        existenceCheckCoordinates: existenceCheckCoordinatesDef,
      },
      properties: {
        touristRecreationFacility: ref("facilityCoordinates"),
        parkingArea: ref("facilityCoordinates"),
        proximityToServiceFacility: ref("facilityCoordinates"),
        electricPowerResources: textFieldCoordinatesDef,
        industrialWaterSupply: textFieldCoordinatesDef,
        wastewaterTreatmentFacility: ref("facilityCoordinates"),
        school: {
          type: "array",
          description:
            "The four 學校 sub-items' coordinates, in printed order (國小, 國中, 高中, 大專院校) " +
            "— always exactly 4, matching the content-extraction tool's school.items order " +
            "positionally.",
          items: ref("existenceCheckCoordinates"),
        },
        market: {
          type: "array",
          description:
            "The three 市場 sub-items' coordinates, in printed order (傳統市場, 超級市場, " +
            "超大型購物中心) — always exactly 3, matching the content-extraction tool's " +
            "market.items order positionally. 傳統市場's own row prints no label text.",
          items: ref("existenceCheckCoordinates"),
        },
        parkPlazaPedestrianZone: {
          type: "array",
          description:
            "The three 公園廣場徒步區 sub-items' coordinates, in printed order (里鄰公園, " +
            "一般公園, 廣場.徒步區) — always exactly 3, matching the content-extraction tool's " +
            "parkPlazaPedestrianZone.items order positionally. 里鄰公園's own row prints no " +
            "label text.",
          items: ref("existenceCheckCoordinates"),
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
      additionalProperties: false,
    },
  };
}

export { buildPublicInfrastructureCoordinatesTool };
