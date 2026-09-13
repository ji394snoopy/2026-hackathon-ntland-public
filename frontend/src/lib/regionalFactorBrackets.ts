import type { RegionalFactorCompare, RegionalFactorSubject, SurveyField } from "../types"

// 依 mock/produceForms.ts 既有 regionalFactors[].reference.bracket 級距文字整理出的結構化查表，
// 供②表5區域因素分析明細表「後端內部計算」使用：不是打外部 API，是拿①表3已確認的事實去查這張表。
//
// 級距門檻(thresholds)一律照 bracket 文字裡寫的數字抄錄，不自己發明新門檻。
// 數值型每一級的修正百分比(bands[].rate)：bracket 文字本身有標示 % 的就直接採用該值；
// 沒標示 %、只寫級距說明的（大多數地理距離類），沿用該筆資料原本 rate 欄位的絕對值作為
// 「優/劣」的標準修正幅度──這跟 RegionalFactorPage.tsx 使用者手動切換優劣等級下拉選單時
// 用的 Math.abs(f.rate) || 2 換算邏輯完全一致，不是憑空另編一套數字。
// cemetery_r 的「稍優」級距（bracket 有寫但只有「劣」有實際樣本 rate）沒有既有數據可依循，
// 用「優」「劣」幅度的一半內插，這是本次新增、非 bracket/mock 原文直接提供的推估值，
// 已在 PR 說明中特別標註，供人工複核判斷是否需要調整。
type NumericBand = { grade: string; rate: number }
type NumericBracketSpec = { kind: "numeric"; thresholds: number[]; bands: NumericBand[] }
type CategoricalMatch = { keywords: string[]; grade: string; rate: number }
type CategoricalBracketSpec = { kind: "categorical"; matches: CategoricalMatch[] }
type BracketSpec = NumericBracketSpec | CategoricalBracketSpec

export const REGIONAL_FACTOR_BRACKETS: Record<string, BracketSpec> = {
  // bracket: "劣<8m｜普通8-15m｜優>15m"（道路越寬越優）
  road_r: {
    kind: "numeric",
    thresholds: [8, 15],
    bands: [
      { grade: "劣", rate: -2 },
      { grade: "普通", rate: 0 },
      { grade: "優", rate: 2 },
    ],
  },
  // bracket: "優<200m｜普通200-500m｜劣>500m"（離公車站越近越優）
  bus_r: {
    kind: "numeric",
    thresholds: [200, 500],
    bands: [
      { grade: "優", rate: 2 },
      { grade: "普通", rate: 0 },
      { grade: "劣", rate: -2 },
    ],
  },
  // bracket: "優<5km｜普通5-15km｜劣>15km"
  interchange_r: {
    kind: "numeric",
    thresholds: [5, 15],
    bands: [
      { grade: "優", rate: 3 }, // 唯一有樣本的是「劣」-3%，優劣對稱取 +3%
      { grade: "普通", rate: 0 },
      { grade: "劣", rate: -3 },
    ],
  },
  // bracket: "優<200m｜普通200-600m｜劣>600m"
  park_r: {
    kind: "numeric",
    thresholds: [200, 600],
    bands: [
      { grade: "優", rate: 2 },
      { grade: "普通", rate: 0 },
      { grade: "劣", rate: -2 },
    ],
  },
  // bracket: "優<100m｜普通100-400m｜劣>400m"（唯一有樣本的是「優」+2%）
  market_r: {
    kind: "numeric",
    thresholds: [100, 400],
    bands: [
      { grade: "優", rate: 2 },
      { grade: "普通", rate: 0 },
      { grade: "劣", rate: -2 },
    ],
  },
  // bracket: "優≥500m｜稍優300-500m｜普通100-300m｜劣<100m"（嫌惡設施越遠越優，樣本「劣」-4%）
  cemetery_r: {
    kind: "numeric",
    thresholds: [100, 300, 500],
    bands: [
      { grade: "劣", rate: -4 },
      { grade: "普通", rate: 0 },
      { grade: "稍優", rate: 2 }, // 內插值，見檔頭說明
      { grade: "優", rate: 4 },
    ],
  },
  // bracket: "優：不易淹水｜普通：偶有積水｜劣：容易淹水"（無 %，樣本「普通」0% → 取 ±2 為標準幅度）
  drain_r: {
    kind: "categorical",
    matches: [
      { keywords: ["不易淹水"], grade: "優", rate: 2 },
      { keywords: ["偶有積水"], grade: "普通", rate: 0 },
      { keywords: ["容易淹水"], grade: "劣", rate: -2 },
    ],
  },
  // bracket: "優：平坦｜普通：緩坡｜劣：陡坡"
  terrain_r: {
    kind: "categorical",
    matches: [
      { keywords: ["平坦"], grade: "優", rate: 2 },
      { keywords: ["緩坡"], grade: "普通", rate: 0 },
      { keywords: ["陡坡", "坡地"], grade: "劣", rate: -2 },
    ],
  },
  // bracket: "優：無｜普通：輕微｜劣：明顯以上"
  air_r: {
    kind: "categorical",
    matches: [
      { keywords: ["無"], grade: "優", rate: 2 },
      { keywords: ["輕微"], grade: "普通", rate: 0 },
      { keywords: ["明顯"], grade: "劣", rate: -2 },
    ],
  },
  // bracket: "優+4%｜普通0%｜劣-4%"（bracket 本身就有標明 %，直接採用）
  customer_flow_r: {
    kind: "categorical",
    matches: [
      { keywords: ["多"], grade: "優", rate: 4 },
      { keywords: ["普通", "一般", "尚可"], grade: "普通", rate: 0 },
      { keywords: ["少", "稀少"], grade: "劣", rate: -4 },
    ],
  },
  // 註：power_r（電業設施影響）在 SURVEY_LINKAGE 裡沒有對應的表3欄位可供比對，本來就不是
  // 「AI/後端可計算」的項目 —— mock 資料裡這列本來就標記 edited:true（已由人工判定），
  // 計算階段直接原樣保留，不硬套 bracket，也不誤標成人工複核。
  // school_r/commerce_r 已移除：「其他影響因素(8)」官方範本本就無固定細項，不該預填學校/
  // 商業繁榮這種查表因素，改由使用者在該分類自建列、純人工填等級與修正率。
}

