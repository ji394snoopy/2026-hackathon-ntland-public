import type { ToolDefinition } from "../../../shared/tool.js";
import { ref } from "../../shared/jsonSchemaRef.js";

const checkboxItemDef = {
  type: "object",
  description:
    "One fixed-label multi-select checkbox item within a 土地改良 group (a □ before its fixed " +
    "printed label). Any number of a group's items can be checked at once — unlike the " +
    "single-choice/existence-check patterns used elsewhere in this form.",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese item label exactly as printed.",
    },
    checked: {
      type: "boolean",
      description: "true if this item's checkbox (□) is marked, false if left unmarked.",
    },
  },
  required: ["raw", "checked"],
  additionalProperties: false,
};

const otherFieldDef = {
  type: "object",
  description:
    "The trailing 其他＿＿＿＿＿＿ checkbox+free-text option at the end of a 土地改良 group.",
  properties: {
    checked: {
      type: "boolean",
      description: "true if the 其他 checkbox (□) is marked, false if left unmarked.",
    },
    text: {
      type: "string",
      description:
        "The handwritten text filling the blank after 其他, if any; empty string if the blank " +
        "is empty or the checkbox is unmarked.",
    },
  },
  required: ["checked", "text"],
  additionalProperties: false,
};

const landImprovementGroupDef = {
  type: "object",
  description: "One 土地改良 group's full set of fixed-label checkboxes plus its 其他 option.",
  properties: {
    raw: {
      type: "string",
      description: "The Chinese group label exactly as printed (建築基地改良 or 農地改良).",
    },
    items: {
      type: "array",
      description:
        "The group's fixed-label checkboxes, in fixed printed order, excluding 其他.",
      items: ref("checkboxItem"),
    },
    other: ref("otherField"),
  },
  required: ["raw", "items", "other"],
  additionalProperties: false,
};

function buildLandImprovementTool(): ToolDefinition {
  return {
    name: "extract_land_improvement_items",
    description:
      "Extract every item under 土地改良 (land improvement), one main-category block of the " +
      "表1 地價區段勘查表 (district survey table): two multi-select checkbox groups, " +
      "建築基地改良 and 農地改良.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        checkboxItem: checkboxItemDef,
        otherField: otherFieldDef,
        landImprovementGroup: landImprovementGroupDef,
      },
      properties: {
        buildingSiteImprovement: ref("landImprovementGroup"),
        farmlandImprovement: ref("landImprovementGroup"),
      },
      required: ["buildingSiteImprovement", "farmlandImprovement"],
      additionalProperties: false,
    },
  };
}

export { buildLandImprovementTool };
