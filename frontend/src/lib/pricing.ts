import type { ComparisonCase, ComparisonForm, FactorRow, ProduceResult } from "../types"

// null(需人工複核)視為0、不列入合計——沒有依據時「不修正」是唯一誠實的預設，跟表5
// regionalTotal 的算法一致，不能把「不知道」當成「差異很大」。
function caseIndividualTotal(rows: FactorRow[], caseIndex: number): number {
  return rows.reduce((sum, row) => sum + (row.compare[caseIndex]?.rate ?? 0), 0)
}

function caseAbsRateSum(rows: FactorRow[], caseIndex: number): number {
  return rows.reduce((sum, row) => sum + Math.abs(row.compare[caseIndex]?.rate ?? 0), 0)
}

// 表4 計算鏈：土地正常單價 →(日期調整)→ 估價基準日單價 →(區域因素調整)(個別因素調整)→
// 試算價格 →(權重)→ 比準地比較價格。每筆案例的 normalPrice 是它自己唯一的基準值，
// 一律正向計算，取代舊版「從既有 trialPrice 反推基準價」的作法——反推法只有在三個調整率
// 沒被拆開改動時才自洽，一旦分別改日期調整率／個別因素合計，記錄的 adjustedPrice/trialPrice
// 就會跟畫面上顯示的試算結果各自漂移。
function recomputeCase(c: ComparisonCase, individualTotal: number, absRateSum: number): ComparisonCase {
  const adjustedPrice = Math.round(c.normalPrice * (1 + c.dateAdjRate / 100))
  const trialPrice = Math.round(
    adjustedPrice * (1 + c.regionalAdjRate / 100) * (1 + individualTotal / 100),
  )
  return { ...c, adjustedPrice, trialPrice, absRateSum }
}

// 不動產估價技術規則第27條：比較標的權重依「調整百分率絕對值加總」（=價格形成因素之相近
// 程度）決定，加總愈少（愈相近）者權重愈高，級距固定——不是使用者自訂或後端評分，所以這裡
// 直接覆蓋掉 API 回傳／手動輸入的 weight，不做加權平均等其他算法。條文舉例只給了1~3件的
// 級距（100%／70%+30%／50%+30%+20%），沒有4件以上的規定，超過3件沿用3件的表（第4名以後
// 併入最低一檔），避免無中生有一組級距。
const WEIGHT_TABLE_BY_RANK = [50, 30, 20]
const WEIGHT_TABLE_BY_COUNT: Record<number, number[]> = {
  1: [100],
  2: [70, 30],
}

function computeWeights(absRateSums: number[]): string[] {
  const n = absRateSums.length
  const table = WEIGHT_TABLE_BY_COUNT[n] ?? WEIGHT_TABLE_BY_RANK
  const rankedIndexes = absRateSums
    .map((sum, i) => ({ sum, i }))
    .sort((a, b) => a.sum - b.sum)
    .map(({ i }) => i)
  const weights = new Array<string>(n)
  rankedIndexes.forEach((caseIndex, rank) => {
    weights[caseIndex] = `${table[rank] ?? table[table.length - 1]}%`
  })
  return weights
}

// App.tsx／api/index.ts 共用的重算入口：任一比較標的的日期調整率／區域因素調整率／個別因素
// 差異率變動後都呼叫這裡。呼叫端先把變動寫進 comparisonForm.cases[i] 或 comparisonRows（表4
// 個別因素），這裡一律從目前存的狀態正向重算全部1~3筆案例，不做局部patch——三筆比較標的各自
// 獨立，改一筆不代表其他筆不用重算比準地比較價格(加權總和)。
// computed 摘要只回讀 cases[0]，供②→③銜接與匯出頁沿用既有單一數字欄位，不是計算的唯一依據，
// 每筆案例完整的調整鏈請直接讀 comparisonForm.cases[i]。
export function recomputeChain(
  comparisonForm: ComparisonForm,
  comparisonRows: FactorRow[],
): { comparisonForm: ComparisonForm; computed: ProduceResult["computed"] } {
  const casesWithoutWeight = comparisonForm.cases.map((c, i) =>
    recomputeCase(c, caseIndividualTotal(comparisonRows, i), caseAbsRateSum(comparisonRows, i)),
  )
  const weights = computeWeights(casesWithoutWeight.map((c) => c.absRateSum))
  const cases = casesWithoutWeight.map((c, i) => ({ ...c, weight: weights[i] }))
  const benchmarkComparedPrice = Math.round(
    cases.reduce((sum, c) => sum + c.trialPrice * (parseFloat(c.weight) / 100 || 0), 0),
  )
  return {
    comparisonForm: { ...comparisonForm, cases, benchmarkComparedPrice },
    computed: {
      dateAdj: cases[0]?.dateAdjRate ?? 0,
      regionalTotal: cases[0]?.regionalAdjRate ?? 0,
      individualTotal: caseIndividualTotal(comparisonRows, 0),
      trialPrice: cases[0]?.trialPrice ?? 0,
    },
  }
}
