import type { ToolDefinition } from "../../shared/tool.js";
import {
  ref,
  COORDINATE_DESCRIPTION,
  MATCHES_REFERENCE_PROPERTY,
} from "../shared/coordinateSchemaHelpers.js";

const checkedFacilityCoordinatesDef = {
  type: "object",
  description:
    "On-page draw positions for one 環境污染 item's row: a leading existence checkbox (○/●) " +
    "before the item's fixed printed label, plus a separate 名稱：answer, plus " +
    `○本區段內/●本區段外(距 N M). ${COORDINATE_DESCRIPTION}`,
  properties: {
    checkX: {
      type: "number",
      description: "X of the leading existence checkbox (○) before the item's fixed printed label.",
    },
    checkY: {
      type: "number",
      description: "Y (baseline) of this row's leading existence checkbox.",
    },
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
        "Y (baseline) of the checkbox/distance line — also the Y for the 本區段內/外 circle " +
        "marks. May differ from checkY/nameY when the printed label wraps to a second line.",
    },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: [
    "checkX",
    "checkY",
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

function buildEnvironmentalPollutionCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_environmental_pollution_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates for " +
      "every 環境污染 (environmental pollution) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        checkedFacilityCoordinates: checkedFacilityCoordinatesDef,
      },
      properties: {
        environmentalPollution: {
          type: "array",
          description:
            "The five 環境污染 items' coordinates, in printed order (水污染, 噪音污染, 廢氣污染, " +
            "廢棄物污染, 其他污染) — always exactly 5, matching the content-extraction tool's " +
            "environmentalPollution.items order positionally.",
          items: ref("checkedFacilityCoordinates"),
        },
      },
      required: ["environmentalPollution"],
      additionalProperties: false,
    },
  };
}

export { buildEnvironmentalPollutionCoordinatesTool };
