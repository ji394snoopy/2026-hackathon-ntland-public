import type { FacilitiesRepo } from "./db.js";
import type { Area } from "./input.js";
import { queryNlscFacilities } from "./nlsc.js";
import {
  CATEGORY_GROUP,
  CATEGORY_KIND_ZH,
  GROUP_ORDER,
  STATION_KINDS,
  STATION_TABLES,
  type FacilityGroup,
} from "./taxonomy.js";

export type { FacilityGroup };

// doorplate has ~2M rows; returning every address inside an area is rarely useful and
// can be huge, so it's summarized as a count plus this many nearest addresses.
const DOORPLATE_NEAREST_N = 5;

export interface FacilityHit {
  kind: string;
  /** Stable category key for POIs (e.g. 'park', 'bank'); undefined for station tables. */
  category?: string;
  name: string | null;
  lon: number;
  lat: number;
  metersToCenter: number;
  /**
   * Distance to the caller's second measuring point (`area.point`), when one was given.
   * Undefined otherwise — never 0 as a stand-in, since 0 is a real distance.
   */
  metersToPoint?: number;
}

// Rollup for one group: total count + each hit (already distance-sorted) + the single
// nearest, so the frontend can show "最近 X，Ym" without re-scanning items.
export interface GroupSummary {
  count: number;
  nearest: {
    kind: string;
    name: string | null;
    metersToCenter: number;
    metersToPoint?: number;
  } | null;
  items: FacilityHit[];
}

// Maps a facility to its 評估 group. Stations have no `category`, so they're matched by
// `kind`; everything else (OSM + NLSC) is matched by `category`. See taxonomy.ts.
function groupOf(hit: FacilityHit): FacilityGroup {
  if (STATION_KINDS.has(hit.kind)) return "交通";
  if (hit.category && CATEGORY_GROUP[hit.category]) return CATEGORY_GROUP[hit.category]!;
  return "其他";
}

/**
 * The radius (metres) this category is searched with: its own override if the caller gave
 * one, otherwise the base radius. `selector` is a category key ('cemetery') or a station
 * kind ('公車站'). Polygon mode has no radius — the ring is the area — so it returns 0 and
 * the membership predicates ignore it.
 */
function radiusFor(area: Area, selector: string): number {
  if (area.kind !== "radius") return 0;
  return area.categoryRadii?.get(selector) ?? area.radiusMeters;
}

// Collapses duplicate hits into one. The biggest source is bus stops: TDX stores one row
// per route serving a stop, so a single physical 站位 comes back dozens of times at the
// same coordinate. We key by kind + name + coordinate rounded to ~1m (5 decimal places),
// keeping the nearest occurrence. Unnamed points (name === null) are keyed by coordinate
// alone so distinct unnamed features aren't merged by an empty name.
function dedupeFacilities(facilities: FacilityHit[]): FacilityHit[] {
  const seen = new Map<string, FacilityHit>();
  for (const f of facilities) {
    const coord = `${f.lon.toFixed(5)},${f.lat.toFixed(5)}`;
    const key = `${f.kind}|${f.name ?? ""}|${coord}`;
    const existing = seen.get(key);
    if (!existing || f.metersToCenter < existing.metersToCenter) seen.set(key, f);
  }
  return [...seen.values()];
}

// Rolls the flat facilities list up into the six groups. `facilities` is already
// distance-sorted per source, but the merged list isn't globally sorted, so each group's
// items are re-sorted by distance and the nearest taken from the front.
function buildByCategory(facilities: FacilityHit[]): Record<FacilityGroup, GroupSummary> {
  const groups = Object.fromEntries(
    GROUP_ORDER.map((g) => [g, { count: 0, nearest: null, items: [] } as GroupSummary]),
  ) as Record<FacilityGroup, GroupSummary>;

  for (const hit of facilities) groups[groupOf(hit)].items.push(hit);

  for (const g of GROUP_ORDER) {
    const summary = groups[g];
    summary.items.sort((a, b) => a.metersToCenter - b.metersToCenter);
    summary.count = summary.items.length;
    const n = summary.items[0];
    // "nearest" stays nearest-to-CENTER even when a point was given: this rollup describes
    // the queried area, and re-ranking it by the parcel would make `nearest` disagree with
    // `items[0]`. Consumers that want the nearest to the parcel sort `items` themselves.
    summary.nearest = n
      ? {
          kind: n.kind,
          name: n.name,
          metersToCenter: n.metersToCenter,
          ...(n.metersToPoint !== undefined ? { metersToPoint: n.metersToPoint } : {}),
        }
      : null;
  }
  return groups;
}

