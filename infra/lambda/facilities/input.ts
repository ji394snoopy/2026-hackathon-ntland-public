// Parses the ways a caller can describe an "area" to search within:
//
//   1. A polygon  — a ring of [lon, lat] points. Accepted as:
//        - a GeoJSON Polygon geometry ({ type: "Polygon", coordinates: [ring] })
//        - a bare array of [lon, lat] pairs (the outer ring)
//        - a query-string "poly=lon,lat;lon,lat;lon,lat;lon,lat"
//      Facilities are those contained in the polygon; distances are measured to the
//      polygon's centroid.
//
//   2. A center + radius — center [lon, lat] plus radius in meters. Facilities are
//      those within the radius; distances are measured to the center point.
//      `radius` is the BASE radius every category uses unless it's overridden by
//      `categories` (see parseCategoryRadii): a list of (category, radius) pairs letting
//      one class reach further than the rest — 嫌惡設施 out to 3000m while 公車站 stays at
//      200m, instead of one radius that is either too noisy or too short for everything.
//
//   3. A polygon + radius — the polygon is used ONLY to derive the center (its centroid);
//      membership is then the radius around that centroid, exactly as in (2). This is the
//      表1 勘查表 flow: 前端圈一個區段多邊形,設施要查的卻是「以區段中心為圓心、逐類半徑」
//      的範圍 —— 區段邊界內的設施數量是地籍事實,不是勘查標準。Per-category radii work
//      here because this IS radius mode; a polygon on its own (1) still rejects them.
//
// Any of the three may also carry `point` — a SECOND measuring point (前端的「地點」＝
// 比準地座標). It never affects membership; it only makes every hit report a second
// distance (metersToPoint) alongside metersToCenter. 區域因素 graded off the 區段 center,
// 個別因素 off the parcel itself, and one query now answers both.
//
// Output is a normalized shape the query layer turns into PostGIS SQL. Coordinates are
// WGS84 (EPSG:4326), matching every table in the DB.

import { expandSelector, SELECTOR_HINT } from "./taxonomy.js";

const LON_MIN = -180;
const LON_MAX = 180;
const LAT_MIN = -90;
const LAT_MAX = 90;
const DEFAULT_RADIUS_M = 500;
const MAX_RADIUS_M = 20000;

/** What every area kind shares: the optional second measuring point. */
interface AreaBase {
  /**
   * A second point every hit also reports its distance to (`metersToPoint`). Purely a
   * measurement origin — it does NOT widen, narrow or otherwise touch which facilities come
   * back. Absent when the caller gave no `point`.
   */
  point?: [number, number];
}

export interface PolygonArea extends AreaBase {
  kind: "polygon";
  /** Outer ring as [lon, lat] pairs, guaranteed closed (first === last) with >= 4 points. */
  ring: [number, number][];
}

export interface RadiusArea extends AreaBase {
  kind: "radius";
  center: [number, number];
  /** Base radius in meters — what every category uses unless `categoryRadii` overrides it. */
  radiusMeters: number;
  /**
   * Per-category overrides, already expanded from whatever the caller wrote (a group name,
   * a category key, a 中文 kind) down to atom selectors: a category key, or a station kind
   * for the three station tables. Absent when the caller gave no `categories`.
   */
  categoryRadii?: Map<string, number>;
  /** max(radiusMeters, ...categoryRadii) — the widest circle any source will search. */
  maxRadiusMeters: number;
  /**
   * Set when `center` was derived from a polygon's centroid (the polygon + radius form).
   * Kept only so the response can say where the center came from; membership ignores it.
   */
  centerRing?: [number, number][];
}

export type Area = PolygonArea | RadiusArea;

export class InvalidInputError extends Error {}

function assertLonLat(pair: unknown): [number, number] {
  if (!Array.isArray(pair) || pair.length < 2) {
    throw new InvalidInputError("Each coordinate must be a [lon, lat] pair.");
  }
  const lon = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new InvalidInputError("Coordinate values must be finite numbers.");
  }
  if (lon < LON_MIN || lon > LON_MAX || lat < LAT_MIN || lat > LAT_MAX) {
    throw new InvalidInputError(`Coordinate out of range: [${lon}, ${lat}].`);
  }
  return [lon, lat];
}

