/**
 * 根據使用分區(使用地類別) 推導用地別
 * 使用分區 → 用地別 的對應關係
 */

export function deriveZoneTypeFromLandUseType(
  landUseType: string,
): string | null {
  // 根據用地別推導預設分區（僅用於初始化時決定預設値，實際值由表1填寫决定）
  const mapping: Record<string, string> = {
    商業用地: "第二種商業區",
    住宅用地: "第二種住宅區",
    工業用地: "第二種工業區",
    農業用地: "農業區",
  };
  return mapping[landUseType] || null;
}

export function deriveLandUseTypeFromZoneType(zoneType: string): string {
  // 根據使用分區推導用地別
  const mapping: Record<string, string> = {
    第一種住宅區: "住宅用地",
    第二種住宅區: "住宅用地",
    第三種住宅區: "住宅用地",
    第一種商業區: "商業用地",
    第二種商業區: "商業用地",
    第一種工業區: "工業用地",
    第二種工業區: "工業用地",
    工業區: "工業用地",
    農業區: "農業用地",
    保護區: "其他",
    特定專用區: "其他",
    其他: "其他",
  };
  return mapping[zoneType] || "其他";
}

export type RegionalAnalysisPurpose =
  | "agricultural"
  | "commercial"
  | "industrial"
  | "other"
  | "residential";

// H2 · fill-regional-analysis 依 purpose 選範本（見 API_REFERENCE.md §H2），跟前端的
// 用地別中文標籤不同體系，export-report 前要轉換一次。
export function landUseTypeToPurpose(landUseType: string): RegionalAnalysisPurpose {
  const mapping: Record<string, RegionalAnalysisPurpose> = {
    住宅用地: "residential",
    商業用地: "commercial",
    工業用地: "industrial",
    農業用地: "agricultural",
    其他: "other",
  };
  return mapping[landUseType] ?? "other";
}
