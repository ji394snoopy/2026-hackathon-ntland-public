import { Fragment, useState } from "react";
import PageHeader from "../components/PageHeader";
import StatusTag from "../components/StatusTag";
import {
  ReferenceDetails,
  ReferenceToggle,
} from "../components/ReferencePanel";
import type {
  FieldReference,
  ProduceResult,
  RegionalFactorRemarks,
  RegionalFactorRow,
} from "../types";
import { REGIONAL_FACTOR_GROUPS } from "../lib/regionalFactorGroups";
import { getGradeOptions } from "../lib/regionalFactorBrackets";

const GRADES = ["優", "稍優", "普通", "稍劣", "劣"];
const OTHER_FACTORS_GROUP = "其他影響因素";

// 同區段鏡射不是「AI已填」或「已修改」——它根本沒有被判定，只是複製比準地的等級，
// 用一個獨立的小標籤跟 StatusTag 的既有語意區分開，不要混進共用元件的狀態詞彙裡。
function MirroredTag() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-[2px] bg-[#EEF4FB] text-[#12457B] border border-[#B9D2E8] whitespace-nowrap">
      同區段鏡射
    </span>
  );
}

// ②區域因素分析明細表階段只需要 meta+regionalFactors(+caseCode/comparisonCases表頭身分)：此時③尚未產製
type RegionalStageResult = Pick<
  ProduceResult,
  | "meta"
  | "regionalFactors"
  | "regionalFactorRemarks"
  | "caseCode"
  | "comparisonCases"
>;

// 每個區塊（比準地／比較標的N）自己的「狀態＋對照」面板：不是共用一組——比較標的的等級/
// 修正率是各自算出的(鏡射比準地或需人工複核)，理當各自有自己的狀態徽章與可稽核依據。
// 狀態徽章看的是「等級本身有沒有真的判定出來」(grade)，不是「有沒有 reference 物件」——
// 需人工複核時 reference 也會有內容(說明無法判定的原因)，但 grade 是空的，不能標成「AI已填」。
// forceManual：其他影響因素(8)自建列專用——本質是專業裁量，永遠不會是「AI已填」，
// 只在「需人工填」跟「已修改」之間切換。
function StatusRefCell({
  grade,
  edited,
  mirrored,
  forceManual,
  warning,
  reference,
  expanded,
  onToggle,
}: {
  grade: string;
  edited?: boolean;
  mirrored?: boolean;
  forceManual?: boolean;
  warning?: string;
  reference?: FieldReference;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <td className="px-2 py-2 border-l border-[#E5E7EB]">
      <div className="flex items-center gap-1.5 flex-wrap">
        {mirrored ? (
          <MirroredTag />
        ) : (
          <StatusTag
            source={
              edited ? "edited" : forceManual ? "empty" : grade ? "ai" : "empty"
            }
          />
        )}
        {warning && (
          <span title={warning} className="text-amber-500 text-[10px]">
            ⚠
          </span>
        )}
        {reference && (
          <ReferenceToggle
            expanded={expanded}
            onToggle={onToggle}
            hasReference
          />
        )}
      </div>
    </td>
  );
}