export interface DoorplateSummary {
  count: number;
  nearest: {
    address: string;
    lon: number;
    lat: number;
    metersToCenter: number;
    metersToPoint?: number;
  }[];
}

export interface FacilitiesResult {
  area: {
    kind: Area["kind"];
    center: { lon: number; lat: number };
    /**
     * Where `center` came from: "polygon" when the caller gave a polygon + radius and the
     * centroid was derived from it, absent when they named the center directly. Lets a
     * caller's 佐證文字 say 「距區段中心」 vs 「距查詢點」 without guessing.
     */
    centerFrom?: "polygon";
    /** The second measuring point, echoed back when the caller gave one. */
    point?: { lon: number; lat: number };
    /** Base radius. Only for radius queries. */
    radiusMeters?: number;
    /** Widest radius any category was searched with. Only for radius queries. */
    maxRadiusMeters?: number;
    /** Per-category radius actually applied — only the overrides, only for radius queries. */
    categoryRadii?: Record<string, number>;
  };
  /** Flat, distance-sorted list — use for map markers. */
  facilities: FacilityHit[];
  /**
   * The same facilities rolled up into the six 評估 groups (交通/公共設施/公共建設/
   * 特殊設施/工商活動/其他), each with count + nearest + the group's items. Use for the
   * report UI so the frontend doesn't re-group.
   */
  byCategory: Record<FacilityGroup, GroupSummary>;
  doorplate: DoorplateSummary;
}

// Metres -> degrees latitude (~111.32 km/deg) padded 30%, so a planar circle in degrees
// safely encloses the true geodesic circle at NT latitudes. Used only for the index-usable
// pre-filter; the exact geography test then trims to real metres.
function degreesFor(meters: number): number {
  return (meters / 111_320) * 1.3;
}

// Builds the SQL pieces every sub-query shares, for ONE statement:
//   - the WITH clause defining `center` (and `area` in polygon mode)
//   - `within`  — the exact membership test, in real metres (or ST_Contains for a polygon)
//   - `prefilter` — a cheap, GiST-index-usable predicate on the *geometry* column (no
//     ::geography cast), slightly larger than the true area, to trim big tables before the
//     exact test. Without it the ::geography cast defeats the index and forces a full-table
//     scan (observed: 100s on doorplate's ~2M rows).
//
// Each statement gets its own builder because `$n` placeholders are numbered per statement
// and the per-category radii mean different statements bind different numbers of params.
interface AreaSql {
  params: unknown[];
  /** Binds a value and returns its `$n` placeholder. */
  param(value: unknown): string;
  /** The WITH clause; `extra` appends further CTE definitions ("name AS (...)"). */
  with(extra?: string[]): string;
  /** Exact membership at a fixed radius. `meters` is ignored in polygon mode. */
  within(geomExpr: string, meters: number): string;
  /** Exact membership where the radius is itself a SQL expression (per-row overrides). */
  withinSql(geomExpr: string, metersExpr: string): string;
  /** Index-usable superset of `within`. `meters` is ignored in polygon mode. */
  prefilter(geomExpr: string, meters: number): string;
  /**
   * Distance to the caller's second measuring point, as a SQL expression in real metres —
   * or null when no `point` was given, so callers can emit a NULL column instead.
   */
  distanceToPoint(geomExpr: string): string | null;
}

/** `metersToPoint`'s SELECT expression: the real distance, or a typed NULL when no point. */
function pointMetersColumn(sql: AreaSql, geomExpr: string): string {
  return sql.distanceToPoint(geomExpr) ?? "NULL::double precision";
}

/**
 * The `meters_point` column as a spreadable `{ metersToPoint }` (or nothing at all when the
 * query carried no point). Kept absent rather than null so `metersToPoint` never appears in
 * the JSON as a value consumers could mistake for a measured 0.
 */
function pointMeters(raw: number | null | undefined): { metersToPoint?: number } {
  if (raw == null) return {};
  const meters = Number(raw);
  return Number.isFinite(meters) ? { metersToPoint: Math.round(meters) } : {};
}