// 表3欄位的距離事實優先用 items[0].metersToCenter（AI 周邊設施查詢的精確值），
// 沒有 items（例如手動填寫的「約18km」）才退而用文字裡第一個數字。
function extractNumericFact(field: SurveyField): number | null {
  if (field.items?.[0]) return field.items[0].metersToCenter
  return extractNumericFromText(field.value)
}

function extractNumericFromText(text: string): number | null {
  const m = text.match(/([\d]+(?:\.[\d]+)?)/)
  return m ? parseFloat(m[1]) : null
}

function pickNumericBand(spec: NumericBracketSpec, fact: number): NumericBand {
  for (let i = 0; i < spec.thresholds.length; i++) {
    if (fact <= spec.thresholds[i]) return spec.bands[i]
  }
  return spec.bands[spec.bands.length - 1]
}

/**
 * 依 bracket 查表計算表5某一列「比準地」的優劣等級：比準地是基準，不修正自己，只有等級。
 * - row.key 沒有對應 bracket（power_r、或「其他影響因素」使用者自建列）→ 回傳 null，呼叫端應原樣保留該列（人工既有判定）。
 * - 有 bracket 但表3事實缺漏或無法判讀 → 回傳「需人工複核」（grade 留空、帶 warning），
 *   絕不憑空猜一個等級出來。
 */
export function computeRegionalFactorRow(
  rowKey: string,
  prevReference: FieldReferenceInput,
  survey: SurveyField[],
  surveyKey: string | null,
): RegionalFactorSubject | null {
  const spec = REGIONAL_FACTOR_BRACKETS[rowKey]
  if (!spec || !surveyKey) return null
  const field = survey.find((f) => f.key === surveyKey)

  const manualReview = (reason: string): RegionalFactorSubject => ({
    grade: "",
    edited: false,
    warning: `需人工複核：${reason}`,
    reference: {
      ...prevReference,
      dataSource: prevReference?.dataSource ?? "區域因素基準表",
      derivation: `無法自動判定（${reason}），請人工填寫等級`,
    },
  })

  if (!field || !field.value.trim()) return manualReview("表3對應事實尚未填寫")

  if (spec.kind === "numeric") {
    const fact = extractNumericFact(field)
    if (fact == null) return manualReview(`表3數值「${field.value}」無法判讀`)
    const band = pickNumericBand(spec, fact)
    return {
      grade: band.grade,
      warning: undefined,
      reference: {
        ...prevReference,
        dataSource: prevReference?.dataSource ?? "區域因素基準表",
        derivation: `${fact} 落在「${band.grade}」級`,
      },
    }
  }

  const matched = spec.matches.find((m) => m.keywords.some((k) => field.value.includes(k)))
  if (!matched) return manualReview(`表3內容「${field.value}」無法對應基準表級距`)
  return {
    grade: matched.grade,
    warning: undefined,
    reference: {
      ...prevReference,
      dataSource: prevReference?.dataSource ?? "區域因素基準表",
      derivation: `「${field.value}」對應「${matched.grade}」級`,
    },
  }
}

