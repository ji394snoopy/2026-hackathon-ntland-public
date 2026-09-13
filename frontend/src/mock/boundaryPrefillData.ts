/**
 * 比準地／比較標的1~3 四至範圍的預填資料（新北市樹林區真實案例）。
 *
 * 座標為透過 lib/boundaryRange.ts 對照 OpenStreetMap 路網解析「四至文字」得到的結果
 * （比準地西南、東南角原本查無「啟智街187巷24弄」，之後經人工現場確認補上座標），
 * 先算好寫死在這裡，避免每次開啟頁面都要重打 Nominatim/Overpass。
 */

import type { BoundaryPinValue } from "../components/BoundaryRangeMap";

type BoundaryLocationRole =
  | "benchmark"
  | "comparison1"
  | "comparison2"
  | "comparison3";

const CITY = "新北市";
const DISTRICT = "樹林區";

/**
 * 比準地：沿八德街以西、啟智街以南、啟智街187巷以東、啟智街187巷24弄以北
 * 西南角、東南角查無「啟智街187巷24弄」，暫以東北/西北角中點當待確認位置
 */
export const BENCHMARK_BOUNDARY_PREFILL: BoundaryPinValue = {
  city: CITY,
  district: DISTRICT,
  text: "沿八德街以西、啟智街以南、啟智街187巷以東、啟智街187巷24弄以北",
  zoneType: null,
  corners: [
    { lat: 24.987254, lng: 121.415298 }, // 西南角（啟智街187巷24弄×啟智街187巷）
    { lat: 24.987434, lng: 121.415582 }, // 東南角（啟智街187巷24弄×八德街）
    { lat: 24.987011, lng: 121.415883 }, // 東北角（啟智街×八德街）
    { lat: 24.986812, lng: 121.415657 }, // 西北角（啟智街×啟智街187巷）
  ],
  lat: 24.987344,
  lng: 121.415334,
  cornerPending: [false, false, false, false],
};

/**
 * 比較標的1：沿樹人街以北、長壽街21巷以西、啟智街14巷以南及樹德街136巷以東
 */
export const COMPARISON1_BOUNDARY_PREFILL: BoundaryPinValue = {
  city: CITY,
  district: DISTRICT,
  text: "沿樹人街以北、長壽街21巷以西、啟智街14巷以南及樹德街136巷以東之第一種住宅區",
  zoneType: null,
  corners: [
    { lat: 24.994014, lng: 121.419786 }, // 西南角（樹人街×樹德街136巷）— 高信心
    { lat: 24.993455, lng: 121.420936 }, // 東南角（樹人街×長壽街21巷）— 中等信心，偏移約20公尺
    { lat: 24.993855, lng: 121.421227 }, // 東北角（啟智街14巷×長壽街21巷）— 中等信心，偏移約15公尺
    { lat: 24.994526, lng: 121.420205 }, // 西北角（啟智街14巷×樹德街136巷）— 低信心（外推），偏移約53公尺
  ],
  lat: 24.993829,
  lng: 121.42112,
  cornerPending: [false, false, false, false],
};

/**
 * 比較標的2：沿東榮街以北、鎮前街411巷1弄以南、東榮街88巷以東、鎮前街367巷以西
 */
export const COMPARISON2_BOUNDARY_PREFILL: BoundaryPinValue = {
  city: CITY,
  district: DISTRICT,
  text: "沿東榮街以北、鎮前街411巷1弄以南、東榮街88巷以東、鎮前街367巷以西之第一種住宅區",
  zoneType: null,
  corners: [
    { lat: 24.982568, lng: 121.416059 }, // 西南角（東榮街×東榮街88巷）— 高信心
    { lat: 24.98286, lng: 121.416627 }, // 東南角（東榮街×鎮前街367巷）— 高信心
    { lat: 24.983501, lng: 121.416243 }, // 東北角（鎮前街411巷1弄×鎮前街367巷）— 高信心
    { lat: 24.983221, lng: 121.415679 }, // 西北角（鎮前街411巷1弄×東榮街88巷）— 高信心
  ],
  lat: 24.982969,
  lng: 121.416146,
  cornerPending: [false, false, false, false],
};

/**
 * 比較標的3：沿潭興街以西、潭興街107巷21弄以東及以北、潭興街91巷以南之第一種住宅區
 */
export const COMPARISON3_BOUNDARY_PREFILL: BoundaryPinValue = {
  city: CITY,
  district: DISTRICT,
  text: "沿潭興街以西、潭興街107巷21弄以東及以北、潭興街91巷以南之第一種住宅區",
  zoneType: "第一種住宅區",
  corners: [
    { lat: 24.99799, lng: 121.424525 }, // 西南角（潭興街107巷21弄×潭興街107巷21弄）— 高信心
    { lat: 24.998563, lng: 121.423684 }, // 東南角（潭興街107巷21弄×潭興街）— 高信心
    { lat: 24.998968, lng: 121.424064 }, // 東北角（潭興街91巷×潭興街）— 高信心
    { lat: 24.998476, lng: 121.424723 }, // 西北角（潭興街91巷×潭興街107巷21弄）— 高信心
  ],
  lat: 24.998425,
  lng: 121.424017,
  cornerPending: [false, false, false, false],
};

export function getBoundaryPrefillByRole(
  role: BoundaryLocationRole,
): BoundaryPinValue {
  switch (role) {
    case "benchmark":
      return BENCHMARK_BOUNDARY_PREFILL;
    case "comparison1":
      return COMPARISON1_BOUNDARY_PREFILL;
    case "comparison2":
      return COMPARISON2_BOUNDARY_PREFILL;
    case "comparison3":
      return COMPARISON3_BOUNDARY_PREFILL;
  }
}
