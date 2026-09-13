import { useState } from "react";
import type {
  ComparisonCondition,
  ComparisonForm,
  FactorRow,
  FieldSource,
  ProduceResult,
  RegionalFactorRemarks,
  RegionalFactorRow,
  SupplementaryImage,
  SurveyField,
} from "./types";
import type { LocationInput } from "./api/types";
import { applySurveyLinkage } from "./lib/formLinkage";
import { computeCompareCell } from "./lib/regionalFactorBrackets";
import { recomputeChain } from "./lib/pricing";
import { deriveLandUseTypeFromZoneType } from "./lib/zoneTypeMapping";
import {
  produceComparison,
  produceRegionalFactors,
  enrichSurveyWithWalkingDistances,
  selectSurveyFacilityOption,
  resolveFacilityAlternates,
} from "./api";
import TaskSetupPage from "./pages/TaskSetupPage";
import SurveyFormPage from "./pages/SurveyFormPage";
import RegionalFactorPage from "./pages/RegionalFactorPage";
import ComparisonAppraisalPage from "./pages/ComparisonAppraisalPage";
import MapProductionPage from "./pages/MapProductionPage";
import ExportPage from "./pages/ExportPage";

type PageId = 0 | 1 | 2 | 3 | 4 | 6;

// 三階段產製逐步累積出來的狀態：①產製完只有 survey+benchmark；
// ②使用者確認①後才會有 regionalFactors/regionalTotal；
// ③使用者確認②後才會有 comparison/comparisonForm/computed —— 到這裡才等於完整的 ProduceResult。
// 用 Partial 收斂「表還沒產製出來」跟「已產製待確認」两種狀態，避免在資料還不存在的階段
// 就得塞假的空表進 ProduceResult，讓型別老實反映「這一步到底做到哪」。
type ProduceState = {
  meta: ProduceResult["meta"];
  survey: SurveyField[];
  // 比較標的1~3各自一份地價區段勘查表，跟比準地 survey 同一階段①產製、同一頁面分頁籤呈現
  // （見 SurveyFormPage.tsx）；純documentation用途，不像 survey(比準地) 會透過 SURVEY_LINKAGE
  // 連動②③的計算欄位——比較標的實際影響估價的條件資料走 comparisonForm.cases[i]，不是這裡。
  comparisonSurveys: SurveyField[][];
  // 比較標的1~3各自的表1 meta／宗地條件：①產製當下就有（見 TaskSetupPage 對每個
  // locationRole 各打一次 produceSurvey()），只在此保留供②呼叫 E0
  // （produce-regional-factors）組出完整表1定稿用，不隨使用者編輯 survey 而變動。
  comparisonMeta: ProduceResult["meta"][];
  comparisonConditions: ComparisonCondition[];
  benchmark: ComparisonCondition; // 表4比準地條件，①產製即確定，②③沿用/最終落地
  regionalFactors?: RegionalFactorRow[];
  regionalFactorRemarks?: RegionalFactorRemarks;
  regionalTotal?: number;
  caseCode?: string;
  comparisonCases?: { caseNo: string; sectionId: string }[];
  comparison?: FactorRow[];
  comparisonForm?: ComparisonForm;
  computed?: ProduceResult["computed"];
};

// 使用者在「產製任務」頁標記的比準地／比較標的座標；③表4產製時仍需要比較標的座標
// 去查周邊設施，因此在 App 這一層保留下來，供後續階段呼叫用，不必往返塞進每個階段的回應裡。
type PickedLocations = {
  benchmarkLocation?: LocationInput;
  comparisonLocations?: LocationInput[];
};

// 暫代：案件 caseId 目前整個系統還沒有「開案」流程，image-upload 需要它分 S3 資料夾。
// 每次載入頁面各給一個，避免所有人的圖都堆進同一個資料夾；之後接上正式建案流程時再換成
// 後端配發的真實 caseId。
const CASE_ID = `demo-${Date.now()}`;

const NAV_ITEMS: { label: string; page: PageId }[] = [
  { label: "產製任務", page: 0 },
  { label: "① 勘查表", page: 1 },
  { label: "② 區域因素分析明細表", page: 2 },
  { label: "③ 比較法估價表", page: 3 },
  { label: "產製圖籍", page: 4 },
  { label: "輸出", page: 6 },
];

