import type { ToolDefinition } from "../../shared/tool.js";
import {
  ref,
  COORDINATE_DESCRIPTION,
  MATCHES_REFERENCE_PROPERTY,
} from "../shared/coordinateSchemaHelpers.js";

const facilityCoordinatesDef = {
  type: "object",
  description:
    `On-page draw positions for one 名稱：+checkbox facility item's row, no leading existence ` +
    `checkbox. ${COORDINATE_DESCRIPTION}`,
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

const checkedFacilityCoordinatesDef = {
  type: "object",
  description:
    "On-page draw positions for one 殯葬/廢棄物處理 sub-item's row: a leading existence " +
    "checkbox (○/●) before the item's fixed printed label, plus a separate 名稱：answer, plus " +
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

function buildSpecialFacilitiesCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_special_facilities_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates for " +
      "every 特殊設施 (special facilities) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        facilityCoordinates: facilityCoordinatesDef,
        checkedFacilityCoordinates: checkedFacilityCoordinatesDef,
      },
      properties: {
        utilityGasFacility: {
          type: "array",
          description:
            "The two 電業氣體燃料 sub-items' coordinates, in printed order (變電所或高壓鐵塔, " +
            "瓦斯槽或儲油槽) — always exactly 2, matching the content-extraction tool's " +
            "utilityGasFacility.items order positionally.",
          items: ref("facilityCoordinates"),
        },
        funeralFacility: {
          type: "array",
          description:
            "The four 殯葬 sub-items' coordinates, in printed order (墓地, 殯儀館, 火葬場, " +
            "納骨塔) — always exactly 4, matching the content-extraction tool's " +
            "funeralFacility.items order positionally.",
          items: ref("checkedFacilityCoordinates"),
        },
        wasteFacility: {
          type: "array",
          description:
            "The three 廢棄物處理 sub-items' coordinates, in printed order (污水處理場, " +
            "垃圾場或掩埋場, 焚化爐) — always exactly 3, matching the content-extraction " +
            "tool's wasteFacility.items order positionally. 垃圾場或掩埋場's own printed label " +
            "wraps to a second line.",
          items: ref("checkedFacilityCoordinates"),
        },
      },
      required: ["utilityGasFacility", "funeralFacility", "wasteFacility"],
      additionalProperties: false,
    },
  };
}

export { buildSpecialFacilitiesCoordinatesTool };
