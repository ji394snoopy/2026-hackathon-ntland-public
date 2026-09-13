type Point = [number, number];
type Ring = Point[];

// GeoJSON-shaped geometry types as returned by the `shapefile` library. A given
// polygon/line record's part count isn't guaranteed one way or the other by anything
// sourced for this module, so every helper below normalizes Polygon->[rings] and
// LineString->[segments] to the same shape MultiPolygon/MultiLineString already use,
// rather than keeping two code paths.
interface PolygonGeometry {
  type: "Polygon";
  coordinates: Ring[]; // [exteriorRing, ...holeRings]
}
interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Ring[][]; // one Ring[] (exterior + holes) per part
}
type AnyPolygonGeometry = PolygonGeometry | MultiPolygonGeometry;

interface LineStringGeometry {
  type: "LineString";
  coordinates: Point[];
}
interface MultiLineStringGeometry {
  type: "MultiLineString";
  coordinates: Point[][];
}
type AnyLineGeometry = LineStringGeometry | MultiLineStringGeometry;

function distancePointToPoint(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Perpendicular distance if p projects onto the segment's interior, otherwise the
// distance to whichever endpoint is nearer.
function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distancePointToPoint(p, a); // a === b

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const projection: Point = [ax + t * dx, ay + t * dy];
  return distancePointToPoint(p, projection);
}

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

function distancePointToRing(p: Point, ring: Ring): number {
  let min = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    min = Math.min(min, distancePointToSegment(p, a, b));
  }
  return min;
}

// A point is "in" one polygon part (exterior + holes) if it's inside the exterior ring
// and not inside any hole ring — holes are respected for containment, but (per this
// module's documented scope) not for the exterior-edge distance computed below.
function pointInPolygonPart(p: Point, rings: Ring[]): boolean {
  const [exterior, ...holes] = rings;
  if (!exterior) return false;
  if (!pointInRing(p, exterior)) return false;
  return !holes.some((hole) => pointInRing(p, hole));
}

function distanceToPolygonGeometry(
  p: Point,
  geometry: AnyPolygonGeometry,
): { inside: boolean; distanceMeters: number } {
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const rings of parts) {
    if (pointInPolygonPart(p, rings)) {
      return { inside: true, distanceMeters: 0 };
    }
  }

  let min = Infinity;
  for (const rings of parts) {
    const exterior = rings[0];
    if (!exterior) continue;
    min = Math.min(min, distancePointToRing(p, exterior));
  }
  return { inside: false, distanceMeters: min };
}

function distanceToLineGeometry(p: Point, geometry: AnyLineGeometry): number {
  const parts = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;

  let min = Infinity;
  for (const line of parts) {
    for (let i = 0; i < line.length - 1; i++) {
      min = Math.min(min, distancePointToSegment(p, line[i]!, line[i + 1]!));
    }
  }
  return min;
}

export {
  distancePointToPoint,
  distancePointToSegment,
  pointInRing,
  distancePointToRing,
  distanceToPolygonGeometry,
  distanceToLineGeometry,
};
export type {
  Point,
  Ring,
  PolygonGeometry,
  MultiPolygonGeometry,
  AnyPolygonGeometry,
  LineStringGeometry,
  MultiLineStringGeometry,
  AnyLineGeometry,
};
