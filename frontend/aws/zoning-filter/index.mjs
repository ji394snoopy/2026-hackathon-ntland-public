import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))

// 冷啟動時讀一次、快取在執行環境裡；warm invocation 不重讀
const geojson = JSON.parse(
  readFileSync(join(__dirname, "zoning-data.geojson"), "utf-8"),
)

// 每個 feature 預先算好 bbox，查詢時只做數字比較，不用每次重新掃座標；
// 原始資料裡混了 Point/LineString 等非面資料（約 0.35%，判斷應為圖資雜訊），不列入索引直接跳過
const COORD_DEPTH = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
}
const POLYGONAL_TYPES = new Set(["Polygon", "MultiPolygon"])

const indexed = geojson.features
  .map((feature) => ({ feature, bbox: computeBbox(feature.geometry) }))
  .filter((item) => item.bbox !== null)

function computeBbox(geometry) {
  if (!geometry) return null
  if (geometry.type === "GeometryCollection") {
    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity
    let found = false
    for (const sub of geometry.geometries) {
      if (!POLYGONAL_TYPES.has(sub.type)) continue
      const b = computeBbox(sub)
      if (!b) continue
      found = true
      minLng = Math.min(minLng, b.minLng)
      minLat = Math.min(minLat, b.minLat)
      maxLng = Math.max(maxLng, b.maxLng)
      maxLat = Math.max(maxLat, b.maxLat)
    }
    return found ? { minLng, minLat, maxLng, maxLat } : null
  }

  if (!POLYGONAL_TYPES.has(geometry.type)) return null

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const visit = (coords, depth) => {
    if (depth === 0) {
      const [lng, lat] = coords
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      return
    }
    for (const c of coords) visit(c, depth - 1)
  }

  visit(geometry.coordinates, COORD_DEPTH[geometry.type])

  return { minLng, minLat, maxLng, maxLat }
}

const METERS_PER_DEG_LAT = 111320

function queryBbox(lat, lng, radiusMeters) {
  const dLat = radiusMeters / METERS_PER_DEG_LAT
  const dLng =
    radiusMeters / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  return {
    minLng: lng - dLng,
    minLat: lat - dLat,
    maxLng: lng + dLng,
    maxLat: lat + dLat,
  }
}

function bboxIntersects(a, b) {
  return (
    a.minLng <= b.maxLng &&
    a.maxLng >= b.minLng &&
    a.minLat <= b.maxLat &&
    a.maxLat >= b.minLat
  )
}

// CORS headers 交給 Function URL 原生的 --cors 設定處理（deploy.sh 裡有設），
// 這裡不要重複加 Access-Control-Allow-Origin，兩邊都加會變成同一個 response 有兩個
// Access-Control-Allow-Origin header，不符合 CORS 規範，嚴格一點的瀏覽器會直接判失敗
const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
}

const DEFAULT_RADIUS_METERS = 1500
const MAX_RADIUS_METERS = 5000

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? "GET"
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" }
  }

  const q = event.queryStringParameters ?? {}
  const lat = Number(q.lat)
  const lng = Number(q.lng)
  const radius = Math.min(
    Number(q.radius) || DEFAULT_RADIUS_METERS,
    MAX_RADIUS_METERS,
  )

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      statusCode: 400,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: "lat/lng query params required" }),
    }
  }

  const qbbox = queryBbox(lat, lng, radius)
  const features = indexed
    .filter((item) => bboxIntersects(item.bbox, qbbox))
    .map((item) => item.feature)

  return {
    statusCode: 200,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({ type: "FeatureCollection", features }),
  }
}
