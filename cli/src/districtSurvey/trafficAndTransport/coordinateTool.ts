import type { ToolDefinition } from "../../shared/tool.js";
import {
  ref,
  COORDINATE_DESCRIPTION,
  MATCHES_REFERENCE_PROPERTY,
} from "../shared/coordinateSchemaHelpers.js";

const stationRowCoordinatesDef = {
  type: "object",
  description: `On-page draw positions for one 大型車站 sub-item's row. ${COORDINATE_DESCRIPTION}`,
  properties: {
    circleX: { type: "number", description: "X of the ●/○ mark before the facility name." },
    circleY: { type: "number", description: "Y (baseline) of this row." },
    nameGapEndX: {
      type: "number",
      description: "X where the facility-name text region ends.",
    },
    inSectionX: { type: "number", description: "X of the 本區段內 circle mark." },
    outSectionX: { type: "number", description: "X of the 本區段外 circle mark." },
    distanceEndX: {
      type: "number",
      description: "X where the right-aligned distance value's text ends.",
    },
    distanceY: { type: "number", description: "Y (baseline) of the distance value." },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: [
    "circleX",
    "circleY",
    "nameGapEndX",
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

const mainRoadCoordinatesDef = {
  type: "object",
  description: `On-page draw positions for 主要道路. ${COORDINATE_DESCRIPTION}`,
  properties: {
    labelX: { type: "number", description: "X (left edge) of the road-name label." },
    labelY: { type: "number", description: "Y (baseline) of the road-name label." },
    valueEndX: {
      type: "number",
      description: "X where the right-aligned width value's text ends.",
    },
    valueY: { type: "number", description: "Y (baseline) of the width value." },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: ["labelX", "labelY", "valueEndX", "valueY", "matchesReference"],
  additionalProperties: false,
};

const averageRoadWidthCoordinatesDef = {
  type: "object",
  description: `On-page draw position for 區段內道路平均寬度's value. ${COORDINATE_DESCRIPTION}`,
  properties: {
    valueEndX: { type: "number", description: "X where the right-aligned value's text ends." },
    valueY: { type: "number", description: "Y (baseline) of the value." },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: ["valueEndX", "valueY", "matchesReference"],
  additionalProperties: false,
};

const interchangeCoordinatesDef = {
  type: "object",
  description: `On-page draw positions for 交流道's row. ${COORDINATE_DESCRIPTION}`,
  properties: {
    nameX: { type: "number", description: "X (left edge) of the facility-name text." },
    nameY: { type: "number", description: "Y (baseline) of this row." },
    inSectionX: { type: "number", description: "X of the 本區段內 circle mark." },
    outSectionX: { type: "number", description: "X of the 本區段外 circle mark." },
    distanceEndX: {
      type: "number",
      description: "X where the right-aligned distance value's text ends.",
    },
    distanceY: { type: "number", description: "Y (baseline) of the distance value." },
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

const busStopCoordinatesDef = {
  type: "object",
  description: `On-page draw positions for 站牌's row. ${COORDINATE_DESCRIPTION}`,
  properties: {
    nameX: { type: "number", description: "X (left edge) of the stop-name text." },
    nameY: { type: "number", description: "Y (baseline) of the stop-name text." },
    inSectionX: { type: "number", description: "X of the 本區段內 circle mark." },
    inSectionY: { type: "number", description: "Y of the 本區段內 circle mark." },
    outSectionX: { type: "number", description: "X of the 本區段外 circle mark." },
    outSectionY: { type: "number", description: "Y of the 本區段外 circle mark." },
    distanceEndX: {
      type: "number",
      description: "X where the right-aligned distance value's text ends.",
    },
    distanceY: { type: "number", description: "Y (baseline) of the distance value." },
    densityOptionX: {
      type: "array",
      description:
        "X of each 密集程度 option's circle mark, in printed order (非常密集, 密集, 不密集). " +
        "Always exactly 3 numbers, regardless of which one is circled.",
      items: { type: "number" },
    },
    densityOptionY: {
      type: "array",
      description:
        "Y of each 密集程度 option's circle mark, in printed order (非常密集, 密集, 不密集). " +
        "Always exactly 3 numbers, regardless of which one is circled.",
      items: { type: "number" },
    },
    ...MATCHES_REFERENCE_PROPERTY,
  },
  required: [
    "nameX",
    "nameY",
    "inSectionX",
    "inSectionY",
    "outSectionX",
    "outSectionY",
    "distanceEndX",
    "distanceY",
    "densityOptionX",
    "densityOptionY",
    "matchesReference",
  ],
  additionalProperties: false,
};

function buildTrafficAndTransportCoordinatesTool(): ToolDefinition {
  return {
    name: "calibrate_traffic_and_transport_coordinates",
    description:
      "Verify (and correct if the printed layout has shifted) the on-page draw coordinates " +
      "for every 交通運輸 (traffic and transport) item on this PDF page, against the reference " +
      "positions given in the prompt. This call does not extract any item's content — only " +
      "positions.",
    strict: true,
    input_schema: {
      type: "object",
      $defs: {
        stationRowCoordinates: stationRowCoordinatesDef,
        textFieldCoordinates: textFieldCoordinatesDef,
      },
      properties: {
        mainRoad: mainRoadCoordinatesDef,
        averageRoadWidthInSection: averageRoadWidthCoordinatesDef,
        majorStation: {
          type: "array",
          description:
            "The four 大型車站 sub-items' coordinates, in printed order (高鐵站, 火車站, 客運站, " +
            "捷運站) — always exactly 4, in this order, matching the content-extraction tool's " +
            "majorStation.items order positionally.",
          items: ref("stationRowCoordinates"),
        },
        busStop: busStopCoordinatesDef,
        interchange: interchangeCoordinatesDef,
        proximityToSettlement: ref("textFieldCoordinates"),
        proximityToDistributionCenter: ref("textFieldCoordinates"),
        proximityToMarket: ref("textFieldCoordinates"),
        roadConstructionLevel: ref("textFieldCoordinates"),
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

export { buildTrafficAndTransportCoordinatesTool };
