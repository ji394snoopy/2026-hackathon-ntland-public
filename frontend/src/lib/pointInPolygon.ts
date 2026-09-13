/**
 * 判斷目標點是否落在區段（多邊形）範圍內。
 *
 * 座標格式一律 [lng, lat]（經度在前、緯度在後，與 GeoJSON / OSRM 一致）。
 */

// 座標格式：[lng, lat]
export type LngLat = [number, number];

// 浮點誤差容忍值。經緯度以度為單位，1e-12 度約 0.1 微米，
// 只用來吸收 JSON 來回轉換造成的尾數誤差，不會把真正在界外的點誤判成界上。
const EPSILON = 1e-12;

/**
 * 目標點是否在區段內。
 *
 * 採射線法（ray casting）：從目標點往 +x 方向射一條水平線，計算與各邊的交點數，
 * 奇數為內、偶數為外。可處理凹多邊形，但不處理內環（洞）——區段是單一外框，
 * 需要挖洞請用 officialMap.ts 的 findZoneFeatureAt。
 *
 * @param target 目標點 [lng, lat]
 * @param shape 區段頂點 [[lng, lat], [lng, lat], ...]，頭尾閉合與否皆可（會自動接回第一點）
 * @returns 內 true、外 false。點剛好落在邊上或頂點上視為內（true）；
 *   頂點少於 3 個（無法構成面）一律回傳 false。
 */
export function isPointInPolygon(target: LngLat, shape: LngLat[]): boolean {
  if (!Array.isArray(shape) || shape.length < 3) return false;

  const [x, y] = target;
  let inside = false;

  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const [xi, yi] = shape[i];
    const [xj, yj] = shape[j];

    // 先判界上：射線法對邊界的結果不穩定（同一條邊在不同頂點順序下可能算進也可能算出），
    // 所以界上的點直接短路回 true，不交給下面的交點計數。
    if (isOnSegment(x, y, xi, yi, xj, yj)) return true;

    // (yi > y) !== (yj > y) 確保每條邊只在「跨過射線」時計一次，
    // 且上端點計、下端點不計，避免射線穿過頂點時被重複計算兩次。
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

// 點 (px, py) 是否落在線段 (x1,y1)-(x2,y2) 上（含兩端點）
function isOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  // 外積為 0 表示三點共線
  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  if (Math.abs(cross) > EPSILON) return false;
  // 共線後再確認落在線段的範圍內，而不是延長線上
  return (
    px >= Math.min(x1, x2) - EPSILON &&
    px <= Math.max(x1, x2) + EPSILON &&
    py >= Math.min(y1, y2) - EPSILON &&
    py <= Math.max(y1, y2) + EPSILON
  );
}
