import L from "leaflet";
import { isPointInPolygon, type LngLat } from "./pointInPolygon";

export const NLSC_EMAP_URL =
  "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}";
export const NLSC_LANDSECT_URL =
  "https://wmts.nlsc.gov.tw/wmts/LANDSECT/default/GoogleMapsCompatible/{z}/{y}/{x}";
export const NLSC_LAND_OPENDATA_URL =
  "https://wmts.nlsc.gov.tw/wmts/LAND_OPENDATA/default/GoogleMapsCompatible/{z}/{y}/{x}";
export const NLSC_ATTRIBUTION = "內政部國土測繪中心 通用版電子地圖／段籍圖";
export const NLSC_LAND_OPENDATA_ATTRIBUTION =
  "內政部國土測繪中心 公有土地地籍圖（僅涵蓋公有地，私有地地號界線未含）";
export const ZONING_ATTRIBUTION =
  "新北市政府城鄉發展局｜都市計畫土地使用分區資料（新北市政府資料開放平臺）";

// 全新北市使用分區資料只有一份（不分行政區），優先打 Lambda 依座標篩選附近範圍；
// 沒設定 API 或連不上時，退回本地簡化版全市檔案＋前端篩選，確保現場斷線也能動
export const ZONING_API_BASE_URL: string | undefined = import.meta.env
  .VITE_ZONING_API_URL as string | undefined;
export const ZONING_FALLBACK_URL = "/data/zoning/ntpc-zoning.geojson";
const ZONING_QUERY_RADIUS_METERS = 1500;

// 真實 Lambda API 端點（新北市使用分區查詢，依座標半徑回傳 ZONE 面資料）
// 值來自環境變數（每個環境的 Lambda URL 可能不同），見 .env.development VITE_ZONING_LAMBDA_URL
export const ZONING_LAMBDA_URL: string | undefined = import.meta.env
  .VITE_ZONING_LAMBDA_URL as string | undefined;

export function buildZoningApiUrl(center: LatLng): string | null {
  if (!ZONING_API_BASE_URL) return null;
  const url = new URL(ZONING_API_BASE_URL);
  url.searchParams.set("lat", String(center.lat));
  url.searchParams.set("lng", String(center.lng));
  url.searchParams.set("radius", String(ZONING_QUERY_RADIUS_METERS));
  return url.toString();
}

// 供本地 fallback 檔案用：只保留跟查詢範圍有重疊的 feature（bbox-overlap，不是「頂點落在範圍內」，
// 避免大面積分區整塊把查詢點包住、卻因為頂點都在範圍外而被漏篩掉）
export function nearbyFeatureFilter(center: LatLng) {
  const dLat = ZONING_QUERY_RADIUS_METERS / METERS_PER_DEG_LAT;
  const dLng =
    ZONING_QUERY_RADIUS_METERS /
    (METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const query = {
    minLng: center.lng - dLng,
    minLat: center.lat - dLat,
    maxLng: center.lng + dLng,
    maxLat: center.lat + dLat,
  };
  return (feature: GeoJSON.Feature<GeoJSON.Geometry>): boolean => {
    const bbox = geometryBbox(feature.geometry);
    if (!bbox) return false;
    return (
      bbox.minLng <= query.maxLng &&
      bbox.maxLng >= query.minLng &&
      bbox.minLat <= query.maxLat &&
      bbox.maxLat >= query.minLat
    );
  };
}

// 原始政府圖資裡混了 Point/LineString 等非面資料（雜訊，非分區面），只算面狀幾何的 bbox
const ZONING_COORD_DEPTH: Record<string, number> = {
  Polygon: 2,
  MultiPolygon: 3,
};

function geometryBbox(
  geometry: GeoJSON.Geometry,
): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  if (geometry.type === "GeometryCollection") {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    let found = false;
    for (const sub of geometry.geometries) {
      const b = geometryBbox(sub);
      if (!b) continue;
      found = true;
      minLng = Math.min(minLng, b.minLng);
      minLat = Math.min(minLat, b.minLat);
      maxLng = Math.max(maxLng, b.maxLng);
      maxLat = Math.max(maxLat, b.maxLat);
    }
    return found ? { minLng, minLat, maxLng, maxLat } : null;
  }

  const depth = ZONING_COORD_DEPTH[geometry.type];
  if (depth === undefined) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown, d: number) => {
    if (d === 0) {
      const [lng, lat] = coords as [number, number];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords as unknown[]) visit(c, d - 1);
  };
  visit((geometry as { coordinates: unknown }).coordinates, depth);
  return { minLng, minLat, maxLng, maxLat };
}

// 周邊設施（學校/公園/醫療/停車/公車站/金融/加油站/殯葬…）依座標半徑查詢；
// 沒設定 API 時，設施距離示意圖退回原本手動標示的示意資料，確保現場斷線也能動
export const FACILITIES_API_BASE_URL: string | undefined = import.meta.env
  .VITE_FACILITIES_API_URL as string | undefined;