function areaSqlFor(area: Area): AreaSql {
  const params: unknown[] = [];
  const param = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  // The optional second measuring point, as its own CTE so every sub-query measures to it
  // identically. Bound here, before the area's own params — `$n` numbering follows BIND
  // order, not where the placeholder sits in the text, so this is safe for both branches.
  // Named ref_point, not point: `point` is a built-in type name in Postgres.
  const pointParts: string[] = [];
  let pointDistance: ((geomExpr: string) => string) | null = null;
  if (area.point) {
    const lonP = param(area.point[0]);
    const latP = param(area.point[1]);
    pointParts.push(
      `ref_point AS (SELECT ST_SetSRID(ST_MakePoint(${lonP}, ${latP}), 4326) AS pt)`,
    );
    pointDistance = (g) => `ST_Distance(${g}::geography, (SELECT pt FROM ref_point)::geography)`;
  }
  const distanceToPoint = (geomExpr: string): string | null =>
    pointDistance ? pointDistance(geomExpr) : null;

  const withClause = (parts: string[]) => (extra: string[] = []) =>
    `WITH ${[...pointParts, ...parts, ...extra].join(",\n")}`;

  if (area.kind === "polygon") {
    // Pass the ring as GeoJSON; a GeoJSON Polygon builds directly, no ST_MakePolygon needed.
    // Center is the polygon centroid. `meters` arguments are ignored throughout — and,
    // importantly, never bound, so no unused placeholder is left in the params array.
    const geojson = param(JSON.stringify({ type: "Polygon", coordinates: [area.ring] }));
    const withinPolygon = (g: string) => `ST_Contains((SELECT geom FROM area), ${g})`;
    return {
      params,
      param,
      with: withClause([
        `area AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS geom)`,
        `center AS (SELECT ST_Centroid(geom) AS pt FROM area)`,
      ]),
      within: withinPolygon,
      withinSql: withinPolygon,
      // bbox overlap against the polygon — uses the GiST index, trims before ST_Contains.
      prefilter: (g) => `${g} && (SELECT geom FROM area)`,
      distanceToPoint,
    };
  }

  // radius: centre point + metres. Membership uses geography ST_DWithin so the radius is
  // real metres regardless of latitude.
  const lonP = param(area.center[0]);
  const latP = param(area.center[1]);
  const withinSql = (g: string, metersExpr: string) =>
    `ST_DWithin(${g}::geography, (SELECT pt FROM center)::geography, ${metersExpr})`;
  return {
    params,
    param,
    with: withClause([`center AS (SELECT ST_SetSRID(ST_MakePoint(${lonP}, ${latP}), 4326) AS pt)`]),
    within: (g, meters) => withinSql(g, `${param(meters)}::double precision`),
    withinSql,
    // Planar ST_DWithin in degrees — uses the geometry GiST index (no ::geography cast).
    prefilter: (g, meters) =>
      `ST_DWithin(${g}, (SELECT pt FROM center), ${param(degreesFor(meters))}::double precision)`,
    distanceToPoint,
  };
}

export interface QueryOptions {
  /**
   * Also query the live NLSC 環域 API for 殯葬/加油站/醫療/文教 and merge them into
   * `facilities`. Default true. Set false for offline / DB-only runs (tests, no network) —
   * NLSC failures are already swallowed per-category, but this skips the calls entirely.
   */
  includeNlsc?: boolean;
}

// What NLSC needs: the point to query at (it only takes point + radius, never a polygon),
// the centre distances are measured to, and the per-category radius each result is trimmed
// to. For radius mode the two points coincide and each category carries its own radius; for
// polygon mode we query at the centroid with a radius covering the whole ring and let the
// ring itself do the trimming.
function nlscQueryFor(area: Area): {
  queryLon: number;
  queryLat: number;
  centerLon: number;
  centerLat: number;
  pointLon?: number;
  pointLat?: number;
  radiusFor: (category: string) => number;
  ring?: [number, number][];
} {
  // The second measuring point is the caller's, independent of how the area was described.
  const point = area.point ? { pointLon: area.point[0], pointLat: area.point[1] } : {};
  if (area.kind === "radius") {
    const [lon, lat] = area.center;
    return {
      queryLon: lon,
      queryLat: lat,
      centerLon: lon,
      centerLat: lat,
      ...point,
      radiusFor: (category) => radiusFor(area, category),
    };
  }
  // polygon: centroid = average of the ring's distinct vertices; covering radius = max
  // distance from centroid to any vertex (a generous over-cover; the ring trims the rest).
  const ring = area.ring;
  const verts = ring.slice(0, -1); // drop the closing dup vertex
  let sx = 0;
  let sy = 0;
  for (const [x, y] of verts) {
    sx += x;
    sy += y;
  }
  const cx = sx / verts.length;
  const cy = sy / verts.length;
  // Rough metres-per-degree at this latitude for the covering radius.
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((cy * Math.PI) / 180);
  let maxR = 0;
  for (const [x, y] of verts) {
    const dx = (x - cx) * mPerDegLon;
    const dy = (y - cy) * mPerDegLat;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r > maxR) maxR = r;
  }
  const covering = Math.max(maxR, 100);
  return {
    queryLon: cx,
    queryLat: cy,
    centerLon: cx,
    centerLat: cy,
    ...point,
    radiusFor: () => covering,
    ring,
  };
}

