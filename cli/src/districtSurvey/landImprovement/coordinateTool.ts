import type { ToolDefinition } from "../../shared/tool.js";
import {
  ref,
  COORDINATE_DESCRIPTION,
  MATCHES_REFERENCE_PROPERTY,
} from "../shared/coordinateSchemaHelpers.js";

const checkboxCoordinatesDef = {
  type: "object",
  description:
    `On-page draw position for one plain fixed-label □ checkbox's mark. ${COORDINATE_DESCRIPTION}`,
  properties: {
    checkX: { type: "number", description: "X (left edge) of the □ checkbox mark." },
    checkY: { type: "number", description: "Y (baseline) of the □ checkbox mark." },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: ["checkX", "checkY", "matchesReference"],
  additionalProperties: false,
};

const otherCoordinatesDef = {
  type: "object",
  description:
    "On-page draw positions for a group's trailing 其他＿＿＿＿＿＿ checkbox+free-text option. " +
    "The checkbox and the free-text blank do not always sit on the same line — a group's blank " +
    `can wrap onto a line below its checkbox. ${COORDINATE_DESCRIPTION}`,
  properties: {
    checkX: { type: "number", description: "X (left edge) of the 其他 □ checkbox mark." },
    checkY: { type: "number", description: "Y (baseline) of the 其他 □ checkbox mark." },
    textX: {
      type: "number",
      description:
        "X (left edge) where handwritten free text should start — on whichever line the " +
        "blank actually has room, which may not be checkY's line.",
    },
    textY: { type: "number", description: "Y (baseline) of the free-text blank's own line." },
    textEndX: {
      type: "number",
      description: "X where the free-text blank ends — the whiteout/draw region's right edge.",
    },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: ["checkX", "checkY", "textX", "textY", "textEndX", "matchesReference"],
  additionalProperties: false,
};

// buildingSiteImprovement has exactly 6 fixed checkboxes and farmlandImprovement exactly 9 (see
// coordinatePrompt.ts's ORDER_RULE), but Bedrock's strict-mode tool schema rejects `minItems`/
// `maxItems` values other than 0 or 1 ("For 'array' type, minItems values other than 0 or 1 are
// not supported") — same constrained-decoding ceiling this repo's other schemas already hit (see
// CLAUDE.md). The fixed count can't be enforced at the schema level; fillPdf.ts's positional zip
// guards against a short response at fill time instead (warn-and-skip on a missing row).
const landImprovementGroupCoordinatesDef = {
  type: "object",
  description:
    "On-page draw positions for one 土地改良 group's fixed-label checkboxes plus its trailing " +
    "其他 option.",
  properties: {
    items: {
      type: "array",
      description: "The group's fixed-label checkbox positions, in fixed printed order.",
      items: ref("checkboxCoordinates"),
    },
    other: ref("otherCoordinates"),
  },
  required: ["items", "other"],
  additionalProperties: false,
};

function buildLandImprovementCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_land_improvement_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates for " +
      "every 土地改良 (land improvement) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        checkboxCoordinates: checkboxCoordinatesDef,
        otherCoordinates: otherCoordinatesDef,
        landImprovementGroupCoordinates: landImprovementGroupCoordinatesDef,
      },
      properties: {
        buildingSiteImprovement: ref("landImprovementGroupCoordinates"),
        farmlandImprovement: ref("landImprovementGroupCoordinates"),
      },
      required: ["buildingSiteImprovement", "farmlandImprovement"],
      additionalProperties: false,
    },
  };
}

export { buildLandImprovementCoordinatesTool };