// 真實 Lambda API 端點（新北市周邊設施查詢，依座標半徑回傳 facilities/byCategory/doorplate）
// CORS 問題已於 2026-09-12 確認修復（帶 Origin header 時只回單一 Access-Control-Allow-Origin，
// 值為 echo 回來的 Origin，並附 Vary: Origin），瀏覽器可正常呼叫。
// 值來自環境變數（每個環境的 Lambda URL 可能不同），見 .env.development VITE_FACILITIES_LAMBDA_URL
export const FACILITIES_LAMBDA_URL: string | undefined = import.meta.env
  .VITE_FACILITIES_LAMBDA_URL as string | undefined;

// 拉大到 4000m，讓國中/高中/大學/污水處理場等本來就分布較疏的設施類型也有機會查到
// 至少一筆；配合 fetchNearbyFacilities() 內「每個細項只留最近一筆」的篩選，半徑放大
// 不會讓資料暴增，只是讓遠一點但仍相關的設施有機會被找到。
export const FACILITIES_QUERY_RADIUS_METERS = 4000;

export function buildFacilitiesApiUrl(
  center: LatLng,
  radiusMeters: number = FACILITIES_QUERY_RADIUS_METERS,
  baseUrl: string | undefined = FACILITIES_API_BASE_URL,
): string | null {
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  url.searchParams.set("lon", String(center.lng));
  url.searchParams.set("lat", String(center.lat));
  url.searchParams.set("radius", String(radiusMeters));
  return url.toString();
}

// 依後端回傳的 kind 決定圖上圖示顏色與字符；未列出的 kind 用預設灰底樣式
export const FACILITY_KIND_STYLE: Record<
  string,
  { color: string; glyph: string }
> = {
  文教設施: { color: "#2E7D32", glyph: "學" },
  醫療設施: { color: "#C62828", glyph: "醫" },
  公園: { color: "#66BB6A", glyph: "園" },
  公車站: { color: "#12457B", glyph: "站" },
  停車場: { color: "#607D8B", glyph: "停" },
  金融機構: { color: "#00897B", glyph: "金" },
  加油站: { color: "#EF6C00", glyph: "油" },
  殯葬設施: { color: "#B7791F", glyph: "墓" },
};
export const FACILITY_DEFAULT_STYLE = { color: "#455A64", glyph: "設" };

export type LatLng = { lat: number; lng: number };

const METERS_PER_DEG_LAT = 111320;

// 以指定基準點為原點，用「向北/向東位移公尺數」換算概略經緯度
export function offsetLatLng(
  base: LatLng,
  northMeters: number,
  eastMeters: number,
): LatLng {
  const metersPerDegLng =
    METERS_PER_DEG_LAT * Math.cos((base.lat * Math.PI) / 180);
  return {
    lat: base.lat + northMeters / METERS_PER_DEG_LAT,
    lng: base.lng + eastMeters / metersPerDegLng,
  };
}

export function boundsFromCenter(
  center: LatLng,
  northMeters: number,
  eastMeters: number,
): [[number, number], [number, number]] {
  const ne = offsetLatLng(center, northMeters, eastMeters);
  const sw = offsetLatLng(center, -northMeters, -eastMeters);
  return [
    [sw.lat, sw.lng],
    [ne.lat, ne.lng],
  ];
}

// 金山老街街廓實際傾角，供圖上區段框旋轉對齊；量測自中正路／中山路街廓走向，非地政測量值
const BLOCK_ROTATION_DEG = -25;

function rotateOffset(
  northMeters: number,
  eastMeters: number,
  angleDeg: number,
): { north: number; east: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    north: northMeters * Math.cos(rad) - eastMeters * Math.sin(rad),
    east: northMeters * Math.sin(rad) + eastMeters * Math.cos(rad),
  };
}

// 以中心點為原點，依 BLOCK_ROTATION_DEG 旋轉出一個貼齊街廓走向的矩形四角（順時針列點，供 L.polygon 使用）
function rotatedRectCorners(
  center: LatLng,
  halfNorthMeters: number,
  halfEastMeters: number,
  angleDeg: number = BLOCK_ROTATION_DEG,
): [number, number][] {
  const corners: [number, number][] = [
    [halfNorthMeters, -halfEastMeters],
    [halfNorthMeters, halfEastMeters],
    [-halfNorthMeters, halfEastMeters],
    [-halfNorthMeters, -halfEastMeters],
  ].map(([n, e]) => {
    const rotated = rotateOffset(n, e, angleDeg);
    const point = offsetLatLng(center, rotated.north, rotated.east);
    return [point.lat, point.lng];
  });
  return corners;
}

