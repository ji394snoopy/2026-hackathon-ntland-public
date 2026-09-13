import { useMemo, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import Dot from "../components/Dot";
import SurveyFormGrid from "../components/SurveyFormGrid";
import type { FieldSource, ProduceResult, SurveyField } from "../types";
import type { LocationInput } from "../api/types";

// ①勘查表階段只需要 meta+survey：此時②③尚未產製，result 不是完整的 ProduceResult
type SurveyStageResult = Pick<ProduceResult, "meta" | "survey"> & {
  comparisonSurveys: SurveyField[][]; // 比較標的1~3各自一份勘查表，同頁分頁籤呈現
};

const TAB_LABELS = ["比準地", "比較標的1", "比較標的2", "比較標的3"];

export default function SurveyFormPage({
  result,
  comparisonLocations,
  onUpdateField,
  onConfirmField,
  onSelectFieldFacility,
  onExpandFieldFacility,
  onUpdateComparisonField,
  onConfirmComparisonField,
  onSelectComparisonFieldFacility,
  onExpandComparisonFieldFacility,
  onNext,
  nextLoading,
}: {
  result: SurveyStageResult;
  comparisonLocations?: LocationInput[];
  onUpdateField: (key: string, value: string) => void;
  onConfirmField: (key: string) => void;
  onSelectFieldFacility: (key: string, facilityOptionKey: string) => void;
  onExpandFieldFacility: (key: string) => void;
  onUpdateComparisonField: (
    caseIndex: number,
    key: string,
    value: string,
  ) => void;
  onConfirmComparisonField: (caseIndex: number, key: string) => void;
  onSelectComparisonFieldFacility: (
    caseIndex: number,
    key: string,
    facilityOptionKey: string,
  ) => void;
  onExpandComparisonFieldFacility: (caseIndex: number, key: string) => void;
  onNext: () => void;
  nextLoading?: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const activeFields =
    activeTab === 0 ? result.survey : result.comparisonSurveys[activeTab - 1];

  // 步距（步行距離）背景查詢跨比準地＋比較標的1~3共4份勘查表，任一筆還 pending
  // 就代表 enrichPendingFields 還沒查完，不能讓使用者提前跳到②（見 App.tsx 說明）。
  const pendingCount = useMemo(
    () =>
      [result.survey, ...result.comparisonSurveys]
        .flat()
        .filter((f) => f.pending).length,
    [result.survey, result.comparisonSurveys],
  );
  // 記錄查詢一開始的待查總筆數，做為進度分母：pending 陸續被清掉時分子跟著減少，
  // 分母维持不變才能顯示「已完成 X／Y」而不是一直变动的比例。
  const totalPendingRef = useRef(0);
  if (pendingCount > totalPendingRef.current) {
    totalPendingRef.current = pendingCount;
  }
  const walkingDistanceLoading = pendingCount > 0;
  const totalPending = totalPendingRef.current;
  const resolvedPending = totalPending - pendingCount;

  const counts = activeFields.reduce(
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

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const subtitle =
    activeTab === 0
      ? `區段 ${result.meta.sectionId}｜${result.meta.district}｜${result.meta.landUseType}｜比準地：${result.meta.benchmarkParcel}`
      : `${TAB_LABELS[activeTab]}｜${comparisonLocations?.[activeTab - 1]?.address ?? "（未設定座標）"}`;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader title="地價區段勘查表" subtitle={subtitle} />

      <div className="bg-white border-b border-[#D9DCE0] px-5 flex items-center gap-1 shrink-0">
        {TAB_LABELS.map((label, i) => (
          <button
            key={label}
            onClick={() => setActiveTab(i)}
            className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-colors ${
              activeTab === i
                ? "border-[#12457B] text-[#12457B]"
                : "border-transparent text-[#6B7280] hover:text-[#1A1A1A]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white border-b border-[#D9DCE0] px-5 py-2 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-3 flex-1 text-[11px]">
          <span className="text-[#6B7280]">欄位狀態：</span>
          <span className="flex items-center gap-1">
            <Dot color="#12457B" />
            AI已填 <strong className="font-mono">{counts.ai}</strong>
          </span>
          <span className="flex items-center gap-1">
            <Dot color="#9CA3AF" />
            需人工 <strong className="font-mono">{counts.empty}</strong>
          </span>
          <span className="flex items-center gap-1">
            <Dot color="#6B7280" />
            人工已填 <strong className="font-mono">{counts.manual}</strong>
          </span>
          <span className="flex items-center gap-1">
            <Dot color="#9CA3AF" />
            預填值 <strong className="font-mono">{counts.prefilled}</strong>
          </span>
          <span className="flex items-center gap-1">
            <Dot color="#B7791F" />
            已修改 <strong className="font-mono">{counts.edited}</strong>
          </span>
          <span className="flex items-center gap-1">
            <Dot color="#2E7D32" />
            已確認 <strong className="font-mono">{counts.confirmed}</strong>
          </span>
        </div>

        {walkingDistanceLoading && !nextLoading && (
          <span className="text-[11px] text-[#B7791F]">
            步距查詢中…（{resolvedPending}／{totalPending}）
          </span>
        )}
        <button
          onClick={onNext}
          disabled={nextLoading || walkingDistanceLoading}
          title={
            walkingDistanceLoading ? "步行距離查詢尚未完成，請稍候" : undefined
          }
          className="px-3 py-1 text-[11px] bg-[#12457B] text-white rounded-[4px] hover:bg-[#0F3A66] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {nextLoading
            ? "產製中…"
            : walkingDistanceLoading
              ? "步距查詢中…"
              : "下一步：區域因素分析 →"}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {activeTab === 0 ? (
          <SurveyFormGrid
            fields={result.survey}
            editable
            onUpdateField={onUpdateField}
            onConfirmField={onConfirmField}
            onSelectFieldFacility={onSelectFieldFacility}
            onExpandFieldFacility={onExpandFieldFacility}
          />
        ) : (
          <SurveyFormGrid
            fields={activeFields}
            editable
            onUpdateField={(key, value) =>
              onUpdateComparisonField(activeTab - 1, key, value)
            }
            onConfirmField={(key) =>
              onConfirmComparisonField(activeTab - 1, key)
            }
            onSelectFieldFacility={(key, facilityOptionKey) =>
              onSelectComparisonFieldFacility(
                activeTab - 1,
                key,
                facilityOptionKey,
              )
            }
            onExpandFieldFacility={(key) =>
              onExpandComparisonFieldFacility(activeTab - 1, key)
            }
          />
        )}
      </div>
    </div>
  );
}
