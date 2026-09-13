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

function buildNaturalConditionsCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_natural_conditions_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates for " +
      "every 自然條件 (natural conditions) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        textFieldCoordinates: textFieldCoordinatesDef,
      },
      properties: {
        sunlight: ref("textFieldCoordinates"),
        view: ref("textFieldCoordinates"),
        slope: ref("textFieldCoordinates"),
        drainageQuality: ref("textFieldCoordinates"),
        terrain: ref("textFieldCoordinates"),
        windCondition: ref("textFieldCoordinates"),
        soilQuality: ref("textFieldCoordinates"),
      },
      required: [
        "sunlight",
        "view",
        "slope",
        "drainageQuality",
        "terrain",
        "windCondition",
        "soilQuality",
      ],
      additionalProperties: false,
    },
  };
}

export { buildNaturalConditionsCoordinatesTool };