// 區段 P002-00 概略範圍，已依街廓走向旋轉（供圖上疊加紅色區段範圍框；非精確地籍界線，僅供示意）
// 同步版本：直接返回 mock 邊界（用於列印和大多數互動式地圖）
export function getSectionBoundary(center: LatLng): [number, number][] {
  return rotatedRectCorners(center, 90, 200);
}

// 比較實例（參考圖上的「實例編號1」）示意位置：僅在使用者未於地點標記頁標記比較標的座標
// （comparisonForm.cases[0].latLng 缺值）時的備援位置，非真實座標
export function getComparableCaseMarker(center: LatLng) {
  return offsetLatLng(center, 170, 60);
}

// ── 使用分區配色：對照參考圖圖例，未列於圖例的分區（道路用地等）維持留白 ──
const ZONE_COLOR_RULES: {
  match: (zone: string) => boolean;
  color: string;
  legendLabel: string;
}[] = [
  {
    match: (z) => z.includes("第二種住宅"),
    color: "#FDE94A",
    legendLabel: "第二種住宅",
  },
  {
    match: (z) => z.includes("第一種住宅"),
    color: "#FFF59D",
    legendLabel: "第一種住宅",
  },
  {
    match: (z) => z.includes("第二種商業") || z.includes("商業"),
    color: "#EE1B23",
    legendLabel: "第二種商業",
  },
  {
    match: (z) => z.includes("市場用地"),
    color: "#F4802B",
    legendLabel: "市場用地",
  },
  {
    match: (z) => z.includes("學校用地"),
    color: "#C9A0DC",
    legendLabel: "學校用地",
  },
  {
    match: (z) => z.includes("機關用地"),
    color: "#2E6EB8",
    legendLabel: "機關用地",
  },
  {
    match: (z) => z.includes("公園"),
    color: "#8BC34A",
    legendLabel: "公園用地",
  },
  {
    match: (z) => z.includes("綠地"),
    color: "#A5D6A7",
    legendLabel: "綠地用地",
  },
  { match: (z) => z.includes("綠帶"), color: "#66BB6A", legendLabel: "綠帶" },
  {
    match: (z) => z.includes("廣場"),
    color: "#E91E8C",
    legendLabel: "廣場用地",
  },
  {
    match: (z) => z.includes("國民旅舍"),
    color: "#26C6DA",
    legendLabel: "國民旅舍區",
  },
  { match: (z) => z.includes("河川"), color: "#80DEEA", legendLabel: "河川區" },
  { match: (z) => z.includes("墓地"), color: "#9E9E9E", legendLabel: "墓地" },
];

export function zoneColor(zone: string | undefined): string | null {
  if (!zone) return null;
  const rule = ZONE_COLOR_RULES.find((r) => r.match(zone));
  return rule?.color ?? null;
}

export const ZONING_LEGEND = ZONE_COLOR_RULES.map((r) => ({
  color: r.color,
  label: r.legendLabel,
}));

// 找出「涵蓋指定點」的分區面，供區段框沿著實際分區界線描繪（取代人工旋轉矩形）
export function findZoneFeatureAt<P extends Record<string, unknown>>(
  geojson: GeoJSON.FeatureCollection<GeoJSON.Geometry, P>,
  point: LatLng,
): GeoJSON.Feature<GeoJSON.Geometry, P> | null {
  const p: GeoJSON.Position = [point.lng, point.lat];
  return (
    geojson.features.find((feature) =>
      geometryContainsPoint(feature.geometry, p),
    ) ?? null
  );
}

function geometryContainsPoint(
  geometry: GeoJSON.Geometry,
  point: GeoJSON.Position,
): boolean {
  if (geometry.type === "Polygon")
    return polygonCoordsContainPoint(geometry.coordinates, point);
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.some((coords) =>
      polygonCoordsContainPoint(coords, point),
    );
  return false;
}

function polygonCoordsContainPoint(
  coords: GeoJSON.Position[][],
  point: GeoJSON.Position,
): boolean {
  if (!ringContainsPoint(coords[0], point)) return false;
  for (let i = 1; i < coords.length; i++) {
    if (ringContainsPoint(coords[i], point)) return false; // 落在內環（洞）內，視為不屬於此面
  }
  return true;
}

