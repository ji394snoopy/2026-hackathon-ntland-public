import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import Dot from "../components/Dot";
import SurveyFormGrid from "../components/SurveyFormGrid";
import PrintableSurveyForm from "../components/PrintableSurveyForm";
import PrintableRegionalFactorForm from "../components/PrintableRegionalFactorForm";
import PrintableComparisonForm from "../components/PrintableComparisonForm";
import PrintableSectionSketchMap from "../components/PrintableSectionSketchMap";
import PrintableZoningMap from "../components/PrintableZoningMap";
import PrintableSectionBoundaryMap from "../components/PrintableSectionBoundaryMap";
import SectionSketchMap from "./map/SectionSketchMap";
import ZoningMap from "./map/ZoningMap";
import SectionBoundaryMap from "./map/SectionBoundaryMap";
import { exportForms } from "../api";
import { exportElementToPdf } from "../lib/exportPdf";
import type { FieldSource, ProduceResult, SupplementaryImage } from "../types";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportPage({
  result,
  images = [],
  reportPdf = null,
}: {
  result: ProduceResult;
  images?: SupplementaryImage[];
  reportPdf?: Blob | null;
}) {
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pdfExportingKey, setPdfExportingKey] = useState<string | null>(null);
  const [reportPdfUrl, setReportPdfUrl] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const regionalPrintRef = useRef<HTMLDivElement>(null);
  const comparisonPrintRef = useRef<HTMLDivElement>(null);
  const sketchMapRef = useRef<HTMLDivElement>(null);
  const zoningMapRef = useRef<HTMLDivElement>(null);
  const boundaryMapRef = useRef<HTMLDivElement>(null);
  const printableSketchRef = useRef<HTMLDivElement>(null);
  const printableZoningRef = useRef<HTMLDivElement>(null);
  const printableBoundaryRef = useRef<HTMLDivElement>(null);

  const counts = result.survey.reduce(
    (acc, f) => {
      acc[f.source]++;
      return acc;
    },
    {
      ai: 0,
      manual: 0,
      edited: 0,
      empty: 0,
      confirmed: 0,
      prefilled: 0,
    } as Record<FieldSource, number>,
  );

  const handleExport = async () => {
    setExporting(true);
    await exportForms(result);
    setExporting(false);
    setExported(true);
  };

  const handleExportPdf = async (
    key: string,
    ref: React.RefObject<HTMLDivElement | null>,
    filename: string,
    orientation?: "portrait" | "landscape",
  ) => {
    if (!ref.current || pdfExportingKey) return;
    setPdfExportingKey(key);
    try {
      await exportElementToPdf(ref.current, filename, { orientation });
    } finally {
      setPdfExportingKey(null);
    }
  };

  // 正式合併報告 PDF 由④產製圖籍頁的「下一步：輸出」觸發（打 G·image-upload 上傳三張圖籍 +
  // Hx·export-report 取回三表+圖籍已合併好的正式 PDF，見 MapProductionPage.tsx），這裡只負責
  // 顯示／下載那份已經產生好的 Blob，不再由前端自己用 html2canvas+jsPDF 重新組一次。
  useEffect(() => {
    if (!reportPdf) {
      setReportPdfUrl(null);
      return;
    }
    const url = URL.createObjectURL(reportPdf);
    setReportPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reportPdf]);

  const handleDownloadReportPdf = () => {
    if (!reportPdfUrl) return;
    const a = document.createElement("a");
    a.href = reportPdfUrl;
    a.download = `${result.meta.sectionId}_正式報告.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="輸出"
        subtitle={`區段 ${result.meta.sectionId}｜三表三圖完整預覽與輸出`}
      />

      <div className="bg-white border-b border-[#D9DCE0] px-5 py-2 flex items-center gap-4 shrink-0">
        <span className="text-[11px] text-[#6B7280]">整體狀態：</span>
        <span className="text-[11px] flex items-center gap-1">
          <Dot color="#12457B" />
          AI已填 <strong className="font-mono">{counts.ai}</strong>
        </span>
        <span className="text-[11px] flex items-center gap-1">
          <Dot color="#9CA3AF" />
          需人工 <strong className="font-mono">{counts.empty}</strong>
        </span>
        <span className="text-[11px] flex items-center gap-1">
          <Dot color="#6B7280" />
          人工已填 <strong className="font-mono">{counts.manual}</strong>
        </span>
        <span className="text-[11px] flex items-center gap-1">
          <Dot color="#9CA3AF" />
          預填值 <strong className="font-mono">{counts.prefilled}</strong>
        </span>
        <span className="text-[11px] flex items-center gap-1 text-[#B7791F]">
          <Dot color="#B7791F" />
          已修改 <strong className="font-mono">{counts.edited}</strong>
        </span>
        <span className="text-[11px] flex items-center gap-1 text-[#2E7D32]">
          <Dot color="#2E7D32" />
          已確認 <strong className="font-mono">{counts.confirmed}</strong>
        </span>
        <div className="flex-1" />
        {reportPdfUrl ? (
          <button
            onClick={handleDownloadReportPdf}
            className="px-4 py-1.5 text-sm bg-[#2E7D32] text-white rounded-[4px] hover:bg-[#256628] font-medium transition-colors"
          >
            下載正式報告 PDF
          </button>
        ) : (
          <span className="text-[11px] text-[#B7791F]">
            尚未產生正式報告 PDF，請返回「④產製圖籍」頁重新輸出
          </span>
        )}
        {/* <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-1.5 text-sm bg-[#12457B] text-white rounded-[4px] hover:bg-[#0F3A66] font-medium transition-colors disabled:opacity-60"
        >
          {exporting
            ? "輸出中…"
            : exported
              ? "✓ 已產生下載連結"
              : "輸出編輯後版本"}
        </button> */}
      </div>

      {exported && (
        <div className="bg-green-50 border-b border-green-200 px-5 py-2 flex items-center gap-4 shrink-0">
          <span className="text-[11px] text-[#2E7D32] font-semibold">
            ✓ 已成功產生輸出檔案
          </span>
          <div className="flex gap-3">
            <button
              onClick={() =>
                downloadJson(
                  `${result.meta.sectionId}_勘查表.json`,
                  result.survey,
                )
              }
              className="text-[11px] text-[#12457B] underline hover:text-[#0F3A66]"
            >
              {result.meta.sectionId}_勘查表.json
            </button>
            <button
              onClick={() =>
                downloadJson(
                  `${result.meta.sectionId}_區域因素分析明細表.json`,
                  result.regionalFactors,
                )
              }
              className="text-[11px] text-[#12457B] underline hover:text-[#0F3A66]"
            >
              {result.meta.sectionId}_區域因素分析明細表.json
            </button>
            <button
              onClick={() =>
                downloadJson(`${result.meta.sectionId}_比較法估價表.json`, {
                  comparison: result.comparison,
                  computed: result.computed,
                })
              }
              className="text-[11px] text-[#12457B] underline hover:text-[#0F3A66]"
            >
              {result.meta.sectionId}_比較法估價表.json
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2.5 bg-[#F5F6F7] border-b border-[#D9DCE0] flex items-center gap-3">
            <span className="text-[11px] font-semibold text-[#1A1A1A]">
              ① 地價區段勘查表
            </span>
            <span className="text-[10px] text-[#9CA3AF]">
              {result.meta.sectionId}｜{result.meta.district}｜
              {result.meta.landUseType}
            </span>
            <div className="flex-1" />
            <span className="text-[10px] text-[#6B7280]">
              AI填 {counts.ai}｜人工{" "}
              {counts.empty + counts.manual + counts.prefilled}｜修改{" "}
              {counts.edited}
            </span>
            {/* <button
              onClick={() =>
                handleExportPdf(
                  "survey",
                  printRef,
                  `${result.meta.sectionId}_地價區段勘查表.pdf`,
                )
              }
              disabled={pdfExportingKey !== null}
              className="px-2.5 py-1 text-[11px] bg-[#12457B] text-white rounded-[4px] hover:bg-[#0F3A66] transition-colors disabled:opacity-60"
            >
              {pdfExportingKey === "survey" ? "產生中…" : "輸出勘查表 PDF"}
            </button> */}
          </div>
          <div className="p-3">
            <SurveyFormGrid fields={result.survey} />
          </div>
        </div>

        {/* 官方版式節點，off-screen 常駐渲染供 html2canvas 擷取（不可用 opacity/visibility 隱藏，否則擷取結果會是空白） */}
        <div
          className="fixed top-0 pointer-events-none"
          style={{ left: "-9999px" }}
          aria-hidden="true"
        >
          <div ref={printRef}>
            <PrintableSurveyForm result={result} />
          </div>
        </div>

        <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2.5 bg-[#F5F6F7] border-b border-[#D9DCE0] flex items-center gap-3">
            <span className="text-[11px] font-semibold text-[#1A1A1A]">
              ② 影響地價區域因素分析明細表
            </span>
            <div className="flex-1" />
            <span className="text-[10px] text-[#6B7280]">
              總修正 {result.computed.regionalTotal >= 0 ? "+" : ""}
              {result.computed.regionalTotal.toFixed(2)}%
            </span>
          </div>
          <div className="bg-white p-3">
            <div className="text-[15px] font-bold text-[#1A1A1A] mb-1">
              表5　影響地價區域因素分析明細表
            </div>
            <div className="text-[11px] text-[#6B7280] mb-3">
              {result.meta.district}｜區段 {result.meta.sectionId}
            </div>
            <table className="w-full">
              <thead className="bg-[#FAFAFA] border-b border-[#E5E7EB]">
                <tr>
                  <th className="px-3 py-1.5 text-left text-[10px] text-[#9CA3AF] font-medium">
                    因素項目
                  </th>
                  <th className="px-3 py-1.5 text-left text-[10px] text-[#9CA3AF] font-medium">
                    等級
                  </th>
                  <th className="px-3 py-1.5 text-right text-[10px] text-[#9CA3AF] font-medium">
                    修正%
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.regionalFactors.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-[#F0F1F3] last:border-0"
                  >
                    <td className="px-3 py-1.5 text-xs text-[#1A1A1A]">
                      {row.label}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-[#374151]">
                      {row.subject.grade || "－"}
                    </td>
                    <td className="px-3 py-1.5 text-xs font-mono text-right">
                      {row.compare[0] && row.compare[0].rate !== null
                        ? `${row.compare[0].rate >= 0 ? "+" : ""}${row.compare[0].rate.toFixed(2)}%`
                        : "－"}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#EEF2F7] border-t border-[#D9DCE0]">
                  <td className="px-3 py-1.5 text-xs font-semibold" colSpan={2}>
                    總修正數
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono font-bold text-[#12457B] text-right">
                    {result.computed.regionalTotal >= 0 ? "+" : ""}
                    {result.computed.regionalTotal.toFixed(2)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 官方版式節點，off-screen 常駐渲染供 html2canvas 擷取（不可用 opacity/visibility 隱藏，否則擷取結果會是空白） */}
        <div
          className="fixed top-0 pointer-events-none"
          style={{ left: "-9999px" }}
          aria-hidden="true"
        >
          <div ref={regionalPrintRef}>
            <PrintableRegionalFactorForm result={result} />
          </div>
        </div>

        <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2.5 bg-[#F5F6F7] border-b border-[#D9DCE0] flex items-center gap-3">
            <span className="text-[11px] font-semibold text-[#1A1A1A]">
              ③ 比較法調查估價表
            </span>
            <div className="flex-1" />
            <span className="text-[10px] text-[#6B7280]">
              試算價格：{result.computed.trialPrice.toLocaleString()} 元/㎡
            </span>
          </div>
          <div className="p-3">
            <table className="w-full">
              <thead className="bg-[#FAFAFA] border-b border-[#E5E7EB]">
                <tr>
                  <th className="px-3 py-1.5 text-left text-[10px] text-[#9CA3AF] font-medium">
                    項目
                  </th>
                  <th className="px-3 py-1.5 text-right text-[10px] text-[#9CA3AF] font-medium">
                    差異率 / 試算值
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.comparison.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-[#F0F1F3] last:border-0"
                  >
                    <td className="px-3 py-1.5 text-xs text-[#374151]">
                      {row.label}
                    </td>
                    <td className="px-3 py-1.5 text-xs font-mono text-right">
                      {row.compare[0] && row.compare[0].rate !== null
                        ? `${row.compare[0].rate >= 0 ? "+" : ""}${row.compare[0].rate.toFixed(2)}%`
                        : "－"}
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-3 py-1.5 text-xs font-semibold text-[#1A1A1A]">
                    個別因素合計
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono font-semibold text-right">
                    {result.computed.individualTotal >= 0 ? "+" : ""}
                    {result.computed.individualTotal.toFixed(2)}%
                  </td>
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-3 py-1.5 text-xs text-[#374151]">
                    日期調整
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-right">
                    {result.computed.dateAdj >= 0 ? "+" : ""}
                    {result.computed.dateAdj.toFixed(2)}%
                  </td>
                </tr>
                <tr className="border-b border-[#F0F1F3]">
                  <td className="px-3 py-1.5 text-xs text-[#374151]">
                    區域因素調整
                  </td>
                  <td className="px-3 py-1.5 text-xs font-mono text-right">
                    {result.computed.regionalTotal >= 0 ? "+" : ""}
                    {result.computed.regionalTotal.toFixed(2)}%
                  </td>
                </tr>
                <tr className="bg-[#EEF2F7]">
                  <td className="px-3 py-1.5 text-sm font-semibold text-[#1A1A1A]">
                    試算價格
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#12457B] font-bold text-sm font-mono">
                    {result.computed.trialPrice.toLocaleString()} 元/㎡
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 官方版式節點，off-screen 常駐渲染供 html2canvas 擷取（不可用 opacity/visibility 隱藏，否則擷取結果會是空白） */}
        <div
          className="fixed top-0 pointer-events-none"
          style={{ left: "-9999px" }}
          aria-hidden="true"
        >
          <div ref={comparisonPrintRef}>
            <PrintableComparisonForm result={result} />
          </div>
        </div>

        <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2.5 bg-[#F5F6F7] border-b border-[#D9DCE0] flex items-center gap-3">
            <span className="text-[11px] font-semibold text-[#1A1A1A]">
              ④ 地價區段略圖
            </span>
            <div className="flex-1" />
          </div>
          <div className="p-3">
            <div ref={sketchMapRef} className="h-[440px] flex gap-3 bg-white">
              <SectionSketchMap result={result} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2.5 bg-[#F5F6F7] border-b border-[#D9DCE0] flex items-center gap-3">
            <span className="text-[11px] font-semibold text-[#1A1A1A]">
              ⑤ 地價使用分區圖
            </span>
            <div className="flex-1" />
          </div>
          <div className="p-3">
            <div ref={zoningMapRef} className="h-[440px] flex gap-3 bg-white">
              <ZoningMap result={result} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2.5 bg-[#F5F6F7] border-b border-[#D9DCE0] flex items-center gap-3">
            <span className="text-[11px] font-semibold text-[#1A1A1A]">
              ⑥ 查估地價區段圖
            </span>
            <div className="flex-1" />
          </div>
          <div className="p-3">
            <div ref={boundaryMapRef} className="h-[440px] flex gap-3 bg-white">
              <SectionBoundaryMap result={result} />
            </div>
          </div>
        </div>

        {images.length > 0 && (
          <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
            <div className="px-4 py-2.5 bg-[#F5F6F7] border-b border-[#D9DCE0] flex items-center gap-3">
              <span className="text-[11px] font-semibold text-[#1A1A1A]">
                ⑦ 補充圖片
              </span>
              <span className="text-[10px] text-[#9CA3AF]">
                共 {images.length} 張，隨「一鍵輸出」附加於 PDF 末頁
              </span>
            </div>
            <div className="p-3 grid grid-cols-6 gap-2">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="aspect-square bg-[#F5F6F7] border border-[#D9DCE0] rounded-[4px] overflow-hidden"
                >
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 官方版式節點，off-screen 常駐渲染供 html2canvas 擷取（不可用 opacity/visibility 隱藏，否則擷取結果會是空白；
        也不可用 0x0/overflow:hidden 裁切祖先，html2canvas 會把目標元素判定為零尺寸而擷取失敗） */}
        <div
          className="fixed top-0 pointer-events-none"
          style={{ left: "-9999px" }}
          aria-hidden="true"
        >
          <div ref={printableSketchRef}>
            <PrintableSectionSketchMap result={result} />
          </div>
          <div ref={printableZoningRef}>
            <PrintableZoningMap result={result} />
          </div>
          <div ref={printableBoundaryRef}>
            <PrintableSectionBoundaryMap result={result} />
          </div>
        </div>
      </div>
    </div>
  );
}