export default function RegionalFactorPage({
  result,
  onUpdateGrade,
  onUpdateCompareGrade,
  onAddCustomFactor,
  onRemoveCustomFactor,
  onUpdateCustomLabel,
  onUpdateCustomSubjectGrade,
  onUpdateCustomCompareGrade,
  onUpdateCustomCompareRate,
  onUpdateRemark,
  onNext,
  nextLoading,
}: {
  result: RegionalStageResult;
  onUpdateGrade: (key: string, grade: string) => void;
  onUpdateCompareGrade: (key: string, caseIndex: number, grade: string) => void;
  onAddCustomFactor: () => void;
  onRemoveCustomFactor: (key: string) => void;
  onUpdateCustomLabel: (key: string, label: string) => void;
  onUpdateCustomSubjectGrade: (key: string, grade: string) => void;
  onUpdateCustomCompareGrade: (
    key: string,
    caseIndex: number,
    grade: string,
  ) => void;
  onUpdateCustomCompareRate: (
    key: string,
    caseIndex: number,
    rate: number,
  ) => void;
  onUpdateRemark: (field: keyof RegionalFactorRemarks, value: string) => void;
  onNext: () => void;
  nextLoading?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const cases = result.comparisonCases ?? [];

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // 頂部總修正數＝各列「比較標的N」修正百分比加總（跟 api/index.ts produceRegionalFactors
  // 算法一致，其他影響因素(8)自建列的修正率也算在內）；比準地是基準，不修正自己，不能拿它的
  // 等級湊一個「總修正數」出來。
  const totalRates = cases.map((_, caseIndex) =>
    result.regionalFactors.reduce(
      (s, f) => s + (f.compare[caseIndex]?.delta ?? 0),
      0,
    ),
  );

  // 官方表5-2固定8大主要項目：逐列比對 lib/regionalFactorGroups.ts，即使該區段目前沒有
  // 對應查表資料(byKey 找不到)也要照樣畫出空白列，交給人工填寫，不是有資料才顯示。
  // 其他影響因素(8)例外：官方範本本就沒有固定細項，這一組改成直接從 result.regionalFactors
  // 動態抓 group 符合的列（使用者自建的），不走固定 key 對照表。
  const byKey: Record<string, RegionalFactorRow> = {};
  for (const f of result.regionalFactors) byKey[f.key] = f;
  const customFactors = result.regionalFactors.filter(
    (f) => f.group === OTHER_FACTORS_GROUP,
  );
  const groups = REGIONAL_FACTOR_GROUPS.map((g) => ({
    no: g.no,
    name: g.title,
    factors:
      g.title === OTHER_FACTORS_GROUP
        ? customFactors
        : g.rows.map(
            (row) =>
              byKey[row.key] ?? {
                key: row.key,
                label: row.label,
                group: g.title,
                subject: { grade: "" },
                compare: [],
              },
          ),
  }));

  // 比準地欄「rank＋優劣等級」2欄；比較標的N欄「rank＋優劣等級＋修正百分比」3欄。
  // 比準地是基準，不修正自己，沒有修正百分比欄——跟比較標的欄位排列刻意不對稱。
  const subjectColCount = 2;
  const caseColCountPerCase = 3;
  const totalCaseColCount = cases.length * caseColCountPerCase;
  const otherColCount = subjectColCount + totalCaseColCount;
  const totalColCount = 1 + otherColCount;
  const labelColPct = 30;
  const otherColPct = (100 - labelColPct) / otherColCount;
  const ColGroup = () => (
    <colgroup>
      <col style={{ width: `${labelColPct}%` }} />
      {Array.from({ length: otherColCount }).map((_, i) => (
        <col key={i} style={{ width: `${otherColPct}%` }} />
      ))}
    </colgroup>
  );

  const renderRow = (f: RegionalFactorRow) => {
    const benchmarkKey = f.key;
    const panels: {
      key: string;
      reference?: FieldReference;
      warning?: string;
    }[] = [
      {
        key: benchmarkKey,
        reference: f.subject.reference,
        warning: f.subject.warning,
      },
      ...cases.map((_, i) => ({
        key: `${f.key}::case::${i}`,
        reference: f.compare[i]?.reference,
        warning: f.compare[i]?.warning,
      })),
    ];

    return (
      <Fragment key={f.key}>
        <tr className="border-b border-[#F0F1F3] hover:bg-[#FAFAFA]">
          <td className="px-3 py-2 text-xs text-[#1A1A1A]">
            {f.custom ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={f.label}
                  onChange={(e) => onUpdateCustomLabel(f.key, e.target.value)}
                  placeholder="請輸入細項名稱"
                  className="flex-1 border border-[#D9DCE0] rounded-[4px] px-2 py-1 text-xs focus:outline-none focus:border-[#12457B]"
                />
                <button
                  onClick={() => onRemoveCustomFactor(f.key)}
                  className="text-[10px] text-red-600 hover:underline shrink-0"
                >
                  移除
                </button>
              </div>
            ) : (
              f.label
            )}
          </td>
          <td className="px-2 py-2 border-l border-[#E5E7EB] text-center text-xs text-[#9CA3AF] bg-[#F0F7FF]">
            {f.subject.rank}
          </td>
          <td className="px-2 py-2 border-l border-r-2 border-r-[#D1D5DB] border-[#E5E7EB] text-center text-xs text-[#1A1A1A] bg-[#F0F7FF]">
            {f.subject.grade || "－"}
          </td>
          {cases.map((_, i) => {
            const cr = f.compare[i];
            const caseKey = `${f.key}::case::${i}`;
            const gradeOptions = getGradeOptions(f.key);
            // 自建列兩側都純人工輸入：不查表、不鏡射（連「同區段無差異」的假設對個案裁量因素
            // 都不必然成立），等級跟修正率永遠可編輯。
            const editable =
              f.custom ||
              (!!cr && !cr.sameSectionAsBenchmark && gradeOptions.length > 0);
            return (
              <Fragment key={i}>
                <td
                  className={`px-2 py-2 text-center text-xs text-[#9CA3AF] border-l-2 border-l-[#D1D5DB] border-[#E5E7EB] ${
                    i === 0
                      ? "bg-[#FAFAFA]"
                      : i === 1
                        ? "bg-[#F5F5F5]"
                        : "bg-[#FAFAFA]"
                  }`}
                >
                  {cr?.rank ?? ""}
                </td>
                <td
                  className={`px-2 py-2 text-xs text-center text-[#1A1A1A] border-l border-r-2 border-r-[#D1D5DB] border-[#E5E7EB] ${
                    i === 0
                      ? "bg-[#FAFAFA]"
                      : i === 1
                        ? "bg-[#F5F5F5]"
                        : "bg-[#FAFAFA]"
                  }`}
                >
                  {cr?.grade || "－"}
                </td>
                <td
                  className={`px-2 py-2 text-right text-xs font-mono text-[#1A1A1A] border-l border-[#E5E7EB] ${
                    i === 0
                      ? "bg-[#FAFAFA]"
                      : i === 1
                        ? "bg-[#F5F5F5]"
                        : "bg-[#FAFAFA]"
                  }`}
                >
                  {f.custom ? (
                    <input
                      type="number"
                      step="0.01"
                      value={cr?.delta ?? ""}
                      onChange={(e) =>
                        onUpdateCustomCompareRate(
                          f.key,
                          i,
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-16 border border-[#D9DCE0] rounded-[4px] px-1.5 py-1 text-xs font-mono text-right focus:outline-none focus:border-[#12457B]"
                    />
                  ) : cr && cr.delta !== null && cr.delta !== undefined ? (
                    `${cr.delta >= 0 ? "+" : ""}${cr.delta.toFixed(2)}%`
                  ) : (
                    "－"
                  )}
                </td>
              </Fragment>
            );
          })}
        </tr>
        {panels
          .filter((p) => expanded.has(p.key) && p.reference)
          .map((p) => (
            <tr key={p.key}>
              <td colSpan={totalColCount} className="p-0">
                <ReferenceDetails
                  reference={p.reference as FieldReference}
                  warning={p.warning}
                />
              </td>
            </tr>
          ))}
      </Fragment>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="影響地價區域因素分析明細表"
        subtitle={`案號 ${result.caseCode ?? "－"}｜區段 ${result.meta.sectionId}｜比準地：${result.meta.benchmarkParcel}${cases
          .map((c, i) => `｜比較標的${i + 1}：${c.caseNo}（${c.sectionId}）`)
          .join("")}`}
      />

      <div className="bg-white border-b border-[#D9DCE0] px-5 py-2 flex items-center gap-6 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-[#6B7280]">區域因素總修正數：</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#6B7280]">比準地（基準）</span>
            <span className="text-sm font-mono font-semibold text-[#1A1A1A]">
              +0.00%
            </span>
          </div>
          {cases.map((c, i) => {
            const rate = totalRates[i];
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-[#6B7280]">
                  比較標的{i + 1}
                </span>
                <span
                  className={`text-sm font-mono font-semibold ${rate === 0 ? "text-[#1A1A1A]" : rate > 0 ? "text-[#2E7D32]" : "text-red-600"}`}
                >
                  {rate >= 0 ? "+" : ""}
                  {rate.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
        <span className="text-[10px] text-[#9CA3AF]">
          （各比較標的相對比準地之修正百分比加總，供表4試算價格採計）
        </span>
        <div className="flex-1" />

        <button
          onClick={onNext}
          disabled={nextLoading}
          className="px-3 py-1 text-[11px] bg-[#12457B] text-white rounded-[4px] hover:bg-[#0F3A66] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {nextLoading ? "產製中…" : "下一步：比較法估價 →"}
        </button>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <div className="bg-white border border-[#D9DCE0] rounded-[4px] h-full flex flex-col">
          {/* 表頭跟表身刻意拆成兩個獨立的 <table>：sticky 儲存格如果跟會捲動的表身列共用同一個
              <table>，Chromium 對 <table> 內 position:sticky 的重繪常常抓不乾淨，捲動時會有
              已經捲走的列殘影透出來(見「怪怪的」回報，多次調 z-index/will-change 都無效，
              是瀏覽器對「sticky 儲存格＋表格繪製」這個組合本身的問題，不是我們版面寫錯)。
              改成 sticky 包在一個普通 <div> 上（div 的 sticky 沒有這個毛病），底下另一個
              <table> 專門放會捲動的表身；兩個 <table> 用同一份 <colgroup> 固定寬度百分比，
              欄位才會對齊。 */}
          <div
            className="flex-shrink-0 bg-[#F5F6F7] rounded-t-[4px] overflow-hidden"
            style={{ backfaceVisibility: "hidden" }}
          >
            <table className="w-full table-fixed">
              <ColGroup />
              <thead className="bg-[#F5F6F7]">
                <tr className="border-b border-[#D9DCE0]">
                  <th className="text-left px-3 py-2 text-[10px] text-[#6B7280] font-medium align-bottom">
                    區域因素項目
                  </th>
                  <th
                    colSpan={2}
                    className="px-2 py-1.5 text-[10px] text-[#6B7280] font-medium text-center border-l border-r-2 border-r-[#D1D5DB] border-[#E5E7EB]"
                  >
                    <div className="font-normal text-[9px] text-[#9CA3AF]">
                      比準地（基準）{result.meta.sectionId}
                    </div>
                    優劣等級
                  </th>
                  {cases.map((c, i) => (
                    <Fragment key={i}>
                      <th
                        colSpan={2}
                        className="px-2 py-1.5 text-[10px] text-[#6B7280] font-medium text-center border-l-2 border-l-[#D1D5DB] border-r-2 border-r-[#D1D5DB] border-[#E5E7EB]"
                      >
                        <div className="font-normal text-[9px] text-[#9CA3AF]">
                          比較標的{i + 1}　{c.caseNo}｜{c.sectionId}
                        </div>
                        優劣等級
                      </th>
                      <th className="px-2 py-1.5 text-[10px] text-[#6B7280] font-medium text-center align-bottom">
                        修正百分比
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full table-fixed">
              <ColGroup />
              <tbody>
                {groups.map((cat) => (
                  <Fragment key={cat.name}>
                    <tr>
                      <td
                        colSpan={totalColCount}
                        className="px-3 py-1.5 bg-[#EFEFEF] text-[10px] font-semibold text-[#6B7280] border-t border-[#D9DCE0]"
                      >
                        {cat.name}（{cat.no}）
                      </td>
                    </tr>
                    {cat.factors.map((f) => renderRow(f))}
                    {cat.name === OTHER_FACTORS_GROUP && (
                      <tr className="border-b border-[#F0F1F3] bg-[#EFEFEF]">
                        <td colSpan={totalColCount} className="px-3 py-1.5">
                          <button
                            onClick={onAddCustomFactor}
                            className="text-[11px] text-[#12457B] border border-[#D9DCE0] rounded-[4px] px-2 py-1 hover:border-[#12457B]"
                          >
                            ＋ 新增其他影響因素
                          </button>
                        </td>
                      </tr>
                    )}
                    <tr className="bg-[#EFEFEF] border-t border-[#E5E7EB]">
                      <td className="px-3 py-1.5 text-[10px] text-[#6B7280]">
                        小計 — {cat.name}
                      </td>
                      <td
                        colSpan={2}
                        className="border-l border-r-2 border-r-[#D1D5DB] border-[#E5E7EB]"
                      />
                      {cases.map((_, i) => {
                        const sum = cat.factors.reduce((s, f) => {
                          const d = f.compare[i]?.delta;
                          return d !== null && d !== undefined ? s + d : s;
                        }, 0);
                        return (
                          <Fragment key={i}>
                            <td className="px-2 py-1.5 text-center text-[11px] font-mono text-[#9CA3AF] border-l-2 border-l-[#D1D5DB] border-[#E5E7EB] bg-[#EFEFEF]" />
                            <td className="px-2 py-1.5 text-center text-[11px] font-mono text-[#9CA3AF] border-l border-r-2 border-r-[#D1D5DB] border-[#E5E7EB] bg-[#EFEFEF]" />
                            <td className="px-3 py-1.5 text-right text-[11px] font-mono font-semibold text-[#1A1A1A] border-l border-[#E5E7EB] bg-[#EFEFEF]">
                              {sum >= 0 ? "+" : ""}
                              {sum.toFixed(2)}%
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}
                <tr className="border-t-2 border-[#D9DCE0] bg-[#EEF2F7]">
                  <td className="px-3 py-2 text-xs font-semibold text-[#1A1A1A]">
                    影響地價區域因素總修正數 =(1)+(2)+(3)+(4)+(5)+(6)+(7)+(8)
                  </td>
                  <td
                    colSpan={2}
                    className="border-l border-r-2 border-r-[#555555] border-[#E5E7EB]"
                  />
                  {cases.map((_, i) => {
                    const sum = result.regionalFactors.reduce((s, f) => {
                      const d = f.compare[i]?.delta;
                      return d !== null && d !== undefined ? s + d : s;
                    }, 0);
                    return (
                      <td
                        key={i}
                        colSpan={3}
                        className="px-3 py-2 text-right text-sm font-mono font-bold text-[#12457B] border-l-2 border-l-[#D1D5DB] border-[#E5E7EB]"
                      >
                        {sum >= 0 ? "+" : ""}
                        {sum.toFixed(2)}%
                      </td>
                    );
                  })}
                </tr>
                {/* ── 備註欄：直接對應表頭欄位，不需額外標籤 ─────── */}
                <tr>
                  <td
                    colSpan={totalColCount}
                    className="px-3 py-1.5 bg-[#FFFDE7] text-[11px] font-semibold text-[#1A1A1A] border-t-2 border-[#D9DCE0]"
                  >
                    備註欄
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-xs text-[#6B7280] bg-[#F9FAFB] border-r border-[#E5E7EB] shrink-0">
                    備註
                  </td>
                  {/* 比準地備註（2欄：rank+等級欄） */}
                  <td colSpan={2} className="p-2 border-l border-[#E5E7EB]">
                    <input
                      value={result.regionalFactorRemarks?.subject ?? ""}
                      onChange={(e) =>
                        onUpdateRemark("subject", e.target.value)
                      }
                      placeholder="如：本案比準地選取理由……"
                      className="w-full border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-xs focus:outline-none focus:border-[#12457B]"
                    />
                  </td>
                  {/* 各比較標的備註（每個3欄：rank+等級+修正百分比） */}
                  {cases.map((_, i) => (
                    <td
                      key={i}
                      colSpan={3}
                      className="p-2 border-l border-[#E5E7EB]"
                    >
                      <input
                        value={result.regionalFactorRemarks?.cases ?? ""}
                        onChange={(e) =>
                          onUpdateRemark("cases", e.target.value)
                        }
                        placeholder="如：比較標的2位於P003-00區段，依土地徵收補償市價查估辦法第19條擴大蒐集範圍選取，理由如下……"
                        className="w-full border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-xs focus:outline-none focus:border-[#12457B]"
                      />
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-[#D9DCE0]">
                  <td className="px-3 py-2 text-xs text-[#6B7280] bg-[#F9FAFB] border-r border-[#E5E7EB] shrink-0">
                    全案
                  </td>
                  <td
                    colSpan={subjectColCount + totalCaseColCount}
                    className="p-2 border-l border-[#E5E7EB]"
                  >
                    <textarea
                      value={result.regionalFactorRemarks?.overall ?? ""}
                      onChange={(e) =>
                        onUpdateRemark("overall", e.target.value)
                      }
                      rows={3}
                      className="w-full border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-xs resize-y focus:outline-none focus:border-[#12457B]"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-[10px] text-[#9CA3AF] px-1 pt-2">
          說明：比準地是基準，只判定優劣等級、不修正自己。比較標的欄的優劣等級/修正百分比是「相對比準地」算出來的：
          與比準地同一地價區段時，區域因素相同，一律鏡射比準地等級（唯讀，藍色「同區段鏡射」標籤）、修正率0.00%；
          跨區段時比較標的欄可編輯，選填該區段自己的優劣等級後，依基準表查表算出與比準地的差異率（不是等差公式估算）。
          其他影響因素(8)是標準7類涵蓋不到的個案專業裁量，官方範本無固定細項，一律由使用者自建，兩側等級與修正率純人工輸入，不查表、不鏡射。
          每個區塊各自的「對照」可展開查看該欄依據；「需人工填」表示沒有對應事實或無查表依據可自動判定。
        </div>
      </div>
    </div>
  );
}
