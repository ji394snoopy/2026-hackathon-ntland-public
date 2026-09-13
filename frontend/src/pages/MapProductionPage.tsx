import { useRef, useState } from "react";
import { exportReport, uploadCaseImage } from "../api";
import type { Table1Final } from "../api/types";
import PageHeader from "../components/PageHeader";
import PrintableSectionBoundaryMap from "../components/PrintableSectionBoundaryMap";
import PrintableSectionSketchMap from "../components/PrintableSectionSketchMap";
import PrintableZoningMap from "../components/PrintableZoningMap";
import { captureElementAsJpegBase64 } from "../lib/exportPdf";
import { landUseTypeToPurpose } from "../lib/zoneTypeMapping";
import type { ProduceResult } from "../types";
import FacilityDistanceMap from "./map/FacilityDistanceMap";
import SectionBoundaryMap from "./map/SectionBoundaryMap";
import SectionSketchMap from "./map/SectionSketchMap";
import ZoningMap from "./map/ZoningMap";

const TABS = [
  { key: "distance", label: "設施距離示意圖" },
  { key: "section", label: "地價區段圖" },
  { key: "zoning", label: "使用分區圖" },
  { key: "sketch", label: "區段略圖" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ④→輸出：把官方版式的三張圖籍（區段圖／使用分區圖／區段略圖）各自擷取成 JPEG，
// 依序打 G（image-upload）存進 caseId 的案件資料夾，再把這次上傳回來的 s3Key 依序交給
// Hx（export-report）直接從 S3 讀取、併同三表定稿合成正式報告 PDF（見 API_REFERENCE.md §G／§Hx）。
// 帶 s3Keys 而不是 caseId：資料夾裡可能還有之前留下的舊圖（例如舊版的 PNG），只併這次上傳的。
const MAP_CAPTURES = [
  { fileName: "section-boundary-map.jpg" },
  { fileName: "zoning-map.jpg" },
  { fileName: "sketch-map.jpg" },
] as const;

export default function MapProductionPage({
  result,
  comparisonSurveys,
  caseId,
  onExported,
  onNext,
}: {
  result: ProduceResult;
  // 比較標的1~3各自的表1定稿（meta+survey+benchmark），供匯出報告逐份出表1用；
  // ProduceResult 本身只留比準地那一份 survey（見 App.tsx toProduceResult 註解）。
  comparisonSurveys: Table1Final[];
  caseId: string;
  onExported: (url: string) => void;
  onNext: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("distance");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [zoningReady, setZoningReady] = useState(false);
  const boundaryRef = useRef<HTMLDivElement>(null);
  const zoningRef = useRef<HTMLDivElement>(null);
  const sketchRef = useRef<HTMLDivElement>(null);

  const handleNext = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      // 分區圖資料是背景打 API 查的，擷取前先等它就緒（最多等10秒，逾時就照目前畫面擷取）
      const start = Date.now();
      while (!zoningReady && Date.now() - start < 10000) {
        await new Promise((r) => setTimeout(r, 100));
      }

      const captureRefs = [boundaryRef, zoningRef, sketchRef];
      const s3Keys: string[] = [];
      for (let i = 0; i < MAP_CAPTURES.length; i++) {
        const node = captureRefs[i].current;
        if (!node) continue;
        const dataBase64 = await captureElementAsJpegBase64(node);
        const { s3Key } = await uploadCaseImage({
          caseId,
          fileName: MAP_CAPTURES[i].fileName,
          contentType: "image/jpeg",
          dataBase64,
        });
        s3Keys.push(s3Key);
      }

      const { url } = await exportReport({
        caseId,
        // 比準地 + 比較標的1~3，依序送給後端逐份出表1（見 export-report 契約：survey 給陣列）。
        surveys: [
          {
            meta: result.meta,
            survey: result.survey,
            benchmark: result.comparisonForm.benchmark,
          },
          ...comparisonSurveys,
        ],
        regional: {
          purpose: landUseTypeToPurpose(result.meta.landUseType),
          content: {
            regionalFactors: result.regionalFactors,
            meta: { sectionId: result.meta.sectionId },
          },
        },
        comparison: result.comparisonForm,
      });

      // 回應已改成 S3 連結，收到後直接觸發瀏覽器下載，不用等使用者跳到「⑥輸出」頁再手動點。
      const a = document.createElement("a");
      a.href = url;
      a.download = `${result.meta.sectionId}_正式報告.pdf`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();

      onExported(url);
      onNext();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="產製圖籍"
        subtitle={`區段 ${result.meta.sectionId} 位置圖｜周邊設施距離示意`}
      />

      <div className="bg-white border-b border-[#D9DCE0] px-5 py-2 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-2.5 py-1 text-[11px] rounded-[4px] transition-colors ${
                tab === t.key
                  ? "bg-[#12457B] text-white font-medium"
                  : "text-[#6B7280] hover:bg-[#F5F6F7]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {exportError && (
          <span
            className="text-[11px] text-[#B7791F] max-w-md truncate"
            title={exportError}
          >
            {exportError}
          </span>
        )}
        {/* <button className="px-3 py-1 text-[11px] border border-[#D9DCE0] rounded-[4px] text-[#6B7280] hover:border-[#12457B] hover:text-[#12457B]">
          匯出圖籍
        </button> */}
        <button
          onClick={handleNext}
          disabled={exporting}
          className="px-3 py-1 text-[11px] bg-[#12457B] text-white rounded-[4px] hover:bg-[#0F3A66] disabled:opacity-60"
        >
          {exporting ? "圖籍上傳並產製報告中…" : "下一步：輸出 →"}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 flex gap-4">
        {tab === "distance" && <FacilityDistanceMap result={result} />}
        {tab === "section" && <SectionBoundaryMap result={result} />}
        {tab === "zoning" && <ZoningMap result={result} />}
        {tab === "sketch" && <SectionSketchMap result={result} />}
      </div>

      {/* 官方版式節點，off-screen 常駐渲染供 html2canvas 擷取（不可用 opacity/visibility 隱藏，否則擷取結果會是空白） */}
      <div
        className="fixed top-0 pointer-events-none"
        style={{ left: "-9999px" }}
        aria-hidden="true"
      >
        <div ref={boundaryRef}>
          <PrintableSectionBoundaryMap result={result} />
        </div>
        <div ref={zoningRef}>
          <PrintableZoningMap
            result={result}
            onReady={() => setZoningReady(true)}
          />
        </div>
        <div ref={sketchRef}>
          <PrintableSectionSketchMap result={result} />
        </div>
      </div>
    </div>
  );
}
