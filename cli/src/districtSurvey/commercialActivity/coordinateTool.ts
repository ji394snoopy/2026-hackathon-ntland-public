import type { ToolDefinition } from "../../shared/tool.js";
import {
  ref,
  COORDINATE_DESCRIPTION,
  MATCHES_REFERENCE_PROPERTY,
} from "../shared/coordinateSchemaHelpers.js";

const facilityWithQuantityCoordinatesDef = {
  type: "object",
  description:
    `On-page draw positions for one 名稱：+數量+checkbox facility item's row (its 名稱/數量 ` +
    `answers sit on one line, its 本區段內/外+distance checkboxes on the line below), no ` +
    `leading existence checkbox. ${COORDINATE_DESCRIPTION}`,
  properties: {
    nameX: {
      type: "number",
      description: "X (left edge) of the facility-name answer text, right after 名稱：.",
    },
    nameY: { type: "number", description: "Y (baseline) of the 名稱/數量 answer line." },
    quantityX: {
      type: "number",
      description: "X (left edge) of the quantity answer text, right after 數量:, same line as 名稱.",
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
        "Y (baseline) of the checkbox/distance line — also the Y for the 本區段內/外 circle marks.",
    },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: [
    "nameX",
    "nameY",
    "quantityX",
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

function buildCommercialActivityCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_commercial_activity_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates for " +
      "every 工商活動 (commercial activity) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        facilityWithQuantityCoordinates: facilityWithQuantityCoordinatesDef,
        textFieldCoordinates: textFieldCoordinatesDef,
      },
      properties: {
        departmentStore: ref("facilityWithQuantityCoordinates"),
        financialInstitution: ref("facilityWithQuantityCoordinates"),
        entertainmentFacility: ref("facilityWithQuantityCoordinates"),
        exhibitionCenterOrHotel: ref("facilityWithQuantityCoordinates"),
        customerTraffic: ref("textFieldCoordinates"),
        storeContiguity: ref("textFieldCoordinates"),
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

export { buildCommercialActivityCoordinatesTool };
