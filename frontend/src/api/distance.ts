// 距離計算 API 串接
//
// 有些距離不採用「直線距離」，而是實際「步行距離（步距）」，
// 透過 OSRM（OpenStreetMap 提供的 routed-foot 服務）計算兩點間的步行路徑距離。
//
// 服務端點範例：
// https://routing.openstreetmap.de/routed-foot/route/v1/foot/{lng},{lat};{lng},{lat}?overview=false&alternatives=true&steps=true

// 座標格式：[lng, lat]（經度在前、緯度在後，與 OSRM / GeoJSON 一致）
export type Coordinate = [number, number];

// OSRM 回傳的部分結構（僅取本 API 需要的欄位）
type OsrmRoute = {
  distance: number; // 公尺
  duration: number; // 秒
};

type OsrmResponse = {
  code: string; // "Ok" 表示成功
  routes?: OsrmRoute[];
  message?: string;
};

export type WalkingDistanceResult = {
  distanceMeters: number; // 步行距離（公尺）
  durationSeconds: number; // 步行時間（秒）
};

const OSRM_FOOT_BASE_URL =
  "https://routing.openstreetmap.de/routed-foot/route/v1/foot";

const OSRM_TIMEOUT_MS = 8000;

function toCoordString(coord: Coordinate): string {
  const [lng, lat] = coord;
  return `${lng},${lat}`;
}

// 官方政策（被擋時 OSRM 回的頁面明講）：demo 服務每秒最多 1 個請求，不能重度使用。
// 先前試過「2 併發／每批間隔 1 秒」（約 2 req/s），實測仍偶爾會失敗（見使用者截圖，
// 一批請求裡穿插紅色失敗）。這裡改回真正序列化（併發=1），且間隔拉到 2 秒，
// 比官方講的「每秒 1 次」更保守，換取穩定度。
const MAX_CONCURRENT_OSRM_REQUESTS = 1;
const BATCH_INTERVAL_MS = 2000;
let activeOsrmRequests = 0;
const osrmQueue: Array<(acquiredAt: number) => void> = [];

function acquireOsrmSlot(): Promise<number> {
  if (activeOsrmRequests < MAX_CONCURRENT_OSRM_REQUESTS) {
    activeOsrmRequests++;
    return Promise.resolve(Date.now());
  }
  return new Promise((resolve) => {
    osrmQueue.push((acquiredAt) => {
      activeOsrmRequests++;
      resolve(acquiredAt);
    });
  });
}

// 名額至少握滿 BATCH_INTERVAL_MS 才真正釋出，即使該請求本身很快就回來了，
// 避免下一個（含重試）提前插進來，變相又打成連續不間斷的請求流。
function releaseOsrmSlot(acquiredAt: number): void {
  const wait = Math.max(0, BATCH_INTERVAL_MS - (Date.now() - acquiredAt));
  setTimeout(() => {
    activeOsrmRequests--;
    const next = osrmQueue.shift();
    if (next) next(Date.now());
  }, wait);
}

// 同一組座標（如反覆重新整理同一筆勘查表）不重複打 OSRM；只快取成功結果，
// 失敗（逾時/被擋）不快取，讓下一次呼叫仍有機會重試，不會把暫時性失敗記成永久值。
const distanceCache = new Map<string, WalkingDistanceResult>();

// 單次嘗試：排隊拿到名額才真正發出請求。回傳 "retry" 代表是暫時性問題（逾時、
// 網路錯誤、非 2xx、429）值得重試；回傳 null 代表 OSRM 明確算出「無路徑」，
// 是確定性結果，重試不會有不同答案，不算進 retry 次數也不用再試。
async function fetchOsrmOnce(
  url: string,
): Promise<WalkingDistanceResult | null | "retry"> {
  const acquiredAt = await acquireOsrmSlot();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn("[distance] OSRM 查詢失敗，將重試", res.status, url);
      return "retry";
    }
    const data = (await res.json()) as OsrmResponse;
    if (data.code !== "Ok" || !data.routes?.length) {
      console.warn("[distance] OSRM 無可用路徑（非暫時性，不重試）", data.code, data.message);
      return null;
    }
    const route = data.routes[0];
    return {
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
    };
  } catch (err) {
    console.warn("[distance] OSRM 查詢發生錯誤，將重試", err);
    return "retry";
  } finally {
    releaseOsrmSlot(acquiredAt);
  }
}

/**
 * 計算兩點間的步行距離（步距），使用 OSRM routed-foot 服務。
 *
 * @param coordinates 至少兩個座標點 [[lng, lat], [lng, lat], ...]，
 *   多於兩點時會依序當作途經點計算整條路徑的步行距離。
 * @returns 步行距離（公尺）與時間（秒）；查詢失敗或無路徑時回傳 null。
 */
export async function fetchWalkingDistance(
  coordinates: Coordinate[],
): Promise<WalkingDistanceResult | null> {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    console.warn("[distance] 至少需要兩個座標點才能計算步行距離", coordinates);
    return null;
  }

  const cacheKey = coordinates.map(toCoordString).join(";");
  const cached = distanceCache.get(cacheKey);
  if (cached) return cached;

  const url =
    `${OSRM_FOOT_BASE_URL}/${cacheKey}` +
    `?overview=false&alternatives=false&steps=false`;

  // 每次嘗試（含重試）都重新排隊，靠 acquireOsrmSlot/releaseOsrmSlot 的 2 秒節奏
  // 自然間隔開，不會失敗後立刻連續重打。
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchOsrmOnce(url);
    if (result === "retry") {
      if (attempt < MAX_ATTEMPTS) continue;
      console.warn("[distance] OSRM 重試多次仍失敗，改用直線距離", url);
      return null;
    }
    if (result) distanceCache.set(cacheKey, result);
    return result;
  }
  return null;
}
