import { distancePointToPoint, distanceToPolygonGeometry, distanceToLineGeometry } from "./geometry.js";
import type { Point, AnyPolygonGeometry, AnyLineGeometry } from "./geometry.js";
import type { DrainageLayer } from "./layers.js";

// Shaped like a GeoJSON feature (as returned by the `shapefile` library): raw DBF
// properties (still keyed by the layer's own Chinese/English DBF field names, not
// translated — this module has no Claude/vocabulary step) plus one of the 3 geometry
// shapes a WRA layer can carry.
interface LayerFeature {
  properties: Record<string, string>;
  geometry: { type: "Point"; coordinates: Point } | AnyPolygonGeometry | AnyLineGeometry;
}

interface NearestResult {
  name: string;
  distanceMeters: number;
  inside?: boolean; // only meaningful for polygon-kind layers
}

// Keeps only features whose declared county field contains countyName as a substring —
// handles all 3 field shapes seen across the 4 WRA layers uniformly: an exact match
// ("新北市"), a city+district prefix ("新北市三重區"), and a "、"-delimited multi-county
// value ("新北市、桃園市").
function filterToCounty(
  features: LayerFeature[],
  countyField: string,
  countyName: string,
): LayerFeature[] {
  return features.filter((feature) => (feature.properties[countyField] ?? "").includes(countyName));
}

function findNearestFeature(
  layer: DrainageLayer,
  features: LayerFeature[],
  point: Point,
): NearestResult | null {
  if (features.length === 0) return null;

  const name = (feature: LayerFeature) => feature.properties[layer.displayNameField] ?? "";

  if (layer.geometryKind === "point") {
    let best: NearestResult | null = null;
    for (const feature of features) {
      if (feature.geometry.type !== "Point") continue;
      const distanceMeters = distancePointToPoint(point, feature.geometry.coordinates);
      if (!best || distanceMeters < best.distanceMeters) {
        best = { name: name(feature), distanceMeters };
      }
    }
    return best;
  }

  if (layer.geometryKind === "polygon") {
    let best: NearestResult | null = null;
    for (const feature of features) {
      if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
      const { inside, distanceMeters } = distanceToPolygonGeometry(point, feature.geometry);
      if (inside) return { name: name(feature), distanceMeters: 0, inside: true };
      if (!best || distanceMeters < best.distanceMeters) {
        best = { name: name(feature), distanceMeters, inside: false };
      }
    }
    return best;
  }

  // polyline
  let best: NearestResult | null = null;
  for (const feature of features) {
    if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") continue;
    const distanceMeters = distanceToLineGeometry(point, feature.geometry);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { name: name(feature), distanceMeters };
    }
  }
  return best;
}

export { filterToCounty, findNearestFeature };
export type { LayerFeature, NearestResult };
