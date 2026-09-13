import { Fragment } from "react"
import { REGIONAL_FACTOR_GROUPS, type RegionalFactorGroupDef } from "../lib/regionalFactorGroups"
import type { ProduceResult, RegionalFactorRow } from "../types"

// 完全比照官方紙本表5-2版式的輸出用元件（供 html2canvas 擷取列印/PDF）。
// 版面骨架（8大主要項目、各項細目、比準地／比較標的1~3欄）為表5-2固定官方格式；
// 顯示值直接讀 result.regionalFactors 的 subject(比準地)/compare(比較標的，索引對齊
// comparisonForm.cases)，無對應資料的細目維持空白，不捏造數據。compare 本身已經是
// lib/regionalFactorBrackets.ts computeCompareCell() 算好的結果(同區段鏡射比準地、
// 跨區段留白待人工複核)，這裡只負責顯示，不重新判斷一次「是否同區段」。

const KAI_FONT =
  "'標楷體-繁', 'DFKai-SB', 'BiauKai', 'Kaiti TC', 'STKaiti', 'Kaiti SC', '標楷體', 'KaiTi', serif"

const BORDER = "border-[#8A8F98]"
const CELL = `border ${BORDER}`
const VAL = "text-[11px] leading-[13px]"
const SUB = "text-[10px] leading-[12px]"
const HEAD_BG = "bg-[#FFFDE7]"
const CAT_BG = "bg-[#F0F1F3]"

// 官方表5-2固定8大主要項目及其細目：唯一權威定義見 lib/regionalFactorGroups.ts
// （逐字比照 cli/input/regional-anlysis-commerical.pdf 空白官方範本，與互動編輯頁共用）
const GROUPS = REGIONAL_FACTOR_GROUPS

