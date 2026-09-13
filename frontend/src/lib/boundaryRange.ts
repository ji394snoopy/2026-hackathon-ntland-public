// 解析「沿OO街以北、OO巷以西、OO巷以南及OO巷以東之OO住宅區」這類地價區段四至文字描述，
// 並用真實街道路網資料（OpenStreetMap Nominatim + Overpass）算出 4 個角點座標。
//
// 這裡的角點是「以文字描述之街道，延伸其實際線型算出的交叉點」，不是政府公開的地籍界址資料——
// 地價區段本身就不是政府公開資料（見 officialMap.ts 的說明），這只是把主辦文字描述轉成可畫在
// 地圖上的近似範圍，仍應提醒使用者以正式圖資核對。

export type LatLng = { lat: number; lng: number };

export type BoundaryEdge = "north" | "south" | "east" | "west";

export type BoundarySegment = {
  street: string;
  edge: BoundaryEdge;
};

export type ParsedBoundaryText = {
  segments: BoundarySegment[];
  zoneType: string | null;
};

export type ResolvedCorner = {
  resolved: true;
  lat: number;
  lng: number;
  streets: [string, string];
  // 交叉點與兩條路「實際線型」的偏移量（公尺）；越小代表兩條路在地圖資料上确實相交/相鄰，
  // 越大代表是沿路線方向外推算出的交叉點，準確度較低
  overshootMeters: number;
};

// 查無街道或算不出交叉點時的角點：不是錯誤，而是「這個角點需要使用者在地圖上手動拖曳圖釘標示」
export type UnresolvedCorner = {
  resolved: false;
  streets: [string, string];
  reason: string;
};

export type BoundaryCorner = ResolvedCorner | UnresolvedCorner;

export type ResolvedBoundary = {
  corners: {
    sw: BoundaryCorner;
    se: BoundaryCorner;
    ne: BoundaryCorner;
    nw: BoundaryCorner;
  };
  // 四角形心，僅取「已解析出座標」的角點平均；四角都查無資料時為 null，呼叫端應退回地圖目前視角
  center: LatLng | null;
  zoneType: string | null;
};

export type CornerConfidence = "high" | "medium" | "low";

export function confidenceLabel(overshootMeters: number): CornerConfidence {
  if (overshootMeters <= 5) return "high";
  if (overshootMeters <= 30) return "medium";
  return "low";
}

// 方位字 → 該街道在區塊中扮演的邊：「以北」表示區域在該路以北，該路本身即是區塊的南側邊界，餘依此類推
const DIRECTION_TO_EDGE: Record<string, BoundaryEdge> = {
  北: "south",
  南: "north",
  東: "west",
  西: "east",
};

// 將「沿樹人街以北、長壽街21巷以西、啟智街14巷以南及樹德街136巷以東之第一種住宅區」
// 解析成 4 條邊 + 分區類別；格式不符（不是剛好東西南北各一條）回傳 null
export function parseBoundaryText(raw: string): ParsedBoundaryText | null {
  let text = raw.trim();
  if (!text) return null;
  text = text.replace(/^沿/, "");

  const parts = text
    .split(/、|及/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 4) return null;

  let zoneType: string | null = null;
  const lastIdx = parts.length - 1;
  const zoneSplit = parts[lastIdx].split("之");
  if (zoneSplit.length === 2) {
    parts[lastIdx] = zoneSplit[0].trim();
    zoneType = zoneSplit[1].trim();
  }

  const segments: BoundarySegment[] = [];
  for (const part of parts) {
    const m = part.match(/^(.+?)以(東|南|西|北)$/);
    if (!m) return null;
    const [, street, dir] = m;
    segments.push({ street: street.trim(), edge: DIRECTION_TO_EDGE[dir] });
  }

  const edgeSet = new Set(segments.map((s) => s.edge));
  if (edgeSet.size !== 4) return null; // 必須東西南北各一條，缺一或重複都視為格式不符

  return { segments, zoneType };
}

type NominatimResult = { lat: string; lon: string; boundingbox?: string[] };

async function fetchDistrictBBox(cityDistrict: string): Promise<{
  south: number;
  west: number;
  north: number;
  east: number;
} | null> {
  const params = new URLSearchParams({
    format: "json",
    q: cityDistrict,
    countrycodes: "tw",
    limit: "1",
  });
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
  );
  if (!res.ok) return null;
  const results: NominatimResult[] = await res.json();
  if (!results?.length) return null;
  const r = results[0];
  if (r.boundingbox && r.boundingbox.length === 4) {
    const [south, north, west, east] = r.boundingbox.map(Number);
    return { south, west, north, east };
  }
  // 查無明確行政區範圍框時，以查到的點外推約 3 公里當作搜尋範圍
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  return { south: lat - 0.03, north: lat + 0.03, west: lng - 0.03, east: lng + 0.03 };
}

type StreetWays = Record<string, LatLng[][]>;

function escapeOverpassString(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

async function fetchStreetWays(
  streetNames: string[],
  bbox: { south: number; west: number; north: number; east: number },
): Promise<StreetWays> {
  const uniqueNames = Array.from(new Set(streetNames));
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:25];(${uniqueNames
    .map((n) => `way["name"="${escapeOverpassString(n)}"](${bboxStr});`)
    .join("")});out geom;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`地圖路網查詢失敗（Overpass ${res.status}）`);
  const data: {
    elements: {
      tags?: { name?: string };
      geometry?: { lat: number; lon: number }[];
    }[];
  } = await res.json();

  const ways: StreetWays = {};
  for (const name of uniqueNames) ways[name] = [];
  for (const el of data.elements ?? []) {
    const name = el.tags?.name;
    const geometry = el.geometry;
    if (!name || !geometry?.length || !ways[name]) continue;
    ways[name].push(geometry.map((p) => ({ lat: p.lat, lng: p.lon })));
  }
  return ways;
}

