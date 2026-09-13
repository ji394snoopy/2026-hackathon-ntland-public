// Frontend-facing types, copied from the repo-root API_INTEGRATION.md so the shared DB
// layer aligns its stored jsonb with what the frontend already speaks. Copied (not
// imported from ../../../frontend) on purpose: infra must not take a cross-workspace
// dependency on the frontend build. When cli's internal schema is wired in later, the
// mapper layer (./mappers) is where any divergence gets reconciled — these types stay the
// single source of truth for the *stored* shape.
//
// Source of truth: API_INTEGRATION.md (最後更新 2026-09-09). Keep in sync when that doc
// changes the 表3 / 表4 / 表5 shapes.

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** 完整對照/佐證資訊 — attached to survey fields and regional-factor grades. */
export interface FieldReference {
  dataSource: string;
  measurement?: string;
  bracket?: string;
  derivation?: string;
  rawFact?: string;
}

/** { lat, lng } WGS84 pair as the frontend emits it (lng, not lon, in this doc). */
export interface LatLng {
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------------------
// 表3 勘查表 (survey) — ProduceSurveyResponse.survey / .benchmark / .meta
// ---------------------------------------------------------------------------

export type SurveyFieldSource = "ai" | "manual" | "edited" | "empty" | "confirmed";
export type Confidence = "high" | "low";

export interface SurveyField {
  key: string;
  label: string;
  group: string;
  value: string;
  source: SurveyFieldSource;
  origin?: string;
  reference?: FieldReference;
  aiSuggestion?: string;
  confidence?: Confidence;
  warning?: string;
  options?: string[];
  items?: Array<{
    name: string;
    /**
     * 到**區段中心**的直線距離(公尺)。區域因素(表5)評級一律讀這個 —— 區域因素評的是
     * 整個地價區段的條件,基準點是區段,不是某一筆地。
     */
    metersToCenter: number;
    /**
     * 到**本案地點(比準地)**的直線距離(公尺)。個別因素(表4)評級讀這個 —— 個別因素評
     * 的是這一筆宗地自己的條件。
     *
     * 選填:呼叫端沒帶地點座標(或區段中心就是地點本身)時不會有值,此時兩個距離相同,
     * 一律退回 metersToCenter。絕不用 0 代替「沒有」—— 0 是真的量得到的距離。
     */
    metersToPoint?: number;
  }>;
}

/** 表4 比準地宗地條件基準值, also embedded in ComparisonForm.benchmark. */
export interface ComparisonCondition {
  location: string;
  area: string;
  width: string;
  depth: string;
  shape: string;
  frontage: string;
  terrain: string;
  roadType: string;
  roadName: string;
  roadWidth: string;
  schoolName: string;
  schoolDistance: string;
  marketName: string;
  marketDistance: string;
  parkName: string;
  parkDistance: string;
  stationName: string;
  stationDistance: string;
  districtName: string;
  districtDistance: string;
  disamenityName: string;
  disamenityDistance: string;
  parking: string;
  zoning: string;
  coverageRatio: string;
  plotRatio: string;
  buildRestriction: string;
  sectionId: string;
}

/** ProduceSurveyResponse.meta — case-level metadata carried across the three forms. */
export interface CaseMeta {
  yearPeriod: string;
  sectionId: string;
  district: string;
  landUseType: string;
  benchmarkParcel: string;
  surveyDate: string;
  range?: string;
  /** 本案地點(比準地)座標 —— `items[].metersToPoint` 就是量到這一點。 */
  location?: LatLng;
  /**
   * 區段範圍多邊形(前端圈選的區段經緯度陣列),`items[].metersToCenter` 的基準點就是它的
   * 幾何重心。存下來是為了讓兩個距離事後可驗、可重算:少了它,表裡的「距中心 150M」就只是
   * 一個無從追溯的數字。未閉合也無妨(上游會自己閉合),定位失敗/舊資料則為 undefined。
   */
  sectionPolygon?: LatLng[];
}

// ---------------------------------------------------------------------------
// 表5 區域因素分析明細表 (regional factors)
// ---------------------------------------------------------------------------

export interface RegionalFactorSubject {
  grade: string;
  /** 修正點數 (cli selectedGrade.value, ≤ 0)。optional — 由 grading mapper 帶入,前端可忽略。 */
  points?: number;
  /** 等級序 (cli selectedGrade.rate, 優=1)。optional — 同 points。 */
  rank?: number;
  reference?: FieldReference;
  warning?: string;
  edited?: boolean;
}

export interface RegionalFactorCompare {
  sectionId: string;
  sameSectionAsBenchmark: boolean;
  grade: string;
  rate: number | null;
  /** 修正點數 (cli comparable grade.value)。optional — 由 grading mapper 帶入。 */
  points?: number;
  /** 等級序 (cli comparable grade.rate)。optional。 */
  rank?: number;
  /** 與比準地的等級點數差 (cli comparable delta = base.value - grade.value)。optional。 */
  delta?: number;
  reference?: FieldReference;
  warning?: string;
  edited?: boolean;
}

export interface RegionalFactorRow {
  key: string;
  label: string;
  group: string;
  subject: RegionalFactorSubject;
  compare: RegionalFactorCompare[];
  custom?: boolean;
}

export interface RegionalFactorRemarks {
  subject: string;
  cases: string;
  overall: string;
}

// ---------------------------------------------------------------------------
// 表4 比較法調查估價表 (comparison)
// ---------------------------------------------------------------------------

export interface FactorRow {
  key: string;
  label: string;
  group: string;
  rate: number;
  reference?: FieldReference;
  edited?: boolean;
  warning?: string;
}

export interface ComparisonCaseRates {
  area: number;
  width: number;
  depth: number;
  shape: number;
  frontage: number;
  terrain: number;
  roadType: number;
  roadWidth: number;
  school: number;
  market: number;
  park: number;
  station: number;
  district: number;
  disamenity: number;
  parking: number;
  zoning: number;
  coverageRatio: number;
  plotRatio: number;
  buildRestriction: number;
}

/**
 * A single comparison case (表4 官方版式). The doc lists ~19 individual-factor condition
 * columns inline; they're all strings here plus the numeric `rates`/summary fields.
 */
export interface ComparisonFormCase {
  latLng?: LatLng;
  caseNo: string;
  location: string;
  normalPrice: number;
  tradeDate: string;
  dateAdjRate: number;
  adjustedPrice: number;
  regionalAdjRate: number;
  area: string;
  width: string;
  depth: string;
  shape: string;
  frontage: string;
  terrain: string;
  roadType: string;
  roadName: string;
  roadWidth: string;
  schoolName: string;
  schoolDistance: string;
  marketName: string;
  marketDistance: string;
  parkName: string;
  parkDistance: string;
  stationName: string;
  stationDistance: string;
  districtName: string;
  districtDistance: string;
  disamenityName: string;
  disamenityDistance: string;
  parking: string;
  zoning: string;
  coverageRatio: string;
  plotRatio: string;
  buildRestriction: string;
  sectionId: string;
  rates: ComparisonCaseRates;
  absRateSum: number;
  priceSimilarity: string;
  weight: string;
  trialPrice: number;
}

export interface ComparisonForm {
  appraisalBaseDate: string;
  caseCode: string;
  benchmarkParcelNo: string;
  benchmark: ComparisonCondition;
  cases: ComparisonFormCase[];
  benchmarkComparedPrice: number;
  caseRemark: string;
  overallRemark: string;
  fillDate: string;
}

/** 試算結果摘要 — ProduceComparisonResponse.computed. */
export interface ComputedSummary {
  dateAdj: number;
  regionalTotal: number;
  individualTotal: number;
  trialPrice: number;
}

// ---------------------------------------------------------------------------
// Case-store API surface (request/response shaping done by the mapper layer)
// ---------------------------------------------------------------------------

/** Coarse workflow status of a case. Widened to string in the DB; enum here for callers. */
export type CaseStatus =
  | "draft"
  | "survey_done"
  | "regional_done"
  | "comparison_done";

/** Lightweight case metadata row (list view). */
export interface CaseSummary {
  caseId: string;
  sectionId: string;
  status: string;
  meta: CaseMeta | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 宗地身分 —— 這份表1 勘查的是哪一筆地。
 *
 * 對齊前端的定位流程:輸入 `district` + `section` + `parcelNo` → land-easymap 查出
 * `lat`/`lng`(center)與 `areaM2`(fields.areaM2)→ 存表1 時一起帶上。
 *
 * ⚠️ 定位要 `district` + `section` + `parcelNo` **三個一起**:地號在同一個行政區內
 * 不唯一,不同段可以有相同地號。
 *
 * 全選填:舊資料(合表前存的)與定位失敗的標的都會是 undefined。拿歷史表1 當新案的比較
 * 標的時,`lat`/`lng` 就是 produce-comparison 的 `comparisonSurveys[].lat/lng`,
 * 不用再從 comparisonForm 繞回來。
 */
export interface SurveyParcelIdentity {
  /** 行政區('金山區')。 */
  district?: string;
  /** 段名含小段('金美段')。 */
  section?: string;
  /** 段代碼('1027')。 */
  sectno?: string;
  /** 地號原樣('489' / '31-1')。 */
  parcelNo?: string;
  lat?: number;
  lng?: number;
  /** 上游的權威面積(㎡)。`benchmark.area` 是估價師可改的顯示值,兩者不是同一回事。 */
  areaM2?: number;
}

/** 表1 定稿 payload(宗地與比較標的同一份格式)。 */
export interface SurveyFinal extends SurveyParcelIdentity {
  survey: SurveyField[];
  benchmark: ComparisonCondition;
}

/** 表1 定稿 + 它在本案裡的比較標的序號(GET ?form=comparison-survey 的元素)。 */
export interface ComparisonSurveyFinal extends SurveyFinal {
  /** 0-based;對齊表4/表5 的 caseNo = targetIndex + 1。 */
  targetIndex: number;
}

/** 表5 定稿 payload. */
export interface RegionalFactorsFinal {
  regionalFactors: RegionalFactorRow[];
  regionalTotal: number;
  remarks: RegionalFactorRemarks;
}

/** 表4 定稿 payload. */
export interface ComparisonFinal {
  comparison: FactorRow[];
  comparisonForm: ComparisonForm;
  computed: ComputedSummary;
}

/** Full case bundle returned by GET ?caseId= — each form present only if stored. */
export interface CaseBundle extends CaseSummary {
  surveyFinal?: SurveyFinal;
  regionalFactorsFinal?: RegionalFactorsFinal;
  comparisonFinal?: ComparisonFinal;
}
