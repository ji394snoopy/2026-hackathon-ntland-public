import { polygonContainsPoint } from "./geometry.js";
import type { Point, AnyPolygonGeometry } from "./geometry.js";

// Shaped like a GeoJSON feature (as returned by the `shapefile` library): raw DBF
// properties (still keyed by the dataset's own Chinese/English field names, not
// translated — this module has no Claude/vocabulary step), Polygon/MultiPolygon only
// (the soil map dataset carries no other geometry kind).
interface SoilFeature {
  properties: Record<string, string>;
  geometry: AnyPolygonGeometry;
}

interface SoilMatch {
  seriesCode: string;
  seriesNameZh: string;
  seriesNameEn: string;
  soilType: string;
  soilOrder: string;
  surfaceTexture: string;
  slopePhase: string;
  otherPhase: string;
  soilVariation: string;
  surveyArea: string;
  mapUnitName: string;
  areaSqm: number;
}

// Curates a matched feature's raw DBF fields into an English-keyed summary — dropping
// only internal/non-substantive fields (圖幅名稱 is always "-", MUID/Map_unit are internal
// drawing-unit codes, Perimeter/Smfid aren't meaningful facts on their own) and the
// legacy 地區 field (excluded deliberately — see soilQuality's plan decision log: it
// reflects each survey report's *original* administrative boundary, not current ones,
// so it's not used for filtering and isn't surfaced as if it were a reliable county label).
function toSoilMatch(properties: Record<string, string>): SoilMatch {
  return {
    seriesCode: properties["土系代號"] ?? "",
    seriesNameZh: properties["土系"] ?? "",
    seriesNameEn: properties["Series"] ?? "",
    soilType: properties["土型"] ?? "",
    soilOrder: properties["土類"] ?? "",
    surfaceTexture: properties["表土質地"] ?? "",
    slopePhase: properties["坡度相"] ?? "",
    otherPhase: properties["土相"] ?? "",
    soilVariation: properties["土壤變異"] ?? "",
    surveyArea: properties["調查區"] ?? "",
    mapUnitName: properties["繪圖單位名"] ?? "",
    areaSqm: Number(properties["AREA"] ?? "0"),
  };
}

// Brute-force containment scan across the full national feature set (no county
// pre-filter — see plan decision log for why). Returns the first containing polygon's
// curated facts, or null if the point falls in a genuine survey gap (e.g. dense urban
// parcels with no soil-map coverage).
function findSoilAtPoint(features: SoilFeature[], point: Point): SoilMatch | null {
  for (const feature of features) {
    if (polygonContainsPoint(point, feature.geometry)) {
      return toSoilMatch(feature.properties);
    }
  }
  return null;
}

export { findSoilAtPoint };
export type { SoilFeature, SoilMatch };