// 兩條「無限延伸直線」的交點（把 lat/lng 當一般平面座標算，區塊範圍小，誤差可忽略）
function lineIntersect(
  p1: LatLng,
  p2: LatLng,
  p3: LatLng,
  p4: LatLng,
): LatLng | null {
  const x1 = p1.lng,
    y1 = p1.lat,
    x2 = p2.lng,
    y2 = p2.lat;
  const x3 = p3.lng,
    y3 = p3.lat,
    x4 = p4.lng,
    y4 = p4.lat;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-14) return null; // 平行線，無交點
  const a = x1 * y2 - y1 * x2;
  const b = x3 * y4 - y3 * x4;
  const px = (a * (x3 - x4) - (x1 - x2) * b) / denom;
  const py = (a * (y3 - y4) - (y1 - y2) * b) / denom;
  return { lat: py, lng: px };
}

const METERS_PER_DEG_LAT = 111320;

function pointToSegmentMeters(point: LatLng, a: LatLng, b: LatLng): number {
  const mPerDegLng = METERS_PER_DEG_LAT * Math.cos((point.lat * Math.PI) / 180);
  const toXY = (p: LatLng) => ({
    x: (p.lng - point.lng) * mPerDegLng,
    y: (p.lat - point.lat) * METERS_PER_DEG_LAT,
  });
  const P = toXY(point);
  const A = toXY(a);
  const B = toXY(b);
  const abx = B.x - A.x,
    aby = B.y - A.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = A.x + t * abx,
    cy = A.y + t * aby;
  return Math.hypot(P.x - cx, P.y - cy);
}

function distanceToPolyline(point: LatLng, way: LatLng[]): number {
  let min = Infinity;
  for (let i = 0; i < way.length - 1; i++) {
    const d = pointToSegmentMeters(point, way[i], way[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

// 在兩條路（各自可能不只一段 way）之間，找出「延伸線交點」中，離兩條路實際線型都最近的那個，
// 視為兩條路真正的交叉口；overshootMeters 是交點離兩條路實際線型的總偏移量
function bestIntersection(
  waysA: LatLng[][],
  waysB: LatLng[][],
): { point: LatLng; overshootMeters: number } | null {
  let best: { point: LatLng; overshootMeters: number } | null = null;
  for (const wa of waysA) {
    for (const wb of waysB) {
      for (let i = 0; i < wa.length - 1; i++) {
        for (let j = 0; j < wb.length - 1; j++) {
          const ip = lineIntersect(wa[i], wa[i + 1], wb[j], wb[j + 1]);
          if (!ip) continue;
          const score = distanceToPolyline(ip, wa) + distanceToPolyline(ip, wb);
          if (!best || score < best.overshootMeters) {
            best = { point: ip, overshootMeters: score };
          }
        }
      }
    }
  }
  return best;
}

// 主入口：解析後的四至文字 + 縣市行政區（用來限定搜尋範圍，避免同名街道撞到外縣市）
// → 呼叫 Nominatim/Overpass 抓路網、算出四個角點與形心
export async function resolveBoundary(
  parsed: ParsedBoundaryText,
  cityDistrict: string,
): Promise<ResolvedBoundary> {
  const bbox = await fetchDistrictBBox(cityDistrict);
  if (!bbox) {
    throw new Error(`查無「${cityDistrict}」的地理範圍，請確認縣市／行政區是否正確`);
  }

  const byEdge = {} as Record<BoundaryEdge, string>;
  for (const seg of parsed.segments) byEdge[seg.edge] = seg.street;

  const ways = await fetchStreetWays(Object.values(byEdge), bbox);

  // 查無街道或算不出交叉點時，不整體判失敗——回傳該角點為 unresolved，
  // 讓查得到的角點照常顯示，查不到的留給使用者在地圖上手動 pin
  const buildCorner = (edgeA: BoundaryEdge, edgeB: BoundaryEdge): BoundaryCorner => {
    const streetA = byEdge[edgeA];
    const streetB = byEdge[edgeB];
    const streets: [string, string] = [streetA, streetB];
    const missing = streets.filter((s) => !ways[s]?.length);
    if (missing.length) {
      return {
        resolved: false,
        streets,
        reason: `在「${cityDistrict}」查無「${missing.join("」、「")}」，請確認街道名稱、門牌巷弄是否正確，或在地圖上手動標示此角點`,
      };
    }
    const result = bestIntersection(ways[streetA], ways[streetB]);
    if (!result) {
      return {
        resolved: false,
        streets,
        reason: `「${streetA}」與「${streetB}」算不出交叉點，請確認這兩條路是否確實相鄰，或在地圖上手動標示此角點`,
      };
    }
    return {
      resolved: true,
      lat: result.point.lat,
      lng: result.point.lng,
      streets,
      overshootMeters: result.overshootMeters,
    };
  };

  const sw = buildCorner("south", "west");
  const se = buildCorner("south", "east");
  const ne = buildCorner("north", "east");
  const nw = buildCorner("north", "west");

  const resolvedCorners = [sw, se, ne, nw].filter(
    (c): c is ResolvedCorner => c.resolved,
  );
  const center: LatLng | null = resolvedCorners.length
    ? {
        lat:
          resolvedCorners.reduce((sum, c) => sum + c.lat, 0) /
          resolvedCorners.length,
        lng:
          resolvedCorners.reduce((sum, c) => sum + c.lng, 0) /
          resolvedCorners.length,
      }
    : null;

  return { corners: { sw, se, ne, nw }, center, zoneType: parsed.zoneType };
}