type FieldReferenceInput = RegionalFactorSubject["reference"]

// 該因素在基準表上定義的等級清單（依表中原順序，供跨區段編輯下拉選單使用）：
// 沒有 bracket 的因素（如建蔽率）回傳空陣列，代表無查表依據、不可編輯選單。
export function getGradeOptions(rowKey: string): string[] {
  const spec = REGIONAL_FACTOR_BRACKETS[rowKey]
  if (!spec) return []
  return spec.kind === "numeric" ? spec.bands.map((b) => b.grade) : spec.matches.map((m) => m.grade)
}

function gradeRate(rowKey: string, grade: string): number | null {
  const spec = REGIONAL_FACTOR_BRACKETS[rowKey]
  if (!spec || !grade) return null
  const band = spec.kind === "numeric" ? spec.bands.find((b) => b.grade === grade) : spec.matches.find((m) => m.grade === grade)
  return band?.rate ?? null
}

/**
 * 表5「比較標的」欄的優劣等級/修正百分比：
 * - 比較標的與比準地同一地價區段 → 鏡射比準地等級，修正率一律 0.00%（region 相同，沒有調整空間），
 *   不可編輯（existingGrade 不採用）。
 * - 跨區段 → 比較標的所在區段自己有一個優劣等級（人工或AI填，見 existingGrade），修正率＝
 *   「查表相減」：該等級在基準表上的 rate 減去比準地等級的 rate，不是用等差公式估算——這樣
 *   cemetery_r 這種級距不等距的因素也能算對。existingGrade 還沒選 → 需人工複核，不是0。
 * - 此因素沒有查表依據（getGradeOptions 回傳空陣列）或比準地本身還沒判定出等級 → 一律需人工複核。
 */
export function computeCompareCell(
  rowKey: string,
  subject: RegionalFactorSubject,
  compareSectionId: string,
  benchmarkSectionId: string,
  existingGrade?: string,
): RegionalFactorCompare {
  const sameSectionAsBenchmark = compareSectionId === benchmarkSectionId
  const base = { sectionId: compareSectionId, sameSectionAsBenchmark }

  if (sameSectionAsBenchmark) {
    if (!subject.grade) {
      return { ...base, grade: "", rate: null, warning: "需人工複核：比準地等級尚未判定" }
    }
    return {
      ...base,
      grade: subject.grade,
      rate: 0,
      reference: {
        dataSource: "區域因素基準表",
        derivation: "與比準地同一地價區段，區域因素相同，修正率 0.00%",
        rawFact: `比較標的地價區段：${compareSectionId}（與比準地 ${benchmarkSectionId} 相同）`,
      },
    }
  }

  // 跨區段：比較標的選了什麼等級是獨立於比準地的事實，就算比準地那格還沒判定出來、
  // 算不出差異率，也要把使用者/AI 選的等級留住，不能因為算不出 rate 就連 grade 一起清空。
  const options = getGradeOptions(rowKey)
  if (options.length === 0) {
    return { ...base, grade: "", rate: null, warning: "需人工複核：此項目無查表依據" }
  }
  if (!existingGrade) {
    return { ...base, grade: "", rate: null, warning: "需人工複核：跨區段，請選擇比較標的所在區段之優劣等級" }
  }
  if (!subject.grade) {
    return { ...base, grade: existingGrade, rate: null, warning: "需人工複核：比準地等級尚未判定，暫無法算出差異率" }
  }

  const compareRate = gradeRate(rowKey, existingGrade)
  const subjectRate = gradeRate(rowKey, subject.grade)
  if (compareRate == null || subjectRate == null) {
    return { ...base, grade: existingGrade, rate: null, warning: "需人工複核：等級無法對應基準表級距" }
  }
  const rate = compareRate - subjectRate
  return {
    ...base,
    grade: existingGrade,
    rate,
    reference: {
      dataSource: "區域因素基準表（比較標的所在區段）",
      derivation: `比較標的「${existingGrade}」級 vs 比準地「${subject.grade}」級，修正率${rate >= 0 ? "+" : ""}${rate.toFixed(2)}%`,
      rawFact: `比較標的地價區段：${compareSectionId}（與比準地 ${benchmarkSectionId} 不同）`,
    },
  }
}
