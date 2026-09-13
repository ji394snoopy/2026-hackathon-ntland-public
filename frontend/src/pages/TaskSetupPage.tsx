import { useState } from "react";
import PageHeader from "../components/PageHeader";
import PdfUpload from "../components/PdfUpload";
import BoundaryRangeMap, {
  type BoundaryPinValue,
} from "../components/BoundaryRangeMap";
import {
  BENCHMARK_BOUNDARY_PREFILL,
  COMPARISON1_BOUNDARY_PREFILL,
  COMPARISON2_BOUNDARY_PREFILL,
  COMPARISON3_BOUNDARY_PREFILL,
} from "../mock/boundaryPrefillData";
import { produceSurvey } from "../api";
import type { LocationInput, ProduceSurveyResponse } from "../api/types";

export default function TaskSetupPage({
  onProduced,
}: {
  onProduced: (
    survey: ProduceSurveyResponse,
    comparisonSurveys: ProduceSurveyResponse[],
    locations: {
      benchmarkLocation?: LocationInput;
      comparisonLocations?: LocationInput[];
    },
  ) => void;
}) {
  const [sectionId, setSectionId] = useState("P002-00");
  const [sectionRange, setSectionRange] = useState(
    "北至金包里街、南至中山路、西至中正路、東至福德街",
  );
  const [benchmarkPin, setBenchmarkPin] = useState<BoundaryPinValue>(
    () => BENCHMARK_BOUNDARY_PREFILL,
  );
  const [comparisonTargets, setComparisonTargets] = useState<
    BoundaryPinValue[]
  >(() => [
    COMPARISON1_BOUNDARY_PREFILL,
    COMPARISON2_BOUNDARY_PREFILL,
    COMPARISON3_BOUNDARY_PREFILL,
  ]);
  const [progress, setProgress] = useState(-1);
  const [currentStep, setCurrentStep] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState(-1);
  const [retryCount, setRetryCount] = useState(0);

  const steps = ["查詢周邊設施", "查詢使用分區", "比對基準表", "產出草稿"];

  const locationsReady =
    benchmarkPin.lat != null &&
    benchmarkPin.lng != null &&
    comparisonTargets.every(
      (target) => target.lat != null && target.lng != null,
    );

  const handleStart = async () => {
    if (loading || !locationsReady) return;
    setLoading(true);
    setError(null);
    setFailedStep(-1);
    setProgress(0);

    const runStep = (step: number) => {
      setCurrentStep(step);
      setTimeout(() => {
        setProgress(step + 1);
        if (step + 1 < steps.length) {
          setTimeout(() => runStep(step + 1), 350);
        }
      }, 900);
    };
    runStep(0);

    try {
      const benchmarkLocation: LocationInput = {
        address: benchmarkPin.city + benchmarkPin.district + benchmarkPin.text,
        lat: benchmarkPin.lat!,
        lng: benchmarkPin.lng!,
        corners: benchmarkPin.corners ?? undefined,
      };
      const comparisonLocations: LocationInput[] = comparisonTargets.map(
        (target) => ({
          address: target.city + target.district + target.text,
          lat: target.lat!,
          lng: target.lng!,
          corners: target.corners ?? undefined,
        }),
      );

      // ①表3勘查表：比準地＋三個比較標的各自產一份，同一頁分頁籤呈現（見 SurveyFormPage.tsx）；
      // ②③要等使用者逐步確認①後才會呼叫，比較標的座標(comparisonLocations)先留著供③表4產製時使用
      const [
        benchmarkSurvey,
        comparison1Survey,
        comparison2Survey,
        comparison3Survey,
      ] = await Promise.all([
        produceSurvey({
          sectionId,
          locationRole: "benchmark",
          location: benchmarkLocation,
        }),
        produceSurvey({
          sectionId,
          locationRole: "comparison1",
          location: comparisonLocations[0],
        }),
        produceSurvey({
          sectionId,
          locationRole: "comparison2",
          location: comparisonLocations[1],
        }),
        produceSurvey({
          sectionId,
          locationRole: "comparison3",
          location: comparisonLocations[2],
        }),
      ]);

      setLoading(false);
      setError(null);
      setRetryCount(0);
      onProduced(
        benchmarkSurvey,
        [comparison1Survey, comparison2Survey, comparison3Survey],
        { benchmarkLocation, comparisonLocations },
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const displayError = `產製失敗：${errorMessage}`;
      setError(displayError);
      setFailedStep(currentStep);
      setLoading(false);
      console.error("produce-survey 失敗", err);
    }
  };

  const handleRetry = () => {
    // 清除錯誤，讓使用者可以重新點「開始 AI 產製」重試
    setError(null);
    setRetryCount(retryCount + 1);
  };

  return (
    <div className="h-full overflow-auto bg-[#F5F6F7]">
      <PageHeader
        title="產製任務起點"
        subtitle="設定區段基本資訊，啟動 AI 自動查詢填寫"
      />
      <div className="p-5 max-w-2xl space-y-4">
        {/* <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2 border-b border-[#D9DCE0] text-[10px] font-semibold text-[#6B7280] tracking-widest uppercase">
            基本資訊
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-[11px] text-[#6B7280] mb-1">
                區段編號
              </label>
              <input
                type="text"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                disabled={loading}
                className="w-full border border-[#D9DCE0] rounded-[4px] px-2.5 py-1.5 text-sm font-mono bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B] focus:ring-1 focus:ring-[#12457B]/20 disabled:bg-[#F5F6F7]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] mb-1">
                區段範圍{" "}
                <span className="text-[#9CA3AF] font-normal">
                  （主辦提供，可修改）
                </span>
              </label>
              <textarea
                value={sectionRange}
                onChange={(e) => setSectionRange(e.target.value)}
                disabled={loading}
                rows={2}
                className="w-full border border-[#D9DCE0] rounded-[4px] px-2.5 py-1.5 text-sm bg-white text-[#1A1A1A] leading-relaxed resize-none focus:outline-none focus:border-[#12457B] focus:ring-1 focus:ring-[#12457B]/20 disabled:bg-[#F5F6F7]"
              />
            </div>

            <div className="pt-1 border-t border-[#D9DCE0] mt-1">
              <PdfUpload
                label="主辦提供之勘查表 PDF（選填，僅基本資料已填，其餘留空，供對照手動輸入）"
                hint="競賽當天主辦提供，僅接受 .pdf"
                disabled={loading}
              />
            </div>
          </div>
        </div> */}

        <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2 border-b border-[#D9DCE0] text-[10px] font-semibold text-[#6B7280] tracking-widest uppercase">
            地點標記{" "}
            <span className="text-[#9CA3AF] font-normal normal-case">
              （輸入「沿OO以北、OO以西、OO以南及OO以東之OO區」四至文字，解析出範圍）
            </span>
          </div>
          <div className="p-4 space-y-5">
            <BoundaryRangeMap
              label="比準地位置"
              glyph="準"
              color="#12457B"
              value={benchmarkPin}
              onChange={setBenchmarkPin}
              disabled={loading}
            />

            {comparisonTargets.map((target, index) => (
              <div key={index} className="pt-4 border-t border-[#D9DCE0]">
                <BoundaryRangeMap
                  label={`比較標的位置 ${index + 1}`}
                  glyph={String(index + 1)}
                  color={["#C2410C", "#DC2626", "#EA580C"][index]}
                  value={target}
                  onChange={(newValue) => {
                    const newTargets = [...comparisonTargets];
                    newTargets[index] = newValue;
                    setComparisonTargets(newTargets);
                  }}
                  disabled={loading}
                  focusHint={
                    benchmarkPin.lat != null && benchmarkPin.lng != null
                      ? { lat: benchmarkPin.lat, lng: benchmarkPin.lng }
                      : null
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
          <div className="px-4 py-2 border-b border-[#D9DCE0] text-[10px] font-semibold text-[#6B7280] tracking-widest uppercase">
            載入評價基準明細表
          </div>
          <div className="p-4">
            <PdfUpload
              label="評價基準明細表"
              hint="競賽當天主辦提供，僅接受 .pdf"
              disabled={loading}
            />
          </div>
        </div> */}

        {progress >= 0 && (
          <div className="bg-white border border-[#D9DCE0] rounded-[4px]">
            <div className="px-4 py-2 border-b border-[#D9DCE0] text-[10px] font-semibold text-[#6B7280] tracking-widest uppercase">
              AI 產製進度
            </div>
            <div className="p-4 space-y-2.5">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 transition-colors ${
                      progress > i
                        ? "bg-[#2E7D32] text-white"
                        : currentStep === i
                          ? "bg-[#12457B] text-white"
                          : "bg-[#E5E7EB] text-[#9CA3AF]"
                    }`}
                  >
                    {progress > i ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-xs transition-colors ${
                      progress > i
                        ? "text-[#2E7D32]"
                        : currentStep === i
                          ? "text-[#12457B] font-medium"
                          : "text-[#9CA3AF]"
                    }`}
                  >
                    {step}
                  </span>
                  {progress > i && (
                    <span className="text-[10px] text-[#2E7D32] ml-auto">
                      完成
                    </span>
                  )}
                  {currentStep === i && progress <= i && (
                    <span className="text-[10px] text-[#12457B] ml-auto animate-pulse">
                      查詢中...
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          {error && (
            <div className="mb-3 bg-[#FEE2E2] border border-[#FECACA] rounded-[4px] p-3">
              <div className="text-[11px] text-[#DC2626] font-medium mb-1.5">
                ⚠️ 產製失敗
              </div>
              <div className="text-[10px] text-[#991B1B] mb-2 leading-relaxed break-words">
                {error}
              </div>
              <div className="text-[9px] text-[#7F1D1D] mb-2">
                {retryCount > 0 && `已重試 ${retryCount} 次`}
              </div>
              <button
                onClick={handleRetry}
                disabled={loading}
                className="bg-[#DC2626] text-white px-3 py-1.5 rounded-[4px] text-[10px] font-medium hover:bg-[#B91C1C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                重新嘗試
              </button>
            </div>
          )}
          <button
            onClick={handleStart}
            disabled={loading || !locationsReady || error !== null}
            className="bg-[#12457B] text-white px-5 py-2 rounded-[4px] text-sm font-medium hover:bg-[#0F3A66] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            開始 AI 產製
          </button>
          {!locationsReady && (
            <div className="text-[11px] text-[#9CA3AF] mt-1.5">
              請先在「地點標記」完成比準地與比較標的之地圖定位
            </div>
          )}
          {error && (
            <div className="text-[11px] text-[#7F1D1D] mt-1.5">
              ✓ 失敗時無法進入下一步勘查表，請成功重試後才能繼續
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] text-[#6B7280] mb-2">將產出三張表：</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "勘查表", desc: "地價區段勘查表", note: "約 60 欄位" },
              {
                label: "區域因素明細表",
                desc: "影響地價區域因素分析明細表",
                note: "約 12 因素",
              },
              {
                label: "比較法估價表",
                desc: "比較法調查估價表",
                note: "差異率及試算價格",
              },
            ].map((c) => (
              <div
                key={c.label}
                className="bg-white border border-[#D9DCE0] rounded-[4px] p-3"
              >
                <div className="text-xs font-semibold text-[#1A1A1A] mb-1">
                  {c.label}
                </div>
                <div className="text-[10px] text-[#6B7280] leading-relaxed">
                  {c.desc}
                </div>
                <div className="text-[10px] text-[#9CA3AF] mt-1.5">
                  {c.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
