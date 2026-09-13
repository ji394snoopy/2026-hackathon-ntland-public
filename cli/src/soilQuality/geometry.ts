type Point = [number, number];
type Ring = Point[];

// GeoJSON-shaped geometry types as returned by the `shapefile` library. The soil map
// dataset carries Polygon/MultiPolygon geometry only (no points/lines), and this module
// only ever needs a containment test — not distance — so it's a trimmed, containment-only
// counterpart to drainageQuality/geometry.ts rather than a full copy.
interface PolygonGeometry {
  type: "Polygon";
  coordinates: Ring[]; // [exteriorRing, ...holeRings]
}
interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Ring[][]; // one Ring[] (exterior + holes) per part
}
type AnyPolygonGeometry = PolygonGeometry | MultiPolygonGeometry;

// Ray-casting (even-odd rule) point-in-ring test. `ring` need not be explicitly closed
// (last point === first) — the wrap-around edge is included regardless.
function pointInRing(p: Point, ring: Ring): boolean {
  const [px, py] = p;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// A point is "in" one polygon part (exterior + holes) if it's inside the exterior ring
// and not inside any hole ring.
function pointInPolygonPart(p: Point, rings: Ring[]): boolean {
  const [exterior, ...holes] = rings;
  if (!exterior) return false;
  if (!pointInRing(p, exterior)) return false;
  return !holes.some((hole) => pointInRing(p, hole));
}

function polygonContainsPoint(p: Point, geometry: AnyPolygonGeometry): boolean {
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return parts.some((rings) => pointInPolygonPart(p, rings));
}

export { pointInRing, polygonContainsPoint };
export type { Point, Ring, PolygonGeometry, MultiPolygonGeometry, AnyPolygonGeometry };