export async function queryFacilities(
  repo: FacilitiesRepo,
  area: Area,
  options: QueryOptions = {},
): Promise<FacilitiesResult> {
  const includeNlsc = options.includeNlsc ?? true;
  // Base radius for the sources that don't take a per-category override (doorplate), and
  // the fallback for those that do. 0 in polygon mode, where every `meters` is ignored.
  const baseMeters = area.kind === "radius" ? area.radiusMeters : 0;

  // Kick off the live NLSC query (if enabled) alongside the DB queries. It's network I/O
  // independent of PostGIS, so overlapping them hides its latency behind the SQL.
  const nlscPromise = includeNlsc
    ? queryNlscFacilities(nlscQueryFor(area))
    : Promise.resolve([] as FacilityHit[]);

  // One UNION ALL query across the station tables, each branch carrying its own radius so
  // 公車站 can stay at 200m while the rest of the area reaches further. Distance is always
  // measured to `center` (centroid for polygons, the given point for radius) in geography
  // metres, plus `meters_point` to the caller's second point when they gave one.
  const stationSql = areaSqlFor(area);
  const stationUnion = STATION_TABLES.map(({ table, kind, nameExpr }) => {
    const meters = radiusFor(area, kind);
    return `
      SELECT '${kind}'::text AS kind,
             ${nameExpr} AS name,
             ST_X(t.geom) AS lon,
             ST_Y(t.geom) AS lat,
             ST_Distance(t.geom::geography, (SELECT pt FROM center)::geography) AS meters,
             ${pointMetersColumn(stationSql, "t.geom")} AS meters_point
      FROM ${table} t
      WHERE ${stationSql.prefilter("t.geom", meters)}
        AND ${stationSql.within("t.geom", meters)}
    `;
  }).join("\nUNION ALL\n");

  const facilitySql = `
    ${stationSql.with()}
    SELECT kind, name, lon, lat, meters, meters_point FROM (
      ${stationUnion}
    ) f
    ORDER BY kind, meters
  `;

  const facilityRows = await repo.query<{
    kind: string;
    name: string | null;
    lon: number;
    lat: number;
    meters: number;
    meters_point: number | null;
  }>(facilitySql, stationSql.params);

  // OSM POIs: one indexed table. Per-category radii arrive as an `ovr` VALUES table joined
  // on category, so each row is tested against its own radius in a single pass; categories
  // with no override fall back to the base radius via COALESCE. category is returned so the
  // caller can group by our PoiCategory; kind is the 中文 label.
  const poiSql = areaSqlFor(area);
  const poiOverrides =
    area.kind === "radius" && area.categoryRadii
      ? [...area.categoryRadii].filter(([selector]) => !STATION_KINDS.has(selector))
      : [];

  let poiExtraCte: string[] = [];
  let poiJoin = "";
  let poiWhere: string;
  if (poiOverrides.length > 0) {
    const rows = poiOverrides
      .map(([category, meters]) => `(${poiSql.param(category)}::text, ${poiSql.param(meters)}::double precision)`)
      .join(", ");
    poiExtraCte = [`ovr(category, radius_m) AS (VALUES ${rows})`];
    poiJoin = "LEFT JOIN ovr r ON r.category = t.category";
    // Prefilter at the widest radius (a superset), then the exact per-row radius.
    poiWhere = `${poiSql.prefilter("t.geom", area.kind === "radius" ? area.maxRadiusMeters : 0)}
      AND ${poiSql.withinSql(
        "t.geom",
        `COALESCE(r.radius_m, ${poiSql.param(baseMeters)}::double precision)`,
      )}`;
  } else {
    poiWhere = `${poiSql.prefilter("t.geom", baseMeters)} AND ${poiSql.within("t.geom", baseMeters)}`;
  }

  const poisSql = `
    ${poiSql.with(poiExtraCte)}
    SELECT
      t.category,
      t.name,
      ST_X(t.geom) AS lon,
      ST_Y(t.geom) AS lat,
      ST_Distance(t.geom::geography, (SELECT pt FROM center)::geography) AS meters,
      ${pointMetersColumn(poiSql, "t.geom")} AS meters_point
    FROM pois t
    ${poiJoin}
    WHERE ${poiWhere}
    ORDER BY t.category, meters
  `;
  const poisRows = await repo.query<{
    category: string;
    name: string | null;
    lon: number;
    lat: number;
    meters: number;
    meters_point: number | null;
  }>(poisSql, poiSql.params);

  // doorplate: count within area + nearest N to center. Always the BASE radius — this table
  // is the coordinate→address lookup, not a facility layer, so a category override widening
  // the search to 3km has no business dragging ~2M rows along with it.
  const countSql = areaSqlFor(area);
  const doorplateCountSql = `
    ${countSql.with()}
    SELECT count(*)::bigint AS n
    FROM doorplate t
    WHERE t.geom IS NOT NULL
      AND ${countSql.prefilter("t.geom", baseMeters)}
      AND ${countSql.within("t.geom", baseMeters)}
  `;
  const nearestSql = areaSqlFor(area);
  const doorplateNearestSql = `
    ${nearestSql.with()}
    SELECT
      concat_ws('', t.street_road_section, t.area, t.lane, t.alley, t.number) AS address,
      ST_X(t.geom) AS lon,
      ST_Y(t.geom) AS lat,
      ST_Distance(t.geom::geography, (SELECT pt FROM center)::geography) AS meters,
      ${pointMetersColumn(nearestSql, "t.geom")} AS meters_point
    FROM doorplate t
    WHERE t.geom IS NOT NULL
      AND ${nearestSql.prefilter("t.geom", baseMeters)}
      AND ${nearestSql.within("t.geom", baseMeters)}
    ORDER BY t.geom <-> (SELECT pt FROM center)
    LIMIT ${DOORPLATE_NEAREST_N}
  `;

  const [countRes, nearestRes] = await Promise.all([
    repo.query<{ n: number | string }>(doorplateCountSql, countSql.params),
    repo.query<{
      address: string;
      lon: number;
      lat: number;
      meters: number;
      meters_point: number | null;
    }>(doorplateNearestSql, nearestSql.params),
  ]);

  // Resolve the reported center coordinates for the response.
  const centerSql = areaSqlFor(area);
  const centerRes = await repo.query<{ lon: number; lat: number }>(
    `${centerSql.with()} SELECT ST_X(pt) AS lon, ST_Y(pt) AS lat FROM center`,
    centerSql.params,
  );
  const centerRow = centerRes.rows[0]!;

  const nlscHits = await nlscPromise;

  const rawFacilities: FacilityHit[] = [
    ...facilityRows.rows.map((r) => ({
      kind: r.kind,
      name: r.name ?? null,
      lon: Number(r.lon),
      lat: Number(r.lat),
      metersToCenter: Math.round(Number(r.meters)),
      ...pointMeters(r.meters_point),
    })),
    ...poisRows.rows.map((r) => ({
      kind: CATEGORY_KIND_ZH[r.category] ?? r.category,
      category: r.category,
      name: r.name ?? null,
      lon: Number(r.lon),
      lat: Number(r.lat),
      metersToCenter: Math.round(Number(r.meters)),
      ...pointMeters(r.meters_point),
    })),
    // NLSC live-API hits (殯葬/加油站/醫療/文教). Empty if disabled or network failed.
    ...nlscHits,
  ];

  // Collapse duplicates (mainly bus stops: one row per route at the same 站位), then sort
  // by distance so the flat list is globally nearest-first.
  const facilities = dedupeFacilities(rawFacilities).sort(
    (a, b) => a.metersToCenter - b.metersToCenter,
  );

  return {
    area: {
      kind: area.kind,
      center: { lon: Number(centerRow.lon), lat: Number(centerRow.lat) },
      ...(area.point ? { point: { lon: area.point[0], lat: area.point[1] } } : {}),
      ...(area.kind === "radius"
        ? {
            ...(area.centerRing ? { centerFrom: "polygon" as const } : {}),
            radiusMeters: area.radiusMeters,
            maxRadiusMeters: area.maxRadiusMeters,
            ...(area.categoryRadii
              ? { categoryRadii: Object.fromEntries(area.categoryRadii) }
              : {}),
          }
        : {}),
    },
    facilities,
    byCategory: buildByCategory(facilities),
    doorplate: {
      count: Number(countRes.rows[0]!.n),
      nearest: nearestRes.rows.map((r) => ({
        address: r.address,
        lon: Number(r.lon),
        lat: Number(r.lat),
        metersToCenter: Math.round(Number(r.meters)),
        ...pointMeters(r.meters_point),
      })),
    },
  };
}

export { DOORPLATE_NEAREST_N, STATION_TABLES };