function ringContainsPoint(
  ring: GeoJSON.Position[],
  [x, y]: GeoJSON.Position,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export type ZoningGeoJson = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  { ZONE?: string }
>;

const ZONING_API_TIMEOUT_MS = 4000;

// 依座標打 Lambda 篩選使用分區 API；沒設定或逾時/失敗就退回本地全市簡化檔（前端再篩一次附近範圍）
// 優先順序：① VITE_ZONING_API_URL（環境變數，可用於自行架設的後端）② ZONING_LAMBDA_URL（真實 Lambda）③ 本地檔案
export async function loadZoningGeoJson(
  center: LatLng,
): Promise<{ geojson: ZoningGeoJson; source: "api" | "fallback" }> {
  const apiUrl = buildZoningApiUrl(center);
  if (apiUrl) {
    try {
      const res = await fetch(apiUrl, {
        signal: AbortSignal.timeout(ZONING_API_TIMEOUT_MS),
      });
      if (res.ok) return { geojson: await res.json(), source: "api" };
    } catch {
      // 打不到 API，往下退回 Lambda
    }
  }

  if (ZONING_LAMBDA_URL) {
    try {
      const lambdaUrl = new URL(ZONING_LAMBDA_URL);
      lambdaUrl.searchParams.set("lat", String(center.lat));
      lambdaUrl.searchParams.set("lng", String(center.lng));
      lambdaUrl.searchParams.set("radius", String(ZONING_QUERY_RADIUS_METERS));
      const res = await fetch(lambdaUrl.toString(), {
        signal: AbortSignal.timeout(ZONING_API_TIMEOUT_MS),
      });
      if (res.ok) return { geojson: await res.json(), source: "api" };
    } catch {
      // Lambda 也打不到，往下退回本地檔案
    }
  }

  const res = await fetch(ZONING_FALLBACK_URL);
  if (!res.ok) throw new Error(`zoning fallback fetch failed: ${res.status}`);
  const geojson: ZoningGeoJson = await res.json();
  return {
    geojson: {
      ...geojson,
      features: geojson.features.filter(nearbyFeatureFilter(center)),
    },
    source: "fallback",
  };
}

// 地價區段（如 P002-00）本身不是政府公開資料，是主辦當天用文字描述臨時劃出來的範圍，
// 沒有一份「輸入 sectionId 查真實 polygon」的政府 API。依序嘗試：
// 1. 使用分區圖中「包含比準地座標」的那塊分區面，拿來當地價區段邊界的近似值
// 2. 失敗則回傳 null，呼叫端應退回人工旋轉矩形示意（getSectionBoundary）
export async function resolveSectionBoundary(center: LatLng): Promise<{
  feature: GeoJSON.Feature<GeoJSON.Geometry, { ZONE?: string }> | null;
  source: "zoning" | "synthetic";
}> {
  try {
    const { geojson } = await loadZoningGeoJson(center);
    const zoneFeature = findZoneFeatureAt(geojson, center);
    if (zoneFeature) return { feature: zoneFeature, source: "zoning" };
  } catch {
    // 使用分區圖也拿不到，往下退回人工示意矩形
  }

  return { feature: null, source: "synthetic" };
}

// 判斷一個點（如周邊設施座標）是否落在 resolveSectionBoundary() 解析出的區段邊界內；
// 用 pointInPolygon.ts 的射線法（單一外框，區段不挖洞，符合該工具的設計範圍）。
// feature 為 null（邊界未能解析，見 resolveSectionBoundary 的兩層備援）時回傳 null——
// 呼叫端不可把 null 當成「界外」直接編出距離文字，應維持既有「僅距離、不宣稱內外」的顯示，
// 避免在沒有真實邊界依據時，對地價區段內外做出無依據的判斷（呼應 boundary 未解析欄位一律
// 標示待確認、不得杜撰的既有慣例）。
export function isPointInSectionBoundary(
  point: LatLng,
  feature: GeoJSON.Feature<GeoJSON.Geometry, { ZONE?: string }> | null,
): boolean | null {
  if (!feature) return null;
  const target: LngLat = [point.lng, point.lat];
  const rings: LngLat[][] =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates[0] as LngLat[]]
      : feature.geometry.type === "MultiPolygon"
        ? feature.geometry.coordinates.map((poly) => poly[0] as LngLat[])
        : [];
  return rings.some((ring) => isPointInPolygon(target, ring));
}

// 圖釘樣式（水滴形＋字符），供比準地／比較標的等地點標記元件共用
export function pinIcon(color: string, glyph: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:9999px 9999px 9999px 0;transform:rotate(45deg);background:${color};box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(-45deg);color:white;font-size:10px;font-weight:700;font-family:sans-serif;">${glyph}</span>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

// 對照參考圖的說明方框（如「比準地」「實例編號1」），以留白框＋引線標示在圖上
export function calloutIcon(
  text: string,
  borderColor: string,
  align: "left" | "right" = "left",
) {
  const alignStyle = align === "left" ? "left:8px" : "right:8px";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:1px;height:1px;">
      <div style="position:absolute;${alignStyle};top:-10px;white-space:nowrap;background:white;border:1.5px solid ${borderColor};border-radius:2px;padding:3px 6px;font-size:9px;font-weight:700;font-family:sans-serif;color:${borderColor};box-shadow:0 1px 3px rgba(0,0,0,0.25);">${text}</div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}
