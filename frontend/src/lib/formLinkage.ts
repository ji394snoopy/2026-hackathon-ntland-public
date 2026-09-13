import type { ComparisonCondition, FieldReference, RegionalFactorRow, SurveyField } from "../types"

// 表3 勘查表欄位 key → 表5 區域因素項目 key / 表4 comparisonForm.benchmark 欄位 的唯一對照表。
// 取代原本分散在 api/index.ts 裡的 REGIONAL_FACTOR_FACILITY_KIND / SURVEY_FACILITY_KIND 片段，
// 讓「AI 產製時的即時查詢」與「使用者手動編輯表3」走同一套推導邏輯，避免三表數字各自漂移。
//
// comparisonField 只有在該項目跟 ComparisonCondition 有對應時才填；沒有的話該欄位只連到表5（或都不連）。
type FacilityField = "school" | "market" | "park" | "station" | "disamenity"
type SingleField = "roadWidth" | "terrain" | "zoning" | "coverageRatio" | "plotRatio" | "buildRestriction"

type LinkageSpec = {
  regionalFactorKey?: string
  comparisonField?: FacilityField | SingleField
}

export const SURVEY_LINKAGE: Record<string, LinkageSpec> = {
  // school_r 已移除（見 lib/regionalFactorGroups.ts「其他影響因素(8)」說明）：這裡只保留
  // comparisonField，表3↔表4「接近學校之程度」的比準地同步跟表5的等級查表是兩件事，不能連坐刪。
  school: { comparisonField: "school" },
  market: { regionalFactorKey: "market_r", comparisonField: "market" },
  park: { regionalFactorKey: "park_r", comparisonField: "park" },
  bus_stop: { regionalFactorKey: "bus_r", comparisonField: "station" },
  cemetery: { regionalFactorKey: "cemetery_r", comparisonField: "disamenity" },
  road_avg_width: { regionalFactorKey: "road_r", comparisonField: "roadWidth" },
  terrain: { regionalFactorKey: "terrain_r", comparisonField: "terrain" },
  interchange: { regionalFactorKey: "interchange_r" },
  drainage: { regionalFactorKey: "drain_r" },
  air_pollution: { regionalFactorKey: "air_r" },
  customer_flow: { regionalFactorKey: "customer_flow_r" },
  zone_type: { comparisonField: "zoning" },
  coverage_ratio: { comparisonField: "coverageRatio" },
  plot_ratio: { comparisonField: "plotRatio" },
  build_restriction: { comparisonField: "buildRestriction" },
}

const FACILITY_FIELD_KEYS: Record<FacilityField, { name: keyof ComparisonCondition; distance: keyof ComparisonCondition }> = {
  school: { name: "schoolName", distance: "schoolDistance" },
  market: { name: "marketName", distance: "marketDistance" },
  park: { name: "parkName", distance: "parkDistance" },
  station: { name: "stationName", distance: "stationDistance" },
  disamenity: { name: "disamenityName", distance: "disamenityDistance" },
}

function isFacilityField(field: FacilityField | SingleField): field is FacilityField {
  return field in FACILITY_FIELD_KEYS
}

// AI 查詢產生的 value 慣例格式：「名稱，距NNNM」（可能用「；」串多筆），後面可再附掛
// 「（距比準地NNNM）」。前半永遠是「距區段中心」，括號裡才是「距比準地」。
const FACILITY_VALUE_RE = /^(.+?)[，,]\s*距\s*([\d.]+)\s*M/i
const FACILITY_POINT_RE = /（\s*距比準地\s*([\d.]+)\s*M\s*）/i

/** 這筆設施到比準地的距離；沒有第二個距離就退回區段中心距離（兩者本來就相同）。 */
function metersForBenchmark(item: { metersToCenter: number; metersToPoint?: number }): number {
  return item.metersToPoint ?? item.metersToCenter
}

// 表4 的距離一律取「到比準地」的那個，並挑「離比準地最近」的那一筆——表4 評的是這一筆宗地
// 自己，不是區段。items[0] 是離區段中心最近的（供表5 用），區段中心旁的學校未必是宗地旁的
// 學校。沒帶區段多邊形時兩個距離相同，挑法退化成 items[0]，行為與改動前一致。
function parseFacilityValue(field: SurveyField): { name: string; distance: string } | null {
  const items = field.items
  if (items && items.length > 0) {
    const pick = items.reduce((best, it) =>
      metersForBenchmark(it) < metersForBenchmark(best) ? it : best,
    )
    return { name: pick.name, distance: String(metersForBenchmark(pick)) }
  }
  const first = field.value.split(/[；;]/)[0]?.trim()
  if (!first) return null
  const m = first.match(FACILITY_VALUE_RE)
  if (!m) return null
  return { name: m[1].trim(), distance: first.match(FACILITY_POINT_RE)?.[1] ?? m[2] }
}