// A valid linear ring needs >= 4 positions and must be closed (last === first). We
// accept an open ring of >= 3 distinct points and close it ourselves.
function normalizeRing(points: [number, number][]): [number, number][] {
  if (points.length < 3) {
    throw new InvalidInputError("A polygon needs at least 3 points.");
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const closed = first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
  if (closed.length < 4) {
    throw new InvalidInputError("A polygon ring needs at least 4 positions once closed.");
  }
  return closed;
}

/**
 * The ring's geometric centroid — the same value PostGIS's ST_Centroid returns. An
 * SRID-4326 geometry is planar degrees as far as ST_Centroid is concerned (it does no
 * geodesic work), so the shoelace centroid computed here in the same degree coordinates
 * agrees with SQL to floating-point noise. Computing it up front means the SQL membership
 * test, the NLSC HTTP call and the reported `area.center` all share ONE center instead of
 * three near-identical ones.
 *
 * A degenerate ring (zero signed area — every vertex collinear, or all the same point) has
 * no centroid; fall back to the vertex average so a caller's flat "polygon" still resolves
 * to a usable point rather than NaN.
 */
function ringCentroid(ring: [number, number][]): [number, number] {
  const verts = ring.slice(0, -1); // drop the closing duplicate vertex
  // Shoelace on raw lon/lat loses most of its precision to cancellation: at lon 121.5 each
  // cross product is ~3000 while their SUM, for a 區段-sized ring, is ~1e-4. Shifting the
  // ring to its own first vertex first makes every term small and same-scale, so the sum
  // keeps its significant digits; the origin goes back on at the end. Without this a 1km
  // square's centroid lands ~1cm off — harmless for a distance, but this number gets stored
  // as the 佐證 basis, and "the centre we measured from" should be exactly reproducible.
  const [ox, oy] = verts[0]!;
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const x0 = verts[i]![0] - ox;
    const y0 = verts[i]![1] - oy;
    const next = verts[(i + 1) % verts.length]!;
    const x1 = next[0] - ox;
    const y1 = next[1] - oy;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (twiceArea !== 0) {
    return [ox + cx / (3 * twiceArea), oy + cy / (3 * twiceArea)];
  }
  const n = verts.length;
  return [
    ox + verts.reduce((sum, v) => sum + (v[0] - ox), 0) / n,
    oy + verts.reduce((sum, v) => sum + (v[1] - oy), 0) / n,
  ];
}

/**
 * The optional second measuring point. Accepted as `point: [lon, lat]`, a query-string
 * `point=lon,lat`, or separate `pointLon` / `pointLat` fields.
 */
function parsePoint(input: Record<string, unknown>): [number, number] | undefined {
  const raw =
    input.point ??
    (input.pointLon !== undefined && input.pointLat !== undefined
      ? [input.pointLon, input.pointLat]
      : undefined);
  if (raw === undefined || raw === null || raw === "") return undefined;
  return assertLonLat(typeof raw === "string" ? raw.split(",") : (raw as unknown[]));
}

function parsePolyString(poly: string): [number, number][] {
  // "lon,lat;lon,lat;..." — semicolons separate points, commas separate lon/lat.
  const points = poly
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => assertLonLat(pair.split(",")));
  return points;
}

function assertRadius(value: unknown, label: string): number {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) {
    throw new InvalidInputError(`${label} must be a positive number of meters.`);
  }
  if (meters > MAX_RADIUS_M) {
    throw new InvalidInputError(`${label} must be <= ${MAX_RADIUS_M} meters.`);
  }
  return meters;
}

/**
 * Parse the per-category radius overrides. Two accepted forms, both landing in the same
 * expanded map:
 *
 *   POST  "categories": [ { "category": "特殊設施", "radius": 3000 }, { "category": "公車站", "radius": 200 } ]
 *   GET   "cats=special:3000;公車站:200"   (also accepted as "categories=")
 *
 * A group name expands to every category under it, so one entry can move all of 嫌惡設施
 * at once. When a group and a single category overlap, the LARGER radius wins — the caller
 * asked for that reach somewhere, and silently shrinking it is the more surprising outcome.
 * An unrecognized name is a 400 rather than a silent no-op, so a typo surfaces immediately.
 */
function parseCategoryRadii(input: Record<string, unknown>): Map<string, number> | undefined {
  const raw = input.categories ?? input.cats;
  if (raw === undefined || raw === null || raw === "") return undefined;

  let entries: { category: unknown; radius: unknown }[];
  if (typeof raw === "string") {
    // "name:radius;name:radius" — semicolons separate entries, a colon splits name/radius.
    entries = raw
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.lastIndexOf(":");
        if (idx <= 0) {
          throw new InvalidInputError(`categories entry "${pair}" must be "<category>:<radius>".`);
        }
        return { category: pair.slice(0, idx), radius: pair.slice(idx + 1) };
      });
  } else if (Array.isArray(raw)) {
    entries = raw.map((item) => {
      if (!item || typeof item !== "object") {
        throw new InvalidInputError("Each categories entry must be { category, radius }.");
      }
      const e = item as Record<string, unknown>;
      return { category: e.category ?? e.name, radius: e.radius ?? e.radiusMeters };
    });
  } else {
    throw new InvalidInputError(
      'categories must be an array of { category, radius } or a "<category>:<radius>;…" string.',
    );
  }

  const radii = new Map<string, number>();
  for (const entry of entries) {
    if (typeof entry.category !== "string") {
      throw new InvalidInputError("Each categories entry needs a string `category`.");
    }
    const meters = assertRadius(entry.radius, `categories["${entry.category}"].radius`);
    const atoms = expandSelector(entry.category);
    if (!atoms || atoms.length === 0) {
      throw new InvalidInputError(`Unknown category: "${entry.category}". ${SELECTOR_HINT}`);
    }
    for (const atom of atoms) {
      radii.set(atom, Math.max(radii.get(atom) ?? 0, meters));
    }
  }
  return radii.size > 0 ? radii : undefined;
}