function ColGroup() {
  return (
    <colgroup>
      <col style={{ width: "24px" }} />
      <col style={{ width: "250px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
      <col style={{ width: "64px" }} />
    </colgroup>
  )
}

function VerticalLabel({ label, rowSpan }: { label: string; rowSpan: number }) {
  return (
    <td className={`${CELL} align-middle ${CAT_BG} p-0 text-center`} rowSpan={rowSpan}>
      <div className="text-[12px] font-bold leading-[15px] py-[2px] tracking-widest [writing-mode:vertical-rl] inline-block">
        {label}
      </div>
    </td>
  )
}

function ItemLabel({ text }: { text: string }) {
  return <td className={`${CELL} align-middle px-[8px] py-[2px] ${SUB}`}>{text}</td>
}

function Grade({ text }: { text: string }) {
  return <td className={`${CELL} align-middle px-[4px] py-[2px] ${VAL} text-center`}>{text || " "}</td>
}

function Rate({ value }: { value: number | null }) {
  return (
    <td className={`${CELL} align-middle px-[4px] py-[2px] ${VAL} font-mono text-center`}>
      {value === null ? " " : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`}
    </td>
  )
}

function Blank({ colSpan = 1 }: { colSpan?: number }) {
  return (
    <td className={`${CELL} align-middle px-[4px] py-[2px]`} colSpan={colSpan}>
      &nbsp;
    </td>
  )
}

export default function PrintableRegionalFactorForm({ result }: { result: ProduceResult }) {
  const { meta, comparisonForm: f, regionalFactors } = result
  const remarks = result.regionalFactorRemarks ?? { subject: "", cases: "", overall: "" }
  const byKey: Record<string, RegionalFactorRow> = {}
  for (const item of regionalFactors) byKey[item.key] = item

  const cases = f.cases

  // 其他影響因素(8)：官方範本本無固定細項，改成直接列出使用者自建的列（RegionalFactorRow.custom），
  // 一個都沒有時仍畫一列空白（比照官方空白範本的樣子），跟固定8組其餘各組的靜態 rows 對照表不同來源。
  const customFactors = regionalFactors.filter((r) => r.group === "其他影響因素")

  // 每組要畫的列：1~7組固定從官方 catalog(group.rows)對照 byKey；第8組動態從 customFactors 取。
  function rowsForGroup(group: RegionalFactorGroupDef): { label: string; item: RegionalFactorRow | undefined }[] {
    if (group.title === "其他影響因素") {
      return customFactors.length > 0
        ? customFactors.map((f) => ({ label: f.label || "（未填寫）", item: f }))
        : [{ label: "", item: undefined }]
    }
    return group.rows.map((row) => ({ label: row.label, item: byKey[row.key] }))
  }

  // 每列取比較標的1~3之(優劣等級, 修正百分比)：無此比較標的或無對應資料時留空。
  function caseCell(caseIdx: number, item: RegionalFactorRow | undefined): { grade: string; rate: number | null } {
    if (!cases[caseIdx] || !item) return { grade: "", rate: null }
    const cell = item.compare[caseIdx]
    return cell ? { grade: cell.grade, rate: cell.rate } : { grade: "", rate: null }
  }

  function groupSubtotal(group: RegionalFactorGroupDef, caseIdx: number): number | null {
    const c = cases[caseIdx]
    if (!c) return null
    let sum = 0
    for (const { item } of rowsForGroup(group)) {
      const { rate } = caseCell(caseIdx, item)
      if (rate !== null) sum += rate
    }
    return sum
  }

  const totalCase1 = GROUPS.reduce((acc, g) => acc + (groupSubtotal(g, 0) ?? 0), 0)

  return (
    <div id="print-root-regional" className="w-[990px] bg-white text-[#1A1A1A] p-[28px]" style={{ fontFamily: KAI_FONT }}>
      <div className="flex items-baseline justify-between mb-[8px]">
        <div className="text-[18px] font-bold tracking-wide">
          表5-2　影響地價區域因素分析明細表（{meta.landUseType}）
        </div>
      </div>
      <div className="flex items-baseline justify-between mb-[6px] text-[12px]">
        <div>案號：{f.caseCode}</div>
      </div>

      <table className={`w-full table-fixed border-collapse ${CELL}`}>
        <ColGroup />
        <tbody>
          {/* ── 表頭：主要項目/修正細目 ＋ 比準地／比較標的1~3 ────────── */}
          <tr>
            <td className={`${CELL} align-middle ${CAT_BG} text-center font-bold ${VAL}`} colSpan={2} rowSpan={2}>
              主要項目／修正細目
            </td>
            <td className={`${CELL} align-middle ${HEAD_BG} px-[4px] py-[2px] text-center ${SUB}`}>
              比準地
              <br />
              地價區段 {meta.sectionId}
            </td>
            <td className={`${CELL} align-middle ${HEAD_BG} px-[4px] py-[2px] text-center ${SUB}`} colSpan={2}>
              比較編號1
              <br />
              {cases[0] ? `${cases[0].caseNo}｜地價區段 ${cases[0].sectionId}` : "－"}
            </td>
            <td className={`${CELL} align-middle ${HEAD_BG} px-[4px] py-[2px] text-center ${SUB}`} colSpan={2}>
              比較編號2
              <br />
              {cases[1] ? `${cases[1].caseNo}｜地價區段 ${cases[1].sectionId}` : "－"}
            </td>
            <td className={`${CELL} align-middle ${HEAD_BG} px-[4px] py-[2px] text-center ${SUB}`} colSpan={2}>
              比較編號3
              <br />
              {cases[2] ? `${cases[2].caseNo}｜地價區段 ${cases[2].sectionId}` : "－"}
            </td>
          </tr>
          <tr>
            <td className={`${CELL} align-middle text-center ${SUB} font-semibold`}>優劣等級</td>
            <td className={`${CELL} align-middle text-center ${SUB} font-semibold`}>優劣等級</td>
            <td className={`${CELL} align-middle text-center ${SUB} font-semibold`}>修正百分比</td>
            <td className={`${CELL} align-middle text-center ${SUB} font-semibold`}>優劣等級</td>
            <td className={`${CELL} align-middle text-center ${SUB} font-semibold`}>修正百分比</td>
            <td className={`${CELL} align-middle text-center ${SUB} font-semibold`}>優劣等級</td>
            <td className={`${CELL} align-middle text-center ${SUB} font-semibold`}>修正百分比</td>
          </tr>

          {/* ── 8大主要項目 ──────────────────────────────────────── */}
          {GROUPS.map((group) => {
            const rows = rowsForGroup(group)
            return (
            <Fragment key={group.no}>
              {rows.map(({ label, item }, i) => {
                const c1 = caseCell(0, item)
                const c2 = caseCell(1, item)
                const c3 = caseCell(2, item)
                return (
                  <tr key={`${group.no}-${i}`}>
                    {i === 0 && <VerticalLabel label={`${group.title}(${group.no})`} rowSpan={rows.length} />}
                    <ItemLabel text={label} />
                    <Grade text={item?.subject.grade ?? ""} />
                    <Grade text={c1.grade} />
                    <Rate value={c1.rate} />
                    <Grade text={c2.grade} />
                    <Rate value={c2.rate} />
                    <Grade text={c3.grade} />
                    <Rate value={c3.rate} />
                  </tr>
                )
              })}
              <tr className={CAT_BG}>
                <td className={`${CELL} align-middle px-[8px] py-[2px] text-center font-semibold ${SUB}`} colSpan={2}>
                  百分比小計
                </td>
                <Blank />
                <td className={`${CELL} align-middle px-[4px] py-[2px] text-center font-mono font-semibold ${VAL}`} colSpan={2}>
                  {groupSubtotal(group, 0) !== null ? `${(groupSubtotal(group, 0) as number).toFixed(2)}%` : " "}
                </td>
                <td className={`${CELL} align-middle px-[4px] py-[2px] text-center font-mono font-semibold ${VAL}`} colSpan={2}>
                  {groupSubtotal(group, 1) !== null ? `${(groupSubtotal(group, 1) as number).toFixed(2)}%` : " "}
                </td>
                <td className={`${CELL} align-middle px-[4px] py-[2px] text-center font-mono font-semibold ${VAL}`} colSpan={2}>
                  {groupSubtotal(group, 2) !== null ? `${(groupSubtotal(group, 2) as number).toFixed(2)}%` : " "}
                </td>
              </tr>
            </Fragment>
            )
          })}

          {/* ── 影響地價區域因素修正數合計 ──────────────────────────── */}
          <tr className="bg-[#EEF2F7]">
            <td className={`${CELL} align-middle px-[8px] py-[2px] text-center font-bold ${VAL}`} colSpan={3}>
              影響地價區域因素修正數 = (1)+(2)+(3)+(4)+(5)+(6)+(7)+(8)
            </td>
            <td className={`${CELL} align-middle px-[4px] py-[2px] text-center font-mono font-bold text-[#12457B] ${VAL}`} colSpan={2}>
              {cases[0] ? `${totalCase1 >= 0 ? "+" : ""}${totalCase1.toFixed(2)}%` : " "}
            </td>
            <Blank colSpan={2} />
            <Blank colSpan={2} />
          </tr>

          {/* ── 備註欄：顯示使用者實際填寫的內容，沒填就留空，不放假樣板文字 ─────── */}
          <tr>
            <td className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[2px] text-center ${SUB}`} colSpan={9}>
              備註欄
            </td>
          </tr>
          <tr>
            <td className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[2px] text-center ${SUB}`} colSpan={2}>
              比準地
            </td>
            <td className={`${CELL} align-top px-[10px] py-[4px] ${SUB} leading-snug whitespace-pre-wrap`} colSpan={7}>
              {remarks.subject || " "}
            </td>
          </tr>
          <tr>
            <td className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[2px] text-center ${SUB}`} colSpan={2}>
              各比較標的
            </td>
            <td className={`${CELL} align-top px-[10px] py-[4px] ${SUB} leading-snug whitespace-pre-wrap`} colSpan={7}>
              {remarks.cases || " "}
            </td>
          </tr>
          <tr>
            <td className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[2px] text-center ${SUB}`} colSpan={2}>
              全案
            </td>
            <td className={`${CELL} align-top px-[10px] py-[4px] ${SUB} leading-snug whitespace-pre-wrap`} colSpan={7}>
              {remarks.overall || " "}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-[10px] pt-[6px] border-t border-[#C7CBD1] flex flex-wrap items-center gap-x-8 text-[12px]">
        <span>填寫日期：{f.fillDate}</span>
        <span className="ml-auto">不動產估價師：＿＿＿＿＿＿</span>
      </div>
    </div>
  )
}
