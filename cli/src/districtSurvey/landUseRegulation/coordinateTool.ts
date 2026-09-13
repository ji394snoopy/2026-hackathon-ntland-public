import type { ToolDefinition } from "../../shared/tool.js";
import {
  ref,
  COORDINATE_DESCRIPTION,
  MATCHES_REFERENCE_PROPERTY,
} from "../shared/coordinateSchemaHelpers.js";

const textFieldCoordinatesDef = {
  type: "object",
  description: `On-page draw position for one bare-cell item's answer. ${COORDINATE_DESCRIPTION}`,
  properties: {
    x: { type: "number", description: "X (left edge) of the answer text." },
    y: { type: "number", description: "Y (baseline) of the answer text." },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: ["x", "y", "matchesReference"],
  additionalProperties: false,
};

function buildLandUseRegulationCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_land_use_regulation_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates for " +
      "every 土地使用管制 (land use regulation) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        textFieldCoordinates: textFieldCoordinatesDef,
      },
      properties: {
        insideOutsideUrbanPlan: ref("textFieldCoordinates"),
        zoningDesignation: ref("textFieldCoordinates"),
        buildingCoverageRatio: ref("textFieldCoordinates"),
        floorAreaRatio: ref("textFieldCoordinates"),
        buildingProhibition: ref("textFieldCoordinates"),
        buildingRestriction: ref("textFieldCoordinates"),
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

export { buildLandUseRegulationCoordinatesTool };
