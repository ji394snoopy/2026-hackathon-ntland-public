// NLSC 環域分析 (MarkBufferAnlys) — keyless open API that, given a point + radius in
// metres, returns the facilities of one category inside that buffer, distance-sorted.
//
//   GET https://api.nlsc.gov.tw/other/MarkBufferAnlys/{code}/{lon}/{lat}/{radius}
//
// This is the source for the categories OSM/PostGIS doesn't own well: 殯葬/加油站 (dis),
// 醫療 (med) and 文教/學校 (edu). It's a LIVE upstream call, not a DB table — probes
// confirmed NLSC updates these, so we don't import them. (工商 `bus` is deliberately
// skipped: it returns raw company registrations, not the 業態 we want — those come from
// OSM instead.)
//
// The API only accepts a point + radius, never a polygon. So in polygon mode the caller
// queries with the polygon's centroid + a covering radius, then filters the returned
// points back down to those actually inside the ring (see pointInRing). Distances are
// measured to the same center every other facility uses, for a consistent response.
//
// Radius is per CATEGORY, supplied by the caller via `radiusFor` (see input.ts). One code
// can yield several categories (`dis` -> 殯葬 + 加油站), so we fetch once at the widest of
// them and trim each record back to its own category's radius. There is no built-in floor:
// ask for 300m and you get 300m — the caller decides, and `area.categoryRadii` in the
// response says what was actually applied.

import type { FacilityHit } from "./query.js";
import { CATEGORY_KIND_ZH } from "./taxonomy.js";

const BASE_URL = "https://api.nlsc.gov.tw/other/MarkBufferAnlys";

// Per-request timeout for a single NLSC category call. Kept short so a stalled upstream
// degrades gracefully (the DB-backed facilities still return) rather than hanging.
const NLSC_TIMEOUT_MS = Number(process.env.NLSC_TIMEOUT_MS ?? 8000);

// Which NLSC categories we pull, the 中文 label used in the response, and the marktype
// prefixes we keep. `dis` (鄰避) mixes 加油站 + 殯葬; we split it by marktype so a fuel
// station and a cemetery come back as distinct kinds instead of one blurry "鄰避".
interface NlscCategory {
  code: string; // NLSC path code
  /** Maps a record to our (kind, category); return null to drop the record. */
  classify: (marktype: string) => { kind: string; category: string } | null;
  /** Every category this code can produce — drives the fetch radius and the per-category trim. */
  outputs: string[];
}

// marktype → our category. Codes observed live (see 設施查詢對照表.md):
//   9350200 公墓, 9930203 納骨堂  -> 殯葬
//   9960203 加油站                -> 加油站
//   993xxxx (med) 醫療機構         -> 醫療
//   992xxxx (edu) 各級學校/圖書館  -> 文教
function disClassify(marktype: string): { kind: string; category: string } | null {
  if (marktype === "9350200" || marktype === "9930203")
    return { kind: CATEGORY_KIND_ZH.cemetery!, category: "cemetery" };
  if (marktype === "9960203") return { kind: CATEGORY_KIND_ZH.fuel!, category: "fuel" };
  return null; // other dis marktypes are out of scope for now
}

const NLSC_CATEGORIES: NlscCategory[] = [
  { code: "dis", classify: disClassify, outputs: ["cemetery", "fuel"] },
  {
    code: "med",
    classify: () => ({ kind: CATEGORY_KIND_ZH.medical!, category: "medical" }),
    outputs: ["medical"],
  },
  {
    code: "edu",
    classify: () => ({ kind: CATEGORY_KIND_ZH.education!, category: "education" }),
    outputs: ["education"],
  },
];