function computeNextSource(old: FieldSource, value: string): FieldSource {
  if (!value.trim()) return "empty";
  if (old === "empty") return "manual";
  if (old === "ai" || old === "confirmed" || old === "prefilled")
    return "edited";
  return old;
}

// ③完成後，state 的所有欄位都已就緒，組回完整 ProduceResult 供④⑤(產製圖籍/輸出)使用。
function toProduceResult(state: ProduceState): ProduceResult {
  if (
    !state.regionalFactors ||
    state.regionalTotal === undefined ||
    !state.comparison ||
    !state.comparisonForm ||
    !state.computed
  ) {
    throw new Error("尚未完成三階段產製，無法組成完整結果");
  }
  return {
    meta: state.meta,
    survey: state.survey,
    regionalFactors: state.regionalFactors,
    regionalFactorRemarks: state.regionalFactorRemarks,
    caseCode: state.caseCode,
    comparisonCases: state.comparisonCases,
    comparison: state.comparison,
    comparisonForm: state.comparisonForm,
    computed: state.computed,
  };
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(0);
  const [result, setResult] = useState<ProduceState | null>(null);
  const [locations, setLocations] = useState<PickedLocations>({});
  const [stageLoading, setStageLoading] = useState(false);
  const [images, setImages] = useState<SupplementaryImage[]>([]);
  const [reportPdfUrl, setReportPdfUrl] = useState<string | null>(null);

  const addImages = (added: SupplementaryImage[]) => {
    setImages((prev) => [...prev, ...added]);
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  // 只套用「當下仍是 pending」的欄位：使用者若在背景查詢完成前已手動編輯/確認過該欄位，
  // pending 早被清掉，這裡就不會拿背景查到的步行距離蓋掉使用者已經填的值。
  const applyEnrichedFields = (
    liveSurvey: SurveyField[],
    enriched: SurveyField[],
  ): SurveyField[] =>
    liveSurvey.map((liveField) => {
      if (!liveField.pending) return liveField;
      return enriched.find((f) => f.key === liveField.key) ?? liveField;
    });

  // 表3頁面已經用直線距離快速呈現（見 produceSurvey 的 skipWalkingDistance），這裡背景
  // 補查步行距離，不擋頁面切換；查完後只回填還在 pending 的欄位到目前的 state。
  const enrichPendingFields = async (
    location: LocationInput | undefined,
    initialSurvey: SurveyField[],
    applyUpdater: (updater: (survey: SurveyField[]) => SurveyField[]) => void,
  ) => {
    if (!location) return;
    try {
      const enriched = await enrichSurveyWithWalkingDistances(
        { lat: location.lat, lng: location.lng },
        initialSurvey,
      );
      applyUpdater((liveSurvey) => applyEnrichedFields(liveSurvey, enriched));
    } catch (err) {
      console.warn("背景補步行距離失敗", err);
    }
  };

  const updateSurveyField = (key: string, value: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const survey = prev.survey.map((f) =>
        f.key !== key
          ? f
          : { ...f, value, source: computeNextSource(f.source, value) },
      );
      // 表3欄位一有變動就即時同步到表4比準地對應欄位（同一筆地），
      // ②表5已產製的話也同步更新佐證文字（grade/rate 本身不因手動編輯表3而自動重算）
      const linked = applySurveyLinkage(
        {
          survey,
          benchmark: prev.benchmark,
          regionalFactors: prev.regionalFactors,
          compareCase: prev.comparisonForm?.cases[0],
        },
        key,
      );

      // 若編輯 zone_type（使用分區），同步更新 meta 中的 landUseType
      let updatedMeta = prev.meta;
      if (key === "zone_type") {
        updatedMeta = {
          ...prev.meta,
          landUseType: deriveLandUseTypeFromZoneType(value),
        };
      }

      return {
        ...prev,
        meta: updatedMeta,
        survey: linked.survey,
        benchmark: linked.benchmark,
        regionalFactors: linked.regionalFactors ?? prev.regionalFactors,
      };
    });
  };

  const confirmSurveyField = (key: string) => {
    setResult((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            survey: prev.survey.map((f) =>
              f.key !== key ? f : { ...f, source: "confirmed" },
            ),
          },
    );
  };

  // 設施類欄位（見 SURVEY_FACILITY_KIND）AI 只會自動選一筆填入 value，但判準（最近／學制
  // 優先序）不一致；facilityOptionKey 對應 field.facilityOptions 裡的某一筆，讓使用者手動
  // 切換成其他候選。跟 updateSurveyField 一樣要走 SURVEY_LINKAGE 同步表4比準地對應欄位。
  const selectSurveyFieldFacility = (
    key: string,
    facilityOptionKey: string,
  ) => {
    setResult((prev) => {
      if (!prev) return prev;
      const survey = prev.survey.map((f) =>
        f.key !== key ? f : selectSurveyFacilityOption(f, facilityOptionKey),
      );
      const linked = applySurveyLinkage(
        {
          survey,
          benchmark: prev.benchmark,
          regionalFactors: prev.regionalFactors,
          compareCase: prev.comparisonForm?.cases[0],
        },
        key,
      );
      return {
        ...prev,
        survey: linked.survey,
        benchmark: linked.benchmark,
        regionalFactors: linked.regionalFactors ?? prev.regionalFactors,
      };
    });
  };

  // 使用者展開某設施類欄位的候選清單時才呼叫：系統選中的那筆已經在①產製當下查過步行
  // 距離，其餘候選當初刻意沒查（見 api/index.ts resolveFacilityAlternates 說明），這裡才
  // 補查，不在①一產製完就對所有候選打一堆 OSRM。
  const expandSurveyFieldFacility = (key: string) => {
    const location = locations.benchmarkLocation;
    const field = result?.survey.find((f) => f.key === key);
    if (!location || !field) return;
    void resolveFacilityAlternates(
      { lat: location.lat, lng: location.lng },
      field,
    ).then((updated) => {
      setResult((prev) =>
        !prev
          ? prev
          : {
              ...prev,
              survey: prev.survey.map((f) => (f.key === key ? updated : f)),
            },
      );
    });
  };

  // 比較標的1~3的勘查表分頁籤：純documentation，不像比準地 survey 會連動②③(SURVEY_LINKAGE)，
  // 只是單純的欄位值/狀態編輯
  const updateComparisonSurveyField = (
    caseIndex: number,
    key: string,
    value: string,
  ) => {
    setResult((prev) => {
      if (!prev) return prev;
      const comparisonSurveys = prev.comparisonSurveys.map((survey, i) =>
        i !== caseIndex
          ? survey
          : survey.map((f) =>
              f.key !== key
                ? f
                : { ...f, value, source: computeNextSource(f.source, value) },
            ),
      );
      return { ...prev, comparisonSurveys };
    });
  };

  const confirmComparisonSurveyField = (caseIndex: number, key: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const comparisonSurveys: SurveyField[][] = prev.comparisonSurveys.map(
        (survey, i) =>
          i !== caseIndex
            ? survey
            : survey.map((f) =>
                f.key !== key ? f : { ...f, source: "confirmed" as const },
              ),
      );
      return { ...prev, comparisonSurveys };
    });
  };

  const selectComparisonSurveyFieldFacility = (
    caseIndex: number,
    key: string,
    facilityOptionKey: string,
  ) => {
    setResult((prev) => {
      if (!prev) return prev;
      const comparisonSurveys = prev.comparisonSurveys.map((survey, i) =>
        i !== caseIndex
          ? survey
          : survey.map((f) =>
              f.key !== key
                ? f
                : selectSurveyFacilityOption(f, facilityOptionKey),
            ),
      );
      return { ...prev, comparisonSurveys };
    });
  };

  const expandComparisonSurveyFieldFacility = (
    caseIndex: number,
    key: string,
  ) => {
    const location = locations.comparisonLocations?.[caseIndex];
    const field = result?.comparisonSurveys[caseIndex]?.find(
      (f) => f.key === key,
    );
    if (!location || !field) return;
    void resolveFacilityAlternates(
      { lat: location.lat, lng: location.lng },
      field,
    ).then((updated) => {
      setResult((prev) => {
        if (!prev) return prev;
        const comparisonSurveys = prev.comparisonSurveys.map((survey, i) =>
          i !== caseIndex
            ? survey
            : survey.map((f) => (f.key === key ? updated : f)),
        );
        return { ...prev, comparisonSurveys };
      });
    });
  };

  // ① → ②：使用者確認表3後，打 E0（produce-regional-factors）：比準地 + 各比較標的各自的
  // 表1定稿（meta+survey+benchmark）送給後端，內部各評一次區域因素再合成表5比較欄。
  const confirmSurveyAndProduceRegionalFactors = async () => {
    if (!result) return;
    setStageLoading(true);
    try {
      const res = await produceRegionalFactors({
        sectionId: result.meta.sectionId,
        benchmark: {
          meta: result.meta,
          survey: result.survey,
          benchmark: result.benchmark,
        },
        comparables: result.comparisonSurveys.map((survey, i) => ({
          meta: result.comparisonMeta[i],
          survey,
          benchmark: result.comparisonConditions[i],
          caseNo: String(i + 1),
        })),
      });
      // E0 對每一筆比較標的一律回 compare[].rate:null（修正率%由前端計算，見
      // ProduceRegionalFactorsResponse 型別註解）。但「同一地價區段」是既定規則——區域因素
      // 相同、修正率必為0.00%，不是「不知道」——RegionalFactorPage.tsx 同區段欄位本來就唯讀
      // （鏡射比準地），使用者點不到優劣等級下拉去觸發 updateRegionalFactorGrade 補上這個0，
      // 所以這裡直接補；跨區段維持 null，交由使用者用優劣等級下拉選出該區段等級後
      // （見 updateCompareGrade）用查表換算出差異率，或等未來接上 points/delta 換算公式。
      const regionalFactors = res.regionalFactors.map((row) => ({
        ...row,
        compare: row.compare.map((cell) =>
          cell.sameSectionAsBenchmark ? { ...cell, rate: 0 } : cell,
        ),
      }));
      const regionalTotal = regionalFactors.reduce(
        (sum, f) => sum + (f.compare[0]?.rate ?? 0),
        0,
      );
      setResult((prev) =>
        !prev
          ? prev
          : {
              ...prev,
              regionalFactors,
              regionalFactorRemarks: res.regionalFactorRemarks,
              regionalTotal,
              caseCode: res.caseCode,
              comparisonCases: res.comparisonCases,
            },
      );
      setActivePage(2);
    } catch (err) {
      console.error("produce-regional-factors 失敗", err);
      window.alert(
        `區域因素分析產製失敗：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setStageLoading(false);
    }
  };

  // 表5重算後同步表4／試算價格的共用收尾：勾稽vii要求表4區域因素調整百分率跟表5「該筆比較
  // 標的」自己的修正數相符——同區段案例是0，跨區段案例各有各的修正率，不能全部套用比較標的1
  // 的總數。②表5尚未確認產製③表4前，comparisonForm/computed 還不存在，只更新表5本身即可。
  const applyRegionalFactorsUpdate = (
    prev: ProduceState,
    regionalFactors: RegionalFactorRow[],
  ): ProduceState => {
    const regionalTotal = regionalFactors.reduce(
      (s, f) => s + (f.compare[0]?.rate ?? 0),
      0,
    );
    const next: ProduceState = { ...prev, regionalFactors, regionalTotal };
    if (prev.comparisonForm) {
      const casesWithRegionalAdj = prev.comparisonForm.cases.map((c, i) => ({
        ...c,
        regionalAdjRate: regionalFactors.reduce(
          (s, f) => s + (f.compare[i]?.rate ?? 0),
          0,
        ),
      }));
      if (prev.comparison) {
        const recomputed = recomputeChain(
          { ...prev.comparisonForm, cases: casesWithRegionalAdj },
          prev.comparison,
        );
        next.comparisonForm = recomputed.comparisonForm;
        next.computed = recomputed.computed;
      } else {
        next.comparisonForm = {
          ...prev.comparisonForm,
          cases: casesWithRegionalAdj,
        };
      }
    }
    return next;
  };

  // 官方表5-2版式：比準地是基準，只有優劣等級，不修正自己；比較標的的修正百分比是
  //「相對比準地」查表算出來的，不是使用者手動輸入的。改比準地等級後：同區段的比較標的一律
  // 重新鏡射新等級；跨區段的比較標的維持使用者已選的等級，只重算它跟新等級的差異率
  // （見 lib/regionalFactorBrackets.ts computeCompareCell 的 existingGrade 參數）。
  const updateRegionalFactorGrade = (key: string, grade: string) => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const benchmarkSectionId = prev.meta.sectionId;
      const regionalFactors = prev.regionalFactors.map((f) => {
        if (f.key !== key) return f;
        const subject = { ...f.subject, grade, edited: true };
        const compare = f.compare.map((cell) => ({
          ...computeCompareCell(
            f.key,
            subject,
            cell.sectionId,
            benchmarkSectionId,
            cell.grade || undefined,
          ),
          edited: cell.edited, // 跨區段時保留使用者原本已改過的狀態，不因比準地變動而重置
        }));
        return { ...f, subject, compare };
      });
      return applyRegionalFactorsUpdate(prev, regionalFactors);
    });
  };

  // 跨區段比較標的欄：使用者/AI 選填該比較標的自己所在區段的等級，查表算出跟比準地的差異率。
  // 同區段的比較標的一律鏡射，編輯頁不會呼叫到這裡（見 RegionalFactorPage.tsx）。
  const updateCompareGrade = (
    key: string,
    caseIndex: number,
    grade: string,
  ) => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const benchmarkSectionId = prev.meta.sectionId;
      const regionalFactors = prev.regionalFactors.map((f) => {
        if (f.key !== key) return f;
        const cell = f.compare[caseIndex];
        if (!cell) return f;
        const compare = f.compare.map((c, i) =>
          i !== caseIndex
            ? c
            : {
                ...computeCompareCell(
                  f.key,
                  f.subject,
                  cell.sectionId,
                  benchmarkSectionId,
                  grade,
                ),
                edited: true,
              },
        );
        return { ...f, compare };
      });
      return applyRegionalFactorsUpdate(prev, regionalFactors);
    });
  };

  const updateRegionalFactorRemark = (
    field: keyof RegionalFactorRemarks,
    value: string,
  ) => {
    setResult((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            regionalFactorRemarks: {
              subject: prev.regionalFactorRemarks?.subject ?? "",
              cases: prev.regionalFactorRemarks?.cases ?? "",
              overall: prev.regionalFactorRemarks?.overall ?? "",
              [field]: value,
            },
          },
    );
  };

  // 「其他影響因素(8)」使用者自建列：標準7類涵蓋不到、由查估人員自行判斷加註的個案特殊因素，
  // 官方範本本身沒有固定細項，系統不預填。跟前面30個官方固定列不同，這裡兩側(比準地/比較
  // 標的)的等級與修正率都是純人工輸入——不查表、不鏡射，因為連「同區段無差異」的假設對這種
  // 個案裁量因素都不必然成立（見 addCustomRegionalFactor 之後幾個 update 函式）。
  const addCustomRegionalFactor = () => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const cases = prev.comparisonCases ?? [];
      const key = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newRow: RegionalFactorRow = {
        key,
        label: "",
        group: "其他影響因素",
        custom: true,
        subject: { grade: "" },
        compare: cases.map((c) => ({
          sectionId: c.sectionId,
          sameSectionAsBenchmark: c.sectionId === prev.meta.sectionId,
          grade: "",
          rate: null,
        })),
      };
      return { ...prev, regionalFactors: [...prev.regionalFactors, newRow] };
    });
  };

  const removeCustomRegionalFactor = (key: string) => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const regionalFactors = prev.regionalFactors.filter((f) => f.key !== key);
      return applyRegionalFactorsUpdate(prev, regionalFactors);
    });
  };

  const updateCustomFactorLabel = (key: string, label: string) => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const regionalFactors = prev.regionalFactors.map((f) =>
        f.key !== key ? f : { ...f, label },
      );
      return { ...prev, regionalFactors };
    });
  };

  const updateCustomSubjectGrade = (key: string, grade: string) => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const regionalFactors = prev.regionalFactors.map((f) =>
        f.key !== key
          ? f
          : { ...f, subject: { ...f.subject, grade, edited: true } },
      );
      return { ...prev, regionalFactors };
    });
  };

  const updateCustomCompareGrade = (
    key: string,
    caseIndex: number,
    grade: string,
  ) => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const regionalFactors = prev.regionalFactors.map((f) => {
        if (f.key !== key) return f;
        const compare = f.compare.map((c, i) =>
          i !== caseIndex ? c : { ...c, grade, edited: true },
        );
        return { ...f, compare };
      });
      return applyRegionalFactorsUpdate(prev, regionalFactors);
    });
  };

  const updateCustomCompareRate = (
    key: string,
    caseIndex: number,
    rate: number,
  ) => {
    setResult((prev) => {
      if (!prev || !prev.regionalFactors) return prev;
      const regionalFactors = prev.regionalFactors.map((f) => {
        if (f.key !== key) return f;
        const compare = f.compare.map((c, i) =>
          i !== caseIndex ? c : { ...c, rate, edited: true },
        );
        return { ...f, compare };
      });
      return applyRegionalFactorsUpdate(prev, regionalFactors);
    });
  };

  // ② → ③：使用者確認表5後，才呼叫後端（E · produce-comparison）帶入表5總修正數 + 比準地/各
  // 比較標的自己的表1定稿，內部各打一次個別因素評分（Bedrock）算表4個別因素與試算價格
  const confirmRegionalFactorsAndProduceComparison = async () => {
    if (
      !result ||
      !result.regionalFactors ||
      result.regionalTotal === undefined
    )
      return;
    setStageLoading(true);
    try {
      const res = await produceComparison({
        sectionId: result.meta.sectionId,
        benchmark: result.benchmark,
        benchmarkSurvey: result.survey,
        regionalFactors: result.regionalFactors,
        regionalTotal: result.regionalTotal,
        meta: result.meta,
        comparisonLocations: locations.comparisonLocations,
        comparisonSurveys: result.comparisonConditions.map((benchmark, i) => {
          const loc = locations.comparisonLocations?.[i];
          return {
            benchmark,
            survey: result.comparisonSurveys[i],
            address: loc?.address,
            lat: loc?.lat,
            lng: loc?.lng,
            // 明確帶 override，避免後端沒收到就內部查 land-transaction 補這兩欄
            // （見 ComparisonSurveyInput 型別註解），蓋掉已寫死的比較法調查估價表數字
            normalPrice: benchmark.normalPrice,
            tradeDate: benchmark.tradeDate,
          };
        }),
      });
      setResult((prev) =>
        !prev
          ? prev
          : {
              ...prev,
              comparison: res.comparison,
              comparisonForm: res.comparisonForm,
              computed: res.computed,
            },
      );
      setActivePage(3);
    } finally {
      setStageLoading(false);
    }
  };

  // key 對應的個別因素列，某一筆比較標的自己改差異率——1~3筆比較標的各自獨立編輯，
  // 不共用同一個數字（見 types.ts FactorRow.compare 說明）
  const updateComparisonRate = (
    key: string,
    caseIndex: number,
    rate: number,
  ) => {
    setResult((prev) => {
      if (!prev || !prev.comparison || !prev.comparisonForm) return prev;
      const comparison = prev.comparison.map((it) =>
        it.key !== key
          ? it
          : {
              ...it,
              compare: it.compare.map((cell, i) =>
                i !== caseIndex ? cell : { ...cell, rate, edited: true },
              ),
            },
      );
      const { comparisonForm, computed } = recomputeChain(
        prev.comparisonForm,
        comparison,
      );
      return { ...prev, comparison, comparisonForm, computed };
    });
  };

  const updateDateAdj = (caseIndex: number, dateAdj: number) => {
    setResult((prev) => {
      if (!prev || !prev.comparisonForm || !prev.comparison) return prev;
      const cases = prev.comparisonForm.cases.map((c, i) =>
        i === caseIndex ? { ...c, dateAdjRate: dateAdj } : c,
      );
      const { comparisonForm, computed } = recomputeChain(
        { ...prev.comparisonForm, cases },
        prev.comparison,
      );
      return { ...prev, comparisonForm, computed };
    });
  };

  const updatePriceSimilarity = (caseIndex: number, value: string) => {
    setResult((prev) => {
      if (!prev || !prev.comparisonForm) return prev;
      const cases = prev.comparisonForm.cases.map((c, i) =>
        i === caseIndex ? { ...c, priceSimilarity: value } : c,
      );
      return { ...prev, comparisonForm: { ...prev.comparisonForm, cases } };
    });
  };

  const updateCaseRemark = (value: string) => {
    setResult((prev) =>
      !prev || !prev.comparisonForm
        ? prev
        : {
            ...prev,
            comparisonForm: { ...prev.comparisonForm, caseRemark: value },
          },
    );
  };

  const updateBenchmarkRemark = (value: string) => {
    setResult((prev) =>
      !prev || !prev.comparisonForm
        ? prev
        : {
            ...prev,
            comparisonForm: { ...prev.comparisonForm, benchmarkRemark: value },
          },
    );
  };

  const updateOverallRemark = (value: string) => {
    setResult((prev) =>
      !prev || !prev.comparisonForm
        ? prev
        : {
            ...prev,
            comparisonForm: { ...prev.comparisonForm, overallRemark: value },
          },
    );
  };

  return (
    <div
      className="flex h-screen overflow-hidden text-[#1A1A1A]"
      style={{ fontFamily: "'Noto Sans TC', sans-serif" }}
    >
      <aside className="w-52 bg-[#162B45] flex flex-col shrink-0">
        <div className="px-4 py-3.5 border-b border-white/10">
          <div className="text-white text-[14px] font-semibold leading-tight">
            地價區段
          </div>
          <div className="text-white/50 text-[12px] mt-0.5">AI輔助產製系統</div>
        </div>

        <div className="px-4 py-3 border-b border-white/10">
          <div className="text-white/40 text-[11px] uppercase tracking-wider mb-1.5">
            當前任務
          </div>
          <div className="text-white text-[12px] font-mono font-semibold">
            {result?.meta.sectionId ?? "尚未產製"}
          </div>
          <div className="text-white/50 text-[9px] mt-0.5 leading-relaxed">
            {result ? (
              <>
                {result.meta.district}
                <br />
                {result.meta.landUseType}
              </>
            ) : (
              "請先於「產製任務」啟動 AI 產製"
            )}
          </div>
        </div>

        <nav className="flex-1 py-1.5">
          {NAV_ITEMS.map((item) => {
            const disabled =
              item.page === 0
                ? false
                : item.page === 1
                  ? !result
                  : item.page === 2
                    ? !result?.regionalFactors
                    : item.page === 3
                      ? !result?.comparison
                      : !result?.comparisonForm;
            return (
              <button
                key={item.page}
                onClick={() => !disabled && setActivePage(item.page)}
                disabled={disabled}
                className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${
                  activePage === item.page
                    ? "bg-[#12457B] text-white font-medium"
                    : disabled
                      ? "text-white/25 cursor-not-allowed"
                      : "text-white/60 hover:bg-white/8 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-white/10">
          <div className="text-white/30 text-[11px] leading-relaxed">
            v1.0.0
            <br />
            新北市地政局
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden bg-[#F5F6F7]">
        {activePage === 0 && (
          <TaskSetupPage
            onProduced={(survey, comparisonSurveys, picked) => {
              // 根據表1的使用分區推導用地別
              const zoneTypeField = survey.survey.find(
                (f) => f.key === "zone_type",
              );
              const zoneType = zoneTypeField?.value || "";
              const landUseType = zoneType
                ? deriveLandUseTypeFromZoneType(zoneType)
                : "其他";

              setResult({
                meta: { ...survey.meta, landUseType },
                survey: survey.survey,
                comparisonSurveys: comparisonSurveys.map((s) => s.survey),
                comparisonMeta: comparisonSurveys.map((s) => s.meta),
                comparisonConditions: comparisonSurveys.map((s) => s.benchmark),
                benchmark: survey.benchmark,
              });
              setLocations(picked);
              setActivePage(1);

              // 背景補步行距離：不擋這裡的頁面切換，表3頁面先用直線距離顯示，
              // 相關欄位查完後再原地更新（見 enrichPendingFields 說明）。比準地優先：
              // 表3頁面預設就是開在「比準地」分頁（見 SurveyFormPage 的 activeTab 預設0），
              // 4個地點若同時搶同一條全域 OSRM 序列化佇列，誰先查完全看網路時序、不保證
              // 比準地優先——這裡改成先把比準地整個查完，比較標的1~3才開始查，確保使用者
              // 一打開頁面看到的那個分頁最快拿到真正的步行距離。
              void (async () => {
                await enrichPendingFields(
                  picked.benchmarkLocation,
                  survey.survey,
                  (updater) =>
                    setResult((prev) =>
                      prev ? { ...prev, survey: updater(prev.survey) } : prev,
                    ),
                );
                await Promise.all(
                  (picked.comparisonLocations ?? []).map((loc, i) =>
                    enrichPendingFields(
                      loc,
                      comparisonSurveys[i].survey,
                      (updater) =>
                        setResult((prev) =>
                          prev
                            ? {
                                ...prev,
                                comparisonSurveys: prev.comparisonSurveys.map(
                                  (s, idx) => (idx === i ? updater(s) : s),
                                ),
                              }
                            : prev,
                        ),
                    ),
                  ),
                );
              })();
            }}
          />
        )}
        {activePage === 1 && result && (
          <SurveyFormPage
            result={result}
            comparisonLocations={locations.comparisonLocations}
            onUpdateField={updateSurveyField}
            onConfirmField={confirmSurveyField}
            onSelectFieldFacility={selectSurveyFieldFacility}
            onExpandFieldFacility={expandSurveyFieldFacility}
            onUpdateComparisonField={updateComparisonSurveyField}
            onConfirmComparisonField={confirmComparisonSurveyField}
            onSelectComparisonFieldFacility={
              selectComparisonSurveyFieldFacility
            }
            onExpandComparisonFieldFacility={
              expandComparisonSurveyFieldFacility
            }
            onNext={confirmSurveyAndProduceRegionalFactors}
            nextLoading={stageLoading}
          />
        )}
        {activePage === 2 && result && result.regionalFactors && (
          <RegionalFactorPage
            result={{
              meta: result.meta,
              regionalFactors: result.regionalFactors,
              regionalFactorRemarks: result.regionalFactorRemarks,
              caseCode: result.caseCode,
              comparisonCases: result.comparisonCases,
            }}
            onUpdateGrade={updateRegionalFactorGrade}
            onUpdateCompareGrade={updateCompareGrade}
            onAddCustomFactor={addCustomRegionalFactor}
            onRemoveCustomFactor={removeCustomRegionalFactor}
            onUpdateCustomLabel={updateCustomFactorLabel}
            onUpdateCustomSubjectGrade={updateCustomSubjectGrade}
            onUpdateCustomCompareGrade={updateCustomCompareGrade}
            onUpdateCustomCompareRate={updateCustomCompareRate}
            onUpdateRemark={updateRegionalFactorRemark}
            onNext={confirmRegionalFactorsAndProduceComparison}
            nextLoading={stageLoading}
          />
        )}
        {activePage === 3 && result && result.comparisonForm && (
          <ComparisonAppraisalPage
            result={toProduceResult(result)}
            onUpdateRate={updateComparisonRate}
            onUpdateDateAdj={updateDateAdj}
            onUpdatePriceSimilarity={updatePriceSimilarity}
            onUpdateBenchmarkRemark={updateBenchmarkRemark}
            onUpdateCaseRemark={updateCaseRemark}
            onUpdateOverallRemark={updateOverallRemark}
            onNext={() => setActivePage(4)}
          />
        )}
        {activePage === 4 && result && result.comparisonForm && (
          <MapProductionPage
            result={toProduceResult(result)}
            comparisonSurveys={result.comparisonSurveys.map((survey, i) => ({
              meta: result.comparisonMeta[i],
              survey,
              benchmark: result.comparisonConditions[i],
            }))}
            caseId={CASE_ID}
            onExported={setReportPdfUrl}
            onNext={() => setActivePage(6)}
          />
        )}
        {activePage === 6 && result && result.comparisonForm && (
          <ExportPage
            result={toProduceResult(result)}
            images={images}
            reportPdfUrl={reportPdfUrl}
          />
        )}
      </main>
    </div>
  );
}
