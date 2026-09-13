import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"

// 範例 zoning-filter Lambda(CDK 版)。
//
// 邏輯與 frontend/aws/zoning-filter/index.mjs 相同:收到 lat/lng,從全市使用分區
// 資料裡用 bbox 篩出附近範圍回傳。唯一差別是「資料來源」——這裡不再把 88MB geojson
// 塞進部署包,而是冷啟動時從 AssetStack 的 S3 讀一次、快取在執行環境裡,warm
// invocation 不重讀。bucket / key 由 CDK 以環境變數注入。

const BUCKET = process.env.ZONING_DATA_BUCKET
const KEY = process.env.ZONING_DATA_KEY
const REGION = process.env.AWS_REGION

const s3 = new S3Client({ region: REGION })

const COORD_DEPTH = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
}
const POLYGONAL_TYPES = new Set(["Polygon", "MultiPolygon"])

// 冷啟動時只讀一次 + 建 bbox 索引,快取在模組層級。用 promise 快取避免同一個
// 容器內併發呼叫時重複下載。
let indexedPromise = null

async function loadIndexed() {
  if (!BUCKET || !KEY) {
    throw new Error("ZONING_DATA_BUCKET / ZONING_DATA_KEY env vars are required")
  }
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }))
  const text = await res.Body.transformToString("utf-8")
  const geojson = JSON.parse(text)

  // 每個 feature 預先算好 bbox,查詢時只做數字比較。原始資料混了 Point/LineString
  // 等非面資料(約 0.35%,判斷為圖資雜訊),不列入索引直接跳過。
  return geojson.features
    .map((feature) => ({ feature, bbox: computeBbox(feature.geometry) }))
    .filter((item) => item.bbox !== null)
}

function getIndexed() {
  if (!indexedPromise) indexedPromise = loadIndexed()
  return indexedPromise
}

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

// CORS 交給 Function URL 原生 CORS 設定(CDK 的 FunctionUrl cors 屬性),這裡只回
// content-type,避免 Access-Control-Allow-Origin 重複。
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

  let indexed
  try {
    indexed = await getIndexed()
  } catch (err) {
    console.error("failed to load zoning data:", err)
    // 讀失敗時清掉快取的 promise,讓下一次呼叫重試,而不是永久卡住。
    indexedPromise = null
    return {
      statusCode: 502,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: "zoning data unavailable" }),
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