// One raw record from MarkBufferAnlys (fields we use). The API returns a JSON array of
// these, already ascending by `distance` (metres from the query point).
interface NlscRecord {
  lon: number;
  lat: number;
  marktype: string;
  name: string;
  distance: number;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// Fetch one category. A blank body or "[]" means "no facilities", not an error. Network /
// non-JSON failures throw so the caller can decide how loud to be (we swallow per-category
// failures in queryNlscFacilities so one dead endpoint doesn't sink the whole response).
async function fetchCategory(
  code: string,
  lon: number,
  lat: number,
  radiusMeters: number,
): Promise<NlscRecord[]> {
  // Radius is a path segment, so it has to be a whole number; never let a sub-metre radius
  // round down to 0 (which the upstream reads as "no buffer" and answers with nothing).
  const url = `${BASE_URL}/${code}/${lon}/${lat}/${Math.max(1, Math.round(radiusMeters))}`;
  // Bound the wait: NLSC can stall, and this is merged into a user-facing response. On
  // timeout we abort and let the per-category catch swallow it, so a slow endpoint degrades
  // to "no NLSC hits for that category" instead of hanging the whole facilities query.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NLSC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "ntland-hackathon/1.0", accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`MarkBufferAnlys/${code} failed (${res.status} ${res.statusText})`);
  }
  const text = (await res.text()).trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`MarkBufferAnlys/${code} returned non-JSON`);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      lon: toNumber(r.lon),
      lat: toNumber(r.lat),
      marktype: r.marktype == null ? "" : String(r.marktype),
      name: r.name == null ? "" : String(r.name),
      distance: toNumber(r.distance),
    }))
    .filter((r) => Number.isFinite(r.lon) && Number.isFinite(r.lat));
}

// Ray-casting point-in-polygon on a [lon,lat] ring. Used to trim NLSC's radius results
// down to a polygon area (the API can't take a polygon itself).
function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Haversine distance in metres — for the distance-to-center each hit reports. Kept local
// so nlsc.ts has no PostGIS dependency (the SQL layer measures its own distances).
function haversineMeters(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface NlscQuery {
  /** The point NLSC is queried at (radius center, or polygon centroid). */
  queryLon: number;
  queryLat: number;
  /** The point every hit's distance is measured to (same center as the SQL layer). */
  centerLon: number;
  centerLat: number;
  /**
   * The caller's second measuring point, when given — each hit also reports its distance to
   * it (`metersToPoint`), matching the SQL layer's ref_point CTE. Both or neither.
   */
  pointLon?: number;
  pointLat?: number;
  /**
   * Radius in metres for one of our categories ('cemetery' / 'fuel' / 'medical' /
   * 'education'). Radius mode gives each its own; polygon mode returns the covering radius
   * for all of them and lets `ring` do the trimming.
   */
  radiusFor: (category: string) => number;
  /** If set (polygon mode), results are trimmed to those inside this [lon,lat] ring. */
  ring?: [number, number][];
}

// Queries all NLSC categories concurrently and flattens them into FacilityHit[]. Per-
// category failures are swallowed (logged) so one dead endpoint doesn't fail the request;
// if the network is entirely down, this returns [] and the DB-backed facilities still go
// out. This keeps the demo resilient offline (only the NLSC slice is missing).
export async function queryNlscFacilities(q: NlscQuery): Promise<FacilityHit[]> {
  const perCategory = await Promise.all(
    NLSC_CATEGORIES.map(async (cat) => {
      // One fetch per code, at the widest radius its categories ask for; each record is
      // then trimmed to its own category's radius below.
      const limits = new Map(cat.outputs.map((c) => [c, q.radiusFor(c)]));
      const fetchRadius = Math.max(...limits.values());
      try {
        const records = await fetchCategory(cat.code, q.queryLon, q.queryLat, fetchRadius);
        const hits: FacilityHit[] = [];
        for (const r of records) {
          if (q.ring && !pointInRing(r.lon, r.lat, q.ring)) continue;
          const mapped = cat.classify(r.marktype);
          if (!mapped) continue;
          const meters = haversineMeters(q.centerLon, q.centerLat, r.lon, r.lat);
          // The over-fetch above can reach past this category's own radius (殯葬 at 3000m
          // drags 加油站 along); drop what this category didn't ask for, so `radius` means
          // what it says in the response.
          const limit = limits.get(mapped.category);
          if (limit !== undefined && meters > limit) continue;
          hits.push({
            kind: mapped.kind,
            category: mapped.category,
            name: r.name || null,
            lon: r.lon,
            lat: r.lat,
            metersToCenter: Math.round(meters),
            // Second distance, when the caller named a point. Membership above is decided
            // by the area alone, so this only ever adds a number — it never drops a hit.
            ...(q.pointLon !== undefined && q.pointLat !== undefined
              ? {
                  metersToPoint: Math.round(
                    haversineMeters(q.pointLon, q.pointLat, r.lon, r.lat),
                  ),
                }
              : {}),
          });
        }
        return hits;
      } catch (err) {
        console.error(
          `NLSC ${cat.code} skipped:`,
          err instanceof Error ? err.message : String(err),
        );
        return [];
      }
    }),
  );
  return perCategory.flat().sort((a, b) => a.metersToCenter - b.metersToCenter);
}