// 表3欄位變動時，同一筆地(比準地)的表4欄位要跟著更新；比較標的(cases)是別筆地，不在此列。
export function deriveBenchmarkPatch(
  field: SurveyField,
  comparisonField: FacilityField | SingleField,
): Partial<ComparisonCondition> | null {
  if (isFacilityField(comparisonField)) {
    const parsed = parseFacilityValue(field)
    if (!parsed) return null
    const { name, distance } = FACILITY_FIELD_KEYS[comparisonField]
    return { [name]: parsed.name, [distance]: parsed.distance } as Partial<ComparisonCondition>
  }
  return { [comparisonField]: field.value } as Partial<ComparisonCondition>
}

function facilityText(condition: ComparisonCondition, comparisonField: FacilityField): string {
  const { name, distance } = FACILITY_FIELD_KEYS[comparisonField]
  return `${condition[name]} ${condition[distance]}M`
}

// 表5佐證文字：有表4對應欄位時雙邊並列（比準地／比較標的1），沒有就只顯示表3單邊事實
export function deriveRegionalFactorReference(
  field: SurveyField,
  label: string,
  comparisonField: LinkageSpec["comparisonField"],
  benchmark: ComparisonCondition,
  compareCase: ComparisonCondition | undefined,
  prevReference: FieldReference | undefined,
): FieldReference {
  if (!comparisonField) {
    return { ...prevReference, dataSource: prevReference?.dataSource ?? "勘查表", rawFact: `勘查表-${label}：${field.value || "（未填）"}` }
  }
  const benchmarkText = isFacilityField(comparisonField) ? facilityText(benchmark, comparisonField) : benchmark[comparisonField]
  const caseText = compareCase
    ? isFacilityField(comparisonField)
      ? facilityText(compareCase, comparisonField)
      : compareCase[comparisonField]
    : null
  const rawFact = caseText
    ? `比準地→${benchmarkText}；比較標的1→${caseText}`
    : `比準地→${benchmarkText}`
  return { ...prevReference, dataSource: prevReference?.dataSource ?? "勘查表", rawFact }
}

// 三階段產製共用的最小狀態片段：①表3產製/編輯時只有 survey+benchmark，
// ②表5產製後才會有 regionalFactors，③表4產製後才會有 compareCase(comparisonForm.cases[0])。
// 用泛型收斂在同一個函式，讓「AI 產製時的即時查詢」與「使用者手動編輯表3」走同一套推導邏輯，
// 避免三表數字各自漂移；也不必在 regionalFactors/compareCase 都還不存在的階段①硬塞假資料進來。
export type LinkageState = {
  survey: SurveyField[]
  benchmark: ComparisonCondition
  regionalFactors?: RegionalFactorRow[]
  compareCase?: ComparisonCondition
}

// 主入口：表3某欄位值確定後，把 benchmark、regionalFactors(若已存在) 對應列同步更新。
// 用於 App.tsx 手動編輯，以及 api/index.ts 三階段產製時的即時 enrichment，兩邊共用同一套規則。
export function applySurveyLinkage<T extends LinkageState>(state: T, key: string): T {
  const spec = SURVEY_LINKAGE[key]
  if (!spec) return state
  const field = state.survey.find((f) => f.key === key)
  if (!field) return state

  let benchmark = state.benchmark
  if (spec.comparisonField) {
    const patch = deriveBenchmarkPatch(field, spec.comparisonField)
    if (patch) benchmark = { ...benchmark, ...patch }
  }

  let regionalFactors = state.regionalFactors
  if (spec.regionalFactorKey && regionalFactors) {
    regionalFactors = regionalFactors.map((row) =>
      row.key !== spec.regionalFactorKey
        ? row
        : {
            ...row,
            subject: {
              ...row.subject,
              reference: deriveRegionalFactorReference(field, row.label, spec.comparisonField, benchmark, state.compareCase, row.subject.reference),
            },
          },
    )
  }

  if (benchmark === state.benchmark && regionalFactors === state.regionalFactors) return state
  return { ...state, benchmark, regionalFactors }
}