/**
 * The outer ring the caller described, or undefined if they described no polygon at all.
 * "polygon" can be a GeoJSON Polygon geometry or a bare ring array; "poly" is the
 * query-string form "lon,lat;lon,lat;...".
 */
function parseRingPoints(input: Record<string, unknown>): [number, number][] | undefined {
  if (typeof input.poly === "string") return parsePolyString(input.poly);
  if (input.polygon === undefined) return undefined;

  const polygon = input.polygon;
  if (
    polygon &&
    typeof polygon === "object" &&
    (polygon as { type?: string }).type === "Polygon" &&
    Array.isArray((polygon as { coordinates?: unknown }).coordinates)
  ) {
    const ring = (polygon as { coordinates: unknown[] }).coordinates[0];
    if (!Array.isArray(ring)) throw new InvalidInputError("GeoJSON Polygon has no outer ring.");
    return ring.map(assertLonLat);
  }
  if (Array.isArray(polygon)) return polygon.map(assertLonLat);
  throw new InvalidInputError(
    "polygon must be a GeoJSON Polygon geometry or an array of [lon, lat] pairs.",
  );
}

/** Assemble a RadiusArea from an already-resolved center. Shared by the two radius forms. */
function radiusArea(
  center: [number, number],
  radiusMeters: number,
  categoryRadii: Map<string, number> | undefined,
  point: [number, number] | undefined,
  centerRing?: [number, number][],
): RadiusArea {
  return {
    kind: "radius",
    center,
    radiusMeters,
    ...(categoryRadii ? { categoryRadii } : {}),
    maxRadiusMeters: Math.max(radiusMeters, ...(categoryRadii?.values() ?? [])),
    ...(point ? { point } : {}),
    ...(centerRing ? { centerRing } : {}),
  };
}

/**
 * Parse a normalized {@link Area} from a loosely-typed input object. Accepts fields from
 * either a parsed JSON body or a query-string map (all-string values), so the same
 * parser serves both GET and POST.
 */
export function parseArea(input: Record<string, unknown>): Area {
  const categoryRadii = parseCategoryRadii(input);
  const point = parsePoint(input);
  const ringPoints = parseRingPoints(input);
  const hasRadius = input.radius !== undefined && input.radius !== null && input.radius !== "";

  // --- polygon + radius: the polygon only supplies the center ---
  // An explicit radius alongside a polygon says "measure and search from this shape's
  // centre", not "search inside this shape" — so it resolves to plain radius mode, and the
  // per-category overrides that polygon mode has no meaning for work as usual.
  if (ringPoints && hasRadius) {
    const ring = normalizeRing(ringPoints);
    return radiusArea(
      ringCentroid(ring),
      assertRadius(input.radius, "radius"),
      categoryRadii,
      point,
      ring,
    );
  }

  // --- center + radius ---
  // center can be [lon,lat], or separate lon/lat (or center_lon/center_lat) fields.
  const rawCenter =
    input.center ??
    (input.lon !== undefined && input.lat !== undefined ? [input.lon, input.lat] : undefined) ??
    (input.center_lon !== undefined && input.center_lat !== undefined
      ? [input.center_lon, input.center_lat]
      : undefined);

  if (rawCenter !== undefined && !ringPoints) {
    const center = assertLonLat(
      typeof rawCenter === "string" ? rawCenter.split(",") : (rawCenter as unknown[]),
    );
    const radiusMeters = hasRadius ? assertRadius(input.radius, "radius") : DEFAULT_RADIUS_M;
    return radiusArea(center, radiusMeters, categoryRadii, point);
  }

  // --- polygon (containment) ---
  if (!ringPoints) {
    throw new InvalidInputError(
      "Provide either a polygon (polygon/poly) or a center + radius (center/lon+lat, radius).",
    );
  }

  // A per-category radius means "reach further out from the center than the base radius",
  // which polygon CONTAINMENT has no equivalent of — its boundary IS the area. Rejecting
  // beats silently ignoring the overrides the caller asked for. Adding a `radius` is the
  // way to ask for per-category reach from the polygon's centre (see above).
  if (categoryRadii) {
    throw new InvalidInputError(
      "categories[] (per-category radius) needs a radius: give a center + radius, or a " +
        "polygon together with a radius (the polygon's centroid becomes the center).",
    );
  }

  return { kind: "polygon", ring: normalizeRing(ringPoints), ...(point ? { point } : {}) };
}

export { DEFAULT_RADIUS_M, MAX_RADIUS_M };
