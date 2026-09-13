import { Fragment, useState } from "react";
import PageHeader from "../components/PageHeader";
import PrintableComparisonForm from "../components/PrintableComparisonForm";
import {
  ReferenceDetails,
  ReferenceToggle,
} from "../components/ReferencePanel";
import type { ComparisonCondition, ProduceResult } from "../types";

// 個別因素調整表的 key 對應到 ComparisonCondition 哪個欄位（單一值，或「名稱+距離」組合）
const CONDITION_TEXT: Partial<
  Record<string, (c: ComparisonCondition) => string | React.ReactNode>
> = {
  area: (c) => c.area,
  width: (c) => c.width,
  depth: (c) => c.depth,
  shape: (c) => c.shape,
  frontage: (c) => c.frontage,
  terrain: (c) => c.terrain,
  roadType: (c) => c.roadType,
  roadWidth: (c) => (
    <table className="w-full table-auto text-xs">
      <tbody>
        <tr>
          <td className="px-1 text-xs text-center text-[#1A1A1A]">
            {c.roadWidth ? `${c.roadName}(${c.roadWidth} M)` : c.roadName}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  school: (c) => (
    <table className="w-full table-auto text-xs">
      <tbody>
        <tr>
          <td className="px-1 text-xs text-center text-[#1A1A1A]">
            {c.schoolDistance
              ? `${c.schoolName}(${c.schoolDistance} M)`
              : c.schoolName}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  market: (c) => (
    <table className="w-full table-auto text-xs">
      <tbody>
        <tr>
          <td className="px-1 text-xs text-center text-[#1A1A1A]">
            {c.marketDistance
              ? `${c.marketName}(${c.marketDistance} M)`
              : c.marketName}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  park: (c) => (
    <table className="w-full table-auto text-xs">
      <tbody>
        <tr>
          <td className="px-1 text-xs text-center text-[#1A1A1A]">
            {c.parkDistance ? `${c.parkName}(${c.parkDistance} M)` : c.parkName}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  station: (c) => (
    <table className="w-full table-auto text-xs">
      <tbody>
        <tr>
          <td className="px-1 text-xs text-center text-[#1A1A1A]">
            {c.stationDistance
              ? `${c.stationName}(${c.stationDistance} M)`
              : c.stationName}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  district: (c) => (
    <table className="w-full table-auto text-xs">
      <tbody>
        <tr>
          <td className="px-1 text-xs text-center text-[#1A1A1A]">
            {c.districtDistance
              ? `${c.districtName}(${c.districtDistance} M)`
              : c.districtName}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  disamenity: (c) => (
    <table className="w-full table-auto text-xs">
      <tbody>
        <tr>
          <td className="px-1 text-xs text-center text-[#1A1A1A]">
            {c.disamenityDistance
              ? `${c.disamenityName}(${c.disamenityDistance} M)`
              : c.disamenityName}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  parking: (c) => c.parking,
  zoning: (c) => c.zoning,
  coverageRatio: (c) => c.coverageRatio,
  plotRatio: (c) => c.plotRatio,
  buildRestriction: (c) => c.buildRestriction,
};

const PRICE_SIMILARITY_OPTIONS = ["優", "普通", "劣"];

export default function ComparisonAppraisalPage({
  result,
  onUpdateRate,
  onUpdateDateAdj,
  onUpdatePriceSimilarity,
  onUpdateBenchmarkRemark,
  onUpdateCaseRemark,
  onUpdateOverallRemark,
  onNext,
}: {
  result: ProduceResult;
  onUpdateRate: (key: string, caseIndex: number, rate: number) => void;
  onUpdateDateAdj: (caseIndex: number, dateAdj: number) => void;
  onUpdatePriceSimilarity: (caseIndex: number, value: string) => void;
  onUpdateBenchmarkRemark: (value: string) => void;
  onUpdateCaseRemark: (value: string) => void;
  onUpdateOverallRemark: (value: string) => void;
  onNext: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showOfficialForm, setShowOfficialForm] = useState(false);
  const comparisonForm = result.comparisonForm;
  const benchmark = comparisonForm.benchmark;
  const cases = comparisonForm.cases;

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // 該筆比較標的自己的個別因素差異率加總；null(需人工複核)視為0、不列入合計，
  // 跟 lib/pricing.ts recomputeChain 的算法一致
  const individualTotalOf = (caseIndex: number): number =>
    result.comparison.reduce(
      (s, row) => s + (row.compare[caseIndex]?.rate ?? 0),
      0,
    );

  // 每個比較標的自己一組「條件／差異率」2欄；比準地只有「條件」1欄，不修正自己
  const caseColCountPerCase = 2;
  const totalCaseColCount = cases.length * caseColCountPerCase;
  const totalColCount = 1 /* 項目 */ + 1 /* 比準地 */ + totalCaseColCount;
  const labelColPct = 14;
  const benchmarkColPct = 20;
  const remainingPct = 100 - labelColPct - benchmarkColPct;
  const conditionColPct = (remainingPct / cases.length) * 0.75;
  const rateColPct = (remainingPct / cases.length) * 0.25;
  const ColGroup = () => (
    <colgroup>
      <col style={{ width: `${labelColPct}%` }} />
      <col style={{ width: `${benchmarkColPct}%` }} />
      {Array.from({ length: totalCaseColCount }).map((_, i) => {
        const isRateCol = i % 2 === 1;
        return (
          <col
            key={i}
            style={{ width: `${isRateCol ? rateColPct : conditionColPct}%` }}
          />
        );
      })}
    </colgroup>
  );

  // 基本資料區的一列數值（土地正常單價／調整至估價基準日單價等）：比準地沒有這些欄位，
  // 每個比較標的自己的值合併橫跨3欄顯示（不像個別因素列需要拆條件/差異率/對照3個獨立值）
  const CaseValueCell = ({
    caseIndex,
    children,
  }: {
    caseIndex: number;
    children: React.ReactNode;
  }) => (
    <td
      colSpan={caseColCountPerCase}
      className="px-1 py-2 text-xs font-mono text-center text-[#1A1A1A] border-l-2 border-l-[#D1D5DB] border-r border-r-[#D1D5DB] border-[#D9DCE0] whitespace-nowrap"
    >
      {cases[caseIndex] ? children : "—"}
    </td>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="比較法調查估價表"
        subtitle={`比準地：${result.meta.benchmarkParcel}｜區段：${result.meta.sectionId}`}
      />

      <div className="bg-white border-b border-[#D9DCE0] px-5 py-2 flex items-center gap-4 shrink-0">
        <span className="text-[11px] text-[#6B7280]">比準地比較價格：</span>
        <span className="text-sm font-mono font-semibold text-[#12457B]">
          {comparisonForm.benchmarkComparedPrice.toLocaleString()} 元/㎡
        </span>
        <span className="text-[10px] text-[#9CA3AF]">
          ＝Σ(各比較標的試算價格×權重)
        </span>
        <div className="flex-1" />

        <button
          onClick={onNext}
          className="px-3 py-1 text-[11px] bg-[#12457B] text-white rounded-[4px] hover:bg-[#0F3A66]"
        >
          下一步：產製圖籍 →
        </button>
      </div>

      <div className="flex-1 overflow-hidden p-4 flex flex-col gap-3">
        <div className="bg-white border border-[#D9DCE0] rounded-[4px] flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-2 bg-[#F5F6F7] border-b border-[#D9DCE0] text-[11px] font-semibold text-[#1A1A1A] flex items-center gap-2 flex-shrink-0">
            <span>比較法調查估價表（表4）</span>
          </div>
          {/* 表頭跟表身刻意拆成兩個獨立的 <table>：見 RegionalFactorPage.tsx 同樣做法的說明——
              sticky 儲存格如果跟會捲動的表身列共用同一個 <table>，Chromium 對 position:sticky
              的重繪常常抓不乾淨，捲動時會有殘影。 */}
          <div
            className="flex-shrink-0 bg-[#F5F6F7] overflow-hidden"
            style={{ backfaceVisibility: "hidden" }}
          >
            <table className="w-full table-fixed">
              <ColGroup />
              <thead className="border-b border-[#D9DCE0]">
                <tr>
                  <th className="text-center px-1 py-2 text-[10px] text-[#6B7280] font-medium align-bottom whitespace-nowrap">
                    項目／比較因素
                  </th>
                  <th className="px-3 py-1.5 text-[10px] text-[#6B7280] font-medium text-center border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0] whitespace-nowrap">
                    <div className="font-normal text-[9px] text-[#9CA3AF]">
                      比準地 ({`P001-00`})
                    </div>
                    條件
                  </th>
                  {cases.map((c, i) => (
                    <Fragment key={i}>
                      <th className="px-3 py-1.5 text-[10px] text-[#6B7280] font-medium text-center border-l-2 border-l-[#D1D5DB] border-r border-r-[#D1D5DB] border-[#D9DCE0]">
                        <div className="font-normal text-[9px] text-[#9CA3AF]">
                          比較標的{i + 1} ({`P00${i + 2}-00`})
                        </div>
                        條件
                      </th>
                      <th className="px-3 py-1.5 text-[10px] text-[#6B7280] font-medium text-center border-[#D9DCE0] border-r border-r-[#D1D5DB]">
                        差異率
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
                <tr className="bg-[#FFFACD]">
                  <td
                    colSpan={1}
                    className="px-1 py-2 text-[11px] font-semibold text-center text-[#1A1A1A]"
                  >
                    0. 基本資料
                  </td>
                  <td
                    colSpan={1}
                    className="px-1 py-2 text-[11px] font-semibold text-[#1A1A1A] text-center border-l-2 border-l-[#D1D5DB]"
                  >
                    新北市樹林區樹德段1415地號
                  </td>
                  {cases.map((c, i) => (
                    <td
                      key={i}
                      colSpan={caseColCountPerCase}
                      className="px-1 py-2 text-[11px] font-semibold text-[#1A1A1A] text-center border-l-2 border-l-[#D1D5DB]"
                    >
                      {c.location}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A] whitespace-nowrap">
                    土地正常單價
                  </td>
                  <td className="px-1 py-2 text-xs font-mono text-center text-[#B7BDC6] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0] whitespace-nowrap">
                    —
                  </td>
                  {cases.map((c, i) => (
                    <CaseValueCell key={i} caseIndex={i}>
                      {c.normalPrice.toLocaleString()} 元/㎡
                    </CaseValueCell>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A] whitespace-nowrap">
                    交易日期
                  </td>
                  <td className="px-1 py-2 text-xs font-mono text-center text-[#B7BDC6] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0] whitespace-nowrap">
                    —
                  </td>
                  {cases.map((c, i) => (
                    <Fragment key={i}>
                      <td className="px-1 py-2 text-xs font-mono text-center text-[#1A1A1A] border-l-2 border-l-[#D1D5DB] border-r border-r-[#D1D5DB] border-[#D9DCE0]">
                        {c.tradeDate || "－"}
                      </td>
                      <td className="px-0 py-2 border-[#D9DCE0] border-r border-r-[#D1D5DB]">
                        <div className="flex items-center justify-center gap-0.5">
                          <input
                            step="0.01"
                            value={c.dateAdjRate}
                            onChange={(e) =>
                              onUpdateDateAdj(
                                i,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="appearance-none border border-[#D9DCE0] rounded-[4px] px-0.5 py-0.5 text-xs font-mono text-right w-10 focus:outline-none focus:border-[#12457B]"
                          />
                          <span className="text-[10px] text-[#6B7280]">%</span>
                        </div>
                      </td>
                    </Fragment>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                    調整至估價基準日單價(元/㎡)
                  </td>
                  <td className="px-1 py-2 text-xs font-mono text-center text-[#B7BDC6] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    —
                  </td>
                  {cases.map((c, i) => (
                    <CaseValueCell key={i} caseIndex={i}>
                      <span className="font-semibold">
                        {c.adjustedPrice.toLocaleString()}
                      </span>
                    </CaseValueCell>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                    地價區段
                  </td>
                  <td className="px-1 py-2 text-xs font-mono text-center text-[#1A1A1A] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    {benchmark.sectionId}
                  </td>
                  {cases.map((c, i) => (
                    <Fragment key={i}>
                      <td className="px-1 py-2 text-xs font-mono text-center text-[#1A1A1A] border-l-2 border-l-[#D1D5DB] border-r border-r-[#D1D5DB] border-[#D9DCE0]">
                        {c.sectionId}
                      </td>
                      <td className="px-1 py-2 border-[#D9DCE0] border-r border-r-[#D1D5DB]">
                        <span
                          className={`text-xs font-mono text-center ${
                            c.regionalAdjRate > 0
                              ? "text-[#2E7D32]"
                              : c.regionalAdjRate < 0
                                ? "text-red-600"
                                : "text-[#1A1A1A]"
                          }`}
                          title="連動自②區域因素分析明細表總修正數，不可在此直接編輯"
                        >
                          {c.regionalAdjRate >= 0 ? "+" : ""}
                          {c.regionalAdjRate.toFixed(2)}%
                        </span>
                      </td>
                    </Fragment>
                  ))}
                </tr>
                <tr className="bg-[#FAFBFC]">
                  <td
                    colSpan={totalColCount}
                    className="px-3 py-1 text-[10px] font-semibold text-center text-[#6B7280]"
                  >
                    個別因素調整
                  </td>
                </tr>
                {result.comparison.map((it, idx) => {
                  const getText = CONDITION_TEXT[it.key];
                  const benchmarkText = getText ? getText(benchmark) : "—";
                  const prevGroup =
                    idx > 0 ? result.comparison[idx - 1].group : null;
                  return (
                    <Fragment key={it.key}>
                      {it.group !== prevGroup && (
                        <tr className="bg-[#FAFBFC]">
                          <td
                            colSpan={totalColCount}
                            className="px-3 py-1 text-[10px] font-semibold text-center text-[#6B7280]"
                          >
                            {it.group}
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-[#F0F1F3] last:border-0 hover:bg-[#FAFAFA]">
                        <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                          {it.label}
                        </td>
                        <td className="px-1 py-2 text-xs font-mono text-center text-[#1A1A1A] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                          {benchmarkText}
                        </td>
                        {cases.map((c, i) => {
                          const cell = it.compare[i];
                          const caseText = getText && c ? getText(c) : "—";
                          const cellKey = `${it.key}::case::${i}`;
                          return (
                            <Fragment key={i}>
                              <td className="px-1 py-2 text-xs font-mono text-center text-[#1A1A1A] border-l-2 border-l-[#D1D5DB] border-r border-r-[#D1D5DB] border-[#D9DCE0]">
                                {caseText}
                              </td>
                              <td className="px-0 py-2 text-center border-r border-r-[#D1D5DB]">
                                <div className="flex flex-col items-center gap-0.5">
                                  <div className="flex items-center gap-0.5">
                                    {cell?.warning && (
                                      <span className="text-amber-500 text-[10px]">
                                        ⚠
                                      </span>
                                    )}
                                    <input
                                      step="0.01"
                                      value={cell?.rate ?? ""}
                                      placeholder="需人工填"
                                      onChange={(e) =>
                                        onUpdateRate(
                                          it.key,
                                          i,
                                          parseFloat(e.target.value) || 0,
                                        )
                                      }
                                      className={`appearance-none border border-[#D9DCE0] rounded-[4px] px-0.5 py-0.5 text-xs font-mono text-right w-10 focus:outline-none focus:border-[#12457B] placeholder:text-[8px] ${
                                        (cell?.rate ?? 0) > 0
                                          ? "text-[#2E7D32]"
                                          : (cell?.rate ?? 0) < 0
                                            ? "text-red-600"
                                            : "text-[#1A1A1A]"
                                      }`}
                                    />
                                    <span className="text-[10px] text-[#6B7280]">
                                      %
                                    </span>
                                  </div>
                                  {cell?.warning && (
                                    <span className="text-[10px] text-amber-600">
                                      {cell.warning}
                                    </span>
                                  )}
                                </div>
                              </td>
                              {/* <td className="px-1 py-2 text-center">
                                <ReferenceToggle
                                  expanded={expanded.has(cellKey)}
                                  onToggle={() => toggleExpand(cellKey)}
                                  hasReference={!!cell?.reference}
                                />
                              </td> */}
                            </Fragment>
                          );
                        })}
                      </tr>
                      {cases.map(
                        (_, i) =>
                          expanded.has(`${it.key}::case::${i}`) &&
                          it.compare[i]?.reference && (
                            <tr key={i}>
                              <td colSpan={totalColCount} className="p-0">
                                <ReferenceDetails
                                  reference={it.compare[i].reference!}
                                  warning={it.compare[i].warning}
                                />
                              </td>
                            </tr>
                          ),
                      )}
                    </Fragment>
                  );
                })}

                <tr className="bg-[#FAFBFC]">
                  <td
                    colSpan={totalColCount}
                    className="px-3 py-1 text-[10px] font-semibold text-center text-[#6B7280]"
                  >
                    試算結果
                  </td>
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                    比較標的單價（基準）
                  </td>
                  <td className="px-1 py-2 text-[10px] text-center text-[#9CA3AF] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    —
                  </td>
                  {cases.map((c, i) => (
                    <CaseValueCell key={i} caseIndex={i}>
                      <span className="font-semibold">
                        {c.normalPrice.toLocaleString()} 元/㎡
                      </span>
                    </CaseValueCell>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                    個別因素合計
                  </td>
                  <td className="px-1 py-2 text-[10px] text-center text-[#9CA3AF] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    各項差異率加總
                  </td>
                  {cases.map((_, i) => {
                    const total = individualTotalOf(i);
                    return (
                      <CaseValueCell key={i} caseIndex={i}>
                        <span
                          className={
                            total > 0
                              ? "text-[#2E7D32]"
                              : total < 0
                                ? "text-red-600"
                                : ""
                          }
                        >
                          {total >= 0 ? "+" : ""}
                          {total.toFixed(2)}%
                        </span>
                      </CaseValueCell>
                    );
                  })}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                    調整百分率絕對值加總
                  </td>
                  <td className="px-1 py-2 text-[10px] text-center text-[#9CA3AF] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    —
                  </td>
                  {cases.map((c, i) => (
                    <CaseValueCell key={i} caseIndex={i}>
                      {c.absRateSum.toFixed(2)}%
                    </CaseValueCell>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                    價格形成因素之相近程度
                  </td>
                  <td className="px-1 py-2 text-[10px] text-center text-[#9CA3AF] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    人工判斷
                  </td>
                  {cases.map((c, i) => (
                    <td
                      key={i}
                      colSpan={caseColCountPerCase}
                      className="px-1 py-2 text-center border-l-2 border-l-[#D1D5DB] border-r border-r-[#D1D5DB] border-[#D9DCE0]"
                    >
                      <select
                        value={c.priceSimilarity}
                        onChange={(e) =>
                          onUpdatePriceSimilarity(i, e.target.value)
                        }
                        className="border border-[#D9DCE0] rounded-[4px] px-1 py-1 text-xs focus:outline-none focus:border-[#12457B]"
                      >
                        <option value="">－</option>
                        {PRICE_SIMILARITY_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-center text-[#1A1A1A]">
                    比較標的權重
                  </td>
                  <td className="px-1 py-2 text-[10px] text-center text-[#9CA3AF] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    依技術規則第27條自動計算
                  </td>
                  {cases.map((c, i) => (
                    <td
                      key={i}
                      colSpan={caseColCountPerCase}
                      className="px-1 py-2 text-center border-l-2 border-l-[#D1D5DB] border-r border-r-[#D1D5DB] border-[#D9DCE0]"
                    >
                      <span
                        className="text-xs font-mono text-[#1A1A1A]"
                        title="依「調整百分率絕對值加總」（價格形成因素之相近程度）自動決定，不可手動編輯"
                      >
                        {c.weight}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-[#F0F1F3] bg-[#EEF2F7]">
                  <td className="px-1 py-2.5 text-sm font-semibold text-center text-[#1A1A1A]">
                    比準地比較價格
                  </td>
                  <td
                    colSpan={1 + totalCaseColCount}
                    className="px-1 py-2.5 text-right text-base font-mono font-bold text-[#12457B] border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]"
                  >
                    ＝Σ(各比較標的試算價格×權重)
                    {comparisonForm.benchmarkComparedPrice.toLocaleString()}{" "}
                    元/㎡
                  </td>
                </tr>

                <tr className="bg-[#FFFDE7]">
                  <td
                    colSpan={totalColCount}
                    className="px-3 py-1 text-[10px] font-semibold text-center text-[#1A1A1A]"
                  >
                    備註欄
                  </td>
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-1 py-2 text-xs text-[#1A1A1A] bg-[#FFFDE7]/40 shrink-0">
                    備註
                  </td>
                  <td className="px-1 py-2 border-l border-r-2 border-r-[#D1D5DB] border-[#D9DCE0]">
                    <textarea
                      value={comparisonForm.benchmarkRemark}
                      onChange={(e) => onUpdateBenchmarkRemark(e.target.value)}
                      placeholder="如：比準地選取理由……"
                      rows={2}
                      className="w-full border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-[#12457B] resize-y"
                    />
                  </td>
                  <td
                    colSpan={totalCaseColCount}
                    className="px-1 py-2 border-l-2 border-l-[#D1D5DB] border-[#D9DCE0]"
                  >
                    <textarea
                      value={comparisonForm.caseRemark}
                      onChange={(e) => onUpdateCaseRemark(e.target.value)}
                      placeholder="如：各比較標的日期調整依據、跨區段選取理由等……"
                      rows={2}
                      className="w-full border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-[#12457B] resize-y"
                    />
                  </td>
                </tr>
                <tr className="border-t border-[#D9DCE0]">
                  <td className="px-1 py-2 text-xs text-[#1A1A1A] bg-[#FFFDE7]/40 shrink-0">
                    全案
                  </td>
                  <td
                    colSpan={1 + totalCaseColCount}
                    className="px-1 py-2 border-l border-[#D9DCE0]"
                  >
                    <textarea
                      value={comparisonForm.overallRemark}
                      onChange={(e) => onUpdateOverallRemark(e.target.value)}
                      placeholder="敘明案例稀少放寬蒐集期間之理由等整案說明"
                      rows={3}
                      className="w-full border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-[#12457B] resize-y"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {showOfficialForm ? (
          <div className="bg-white border border-[#D9DCE0] rounded-[4px] flex-1 flex flex-col overflow-hidden">
            <button
              onClick={() => setShowOfficialForm(false)}
              className="w-full flex items-center justify-between px-4 py-2 bg-[#F5F6F7] border-b border-[#D9DCE0] text-[11px] font-semibold text-[#1A1A1A] shrink-0"
            >
              <span>
                表4
                官方正式格式預覽（座落、宗地/道路/接近/周邊/行政條件、備註欄等完整欄位）
              </span>
              <span className="text-[#6B7280]">收合 ▲</span>
            </button>
            <div className="flex-1 overflow-auto p-3">
              <PrintableComparisonForm result={result} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
