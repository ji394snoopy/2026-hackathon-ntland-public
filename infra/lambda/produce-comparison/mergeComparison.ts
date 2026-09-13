// produce-comparison / mergeComparison — v2 合併鏈的「純函式」核心(無 I/O、無 cli import)。
//
// 把 cli individualComparison 的 buildFillReport 輸出(FillReport,每項 base +
// comparables[].delta)+ 正常單價 + 表2 per-case 區域因素修正率 + 日期調整率,
// 合成契約 §4 的 ProduceComparisonResponse 三塊(comparison / comparisonForm / computed)。
//
// 決策(見 infra/docs/表3合併-plan.md §0):
//   - delta 就是修正率%(不另查表)。cli item key → 契約 ComparisonCaseRates 19 鍵靠
//     CLI_TO_RATE_KEY crosswalk;沒對到的鍵補 0(19 鍵缺一不可,PrintableComparisonForm 逐鍵讀)。
//   - 正常單價:呼叫端(lambda)從 land-transaction 取「最近一筆土地案例」unitPrice 傳入。
//   - 日期調整率:預設 0(前端可覆寫)。
//   - 價格鏈公式抄 compute.ts(唯一真相,兩邊一致)。
//
// 這支刻意「不 import 合成模組」:FillReport 的形狀在本檔以最小 interface 重宣告(對齊
// ../shared/grading/individualComparison/compareGraded.ts 的輸出),讓單元測試能直接餵 fixture,
// 不用把合成模組打包進測試 runtime。lambda.ts 才真的 import buildFillReport。

import type {
    ComparisonCaseRates,
    ComparisonCondition,
    ComparisonForm,
    ComparisonFormCase,
    ComputedSummary,
    FactorRow,
} from "../shared/db";

// ---------------------------------------------------------------------------
// individualComparison FillReport 形狀(輸入)—— 對齊
// ../shared/grading/individualComparison/compareGraded.ts 的輸出。只宣告本檔用得到的欄位。
// ---------------------------------------------------------------------------

export type CliItemValue = string | { name: string; distance: string; unit: string } | null;

export interface CliResolvedItem {
  key: string;
  raw: string;
  value: CliItemValue;
  selectedGrade: { key: string; raw: string; value: number; rate: number };
}

export interface CliComparableCell {
  label: string;
  item: CliResolvedItem | null;
  delta: number | null;
}

export interface CliItemRow {
  categoryKey: string;
  categoryRaw: string;
  itemKey: string;
  itemRaw: string;
  base: CliResolvedItem | null;
  comparables: CliComparableCell[];
}

export interface CliCategoryRow {
  categoryKey: string;
  categoryRaw: string;
  items: CliItemRow[];
}

export interface CliComparableIdentity {
  label: string;
  sectionId: string;
  location: string;
}

export interface CliFillReport {
  categories: CliCategoryRow[];
  sectionIdBase: string;
  locationBase: string;
  comparableIdentities: CliComparableIdentity[];
}

// ---------------------------------------------------------------------------
// crosswalk: cli individualFactors item key -> 契約 ComparisonCaseRates 19 鍵
// (見 infra/docs/表3合併-plan.md §2.3;cli 命名與契約不同)。
// ---------------------------------------------------------------------------

export const CLI_TO_RATE_KEY: Record<string, keyof ComparisonCaseRates> = {
  area: "area",
  width: "width",
  depth: "depth",
  shape: "shape",
  roadFrontageCondition: "frontage",
  terrain: "terrain",
  roadType: "roadType",
  frontageRoadWidth: "roadWidth",
  proximityToSchool: "school",
  proximityToMarket: "market",
  proximityToParkPlaza: "park",
  proximityToStation: "station",
  proximityToCommercialDistrict: "district",
  presenceOfNoxiousFacility: "disamenity",
  parkingConvenience: "parking",
  zoningDesignation: "zoning",
  buildingCoverageRatio: "coverageRatio",
  floorAreaRatio: "plotRatio",
  buildingProhibitionOrRestriction: "buildRestriction",
};

// 契約 19 鍵(缺一不可)。FACTOR_ROW_META 的顯示標籤沿用官方表4 欄序編號 7~25。
const RATE_KEY_META: Record<keyof ComparisonCaseRates, { label: string; group: string }> = {
  area: { label: "7面積(M²)", group: "宗地條件" },
  width: { label: "8寬度(M)", group: "宗地條件" },
  depth: { label: "9深度(M)", group: "宗地條件" },
  shape: { label: "10形狀", group: "宗地條件" },
  frontage: { label: "11臨街情形", group: "宗地條件" },
  terrain: { label: "12地勢", group: "宗地條件" },
  roadType: { label: "13道路種類", group: "道路條件" },
  roadWidth: { label: "14面前道路寬度", group: "道路條件" },
  school: { label: "15接近學校之程度", group: "接近條件" },
  market: { label: "16接近市場之程度", group: "接近條件" },
  park: { label: "17接近公園、廣場之程度", group: "接近條件" },
  station: { label: "18接近車站之程度", group: "接近條件" },
  district: { label: "19接近商圈之程度", group: "接近條件" },
  disamenity: { label: "20嫌惡設施(類型)", group: "周邊環境條件" },
  parking: { label: "21停車方便性", group: "周邊環境條件" },
  zoning: { label: "22使用分區或編定用地", group: "行政條件" },
  coverageRatio: { label: "23建蔽率(%)", group: "行政條件" },
  plotRatio: { label: "24容積率(%)", group: "行政條件" },
  buildRestriction: { label: "25有無禁限建", group: "行政條件" },
};

/** 契約 ComparisonCaseRates 的 19 鍵順序(缺一不可,依官方表4 欄序)。 */
export const RATE_KEYS: readonly (keyof ComparisonCaseRates)[] = Object.keys(
  RATE_KEY_META,
) as (keyof ComparisonCaseRates)[];

/** 全 0 的 rates(19 鍵齊全)。 */
function zeroRates(): ComparisonCaseRates {
  const r = {} as Record<keyof ComparisonCaseRates, number>;
  for (const k of RATE_KEYS) r[k] = 0;
  return r as ComparisonCaseRates;
}

/** 修正率保留兩位小數,與前端 toFixed(2) 慣例一致。 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// FillReport -> 各比較標的的 rates(delta 即修正率%)
// ---------------------------------------------------------------------------

/**
 * 從 FillReport 抽出「每個比較標的」的 ComparisonCaseRates(19 鍵)。
 * 對每個 item:透過 crosswalk 找到契約 rate key,把該比較標的的 delta 塞進去(= 修正率%)。
 * crosswalk 沒對到的 cli key、或 delta 為 null,對應鍵維持 0。回傳依 label 排序的陣列。
 */
export function ratesByLabel(report: CliFillReport): { label: string; rates: ComparisonCaseRates }[] {
  const labels = report.comparableIdentities.map((c) => c.label);
  const byLabel = new Map<string, ComparisonCaseRates>();
  for (const label of labels) byLabel.set(label, zeroRates());

  for (const category of report.categories) {
    for (const item of category.items) {
      const rateKey = CLI_TO_RATE_KEY[item.itemKey];
      if (!rateKey) continue; // 未對到契約鍵(如 cli 特有項)→ 略過,不影響 19 鍵
      for (const cell of item.comparables) {
        const rates = byLabel.get(cell.label);
        if (!rates) continue;
        if (typeof cell.delta === "number" && Number.isFinite(cell.delta)) {
          rates[rateKey] = round2(cell.delta);
        }
      }
    }
  }

  return labels.map((label) => ({ label, rates: byLabel.get(label)! }));
}

/** 個別因素有號加總(= 各 rate 之和),等同 compute.ts signedRateSum。 */
export function signedRateSum(rates: ComparisonCaseRates): number {
  return round2(Object.values(rates).reduce((s, r) => s + r, 0));
}

/** Σ|rates 各項|。 */
function sumAbs(rates: ComparisonCaseRates): number {
  return round2(Object.values(rates).reduce((s, r) => s + Math.abs(r), 0));
}

// ---------------------------------------------------------------------------
// 每個比較標的的市場面輸入(由 lambda 從 land-transaction / request 帶入)
// ---------------------------------------------------------------------------

export interface CaseMarketInput {
  /** 對應 FillReport comparableIdentities[].label。 */
  label: string;
  address: string;
  latLng?: { lat: number; lng: number };
  /** 該比較標的自己的宗地條件(來自其表1 benchmark);用來填 ComparisonFormCase 的 19 欄。 */
  condition: ComparisonCondition;
  /** 土地正常單價(land-transaction 最近一筆土地案例 unitPrice)。 */
  normalPrice: number;
  /** 交易日期(顯示用);預設空字串。 */
  tradeDate?: string;
  /** 日期調整率%(預設 0)。 */
  dateAdjRate?: number;
  /** 該比較標的的區域因素修正率%(表2 regionalFactors[].compare[i].rate 加總)。 */
  regionalAdjRate?: number;
  /** 加權%(預設平均分配由 lambda 決定,這裡預設 100)。 */
  weight?: number;
}

export interface MergeInput {
  report: CliFillReport;
  /** 比準地宗地條件(填 comparisonForm.benchmark + 條件欄的比準地側)。 */
  benchmark: ComparisonCondition;
  sectionId: string;
  /** 每個比較標的的市場面 + 宗地條件,label 對齊 report.comparableIdentities。 */
  cases: CaseMarketInput[];
  /** §4 regionalTotal(表2 總修正率),回填 computed.regionalTotal(代表值)。 */
  regionalTotal: number;
  appraisalBaseDate?: string;
  caseCode?: string;
  benchmarkParcelNo?: string;
  fillDate?: string;
}

export interface MergeOutput {
  comparison: FactorRow[];
  comparisonForm: ComparisonForm;
  computed: ComputedSummary;
}

/** 價格鏈(抄 compute.ts):adjustedPrice / trialPrice。 */
function priceChain(
  normalPrice: number,
  dateAdjRate: number,
  regionalAdjRate: number,
  individualTotal: number,
): { adjustedPrice: number; trialPrice: number } {
  const adjustedPrice = Math.round(normalPrice * (1 + dateAdjRate / 100));
  const trialPrice = Math.round(
    adjustedPrice * (1 + regionalAdjRate / 100) * (1 + individualTotal / 100),
  );
  return { adjustedPrice, trialPrice };
}

/** 把比較標的宗地條件(ComparisonCondition)攤平成 ComparisonFormCase 的 19+ 條件欄。 */
function conditionColumns(cond: ComparisonCondition) {
  return {
    area: cond.area,
    width: cond.width,
    depth: cond.depth,
    shape: cond.shape,
    frontage: cond.frontage,
    terrain: cond.terrain,
    roadType: cond.roadType,
    roadName: cond.roadName,
    roadWidth: cond.roadWidth,
    schoolName: cond.schoolName,
    schoolDistance: cond.schoolDistance,
    marketName: cond.marketName,
    marketDistance: cond.marketDistance,
    parkName: cond.parkName,
    parkDistance: cond.parkDistance,
    stationName: cond.stationName,
    stationDistance: cond.stationDistance,
    districtName: cond.districtName,
    districtDistance: cond.districtDistance,
    disamenityName: cond.disamenityName,
    disamenityDistance: cond.disamenityDistance,
    parking: cond.parking,
    zoning: cond.zoning,
    coverageRatio: cond.coverageRatio,
    plotRatio: cond.plotRatio,
    buildRestriction: cond.buildRestriction,
    sectionId: cond.sectionId,
  };
}

/**
 * 主合成入口。FillReport + 各比較標的市場面 → 契約三塊。
 * comparison(FactorRow[]) 取「比較標的1」的 rate 當代表(與舊版一致,互動編輯用)。
 * comparisonForm.cases[] 每筆帶自己的 rates/宗地條件/價格鏈。computed 以比較標的1 為代表。
 */
export function mergeComparison(input: MergeInput): MergeOutput {
  const perLabel = ratesByLabel(input.report);
  const ratesFor = new Map(perLabel.map((p) => [p.label, p.rates]));

  const formCases: ComparisonFormCase[] = input.cases.map((mkt, i) => {
    const rates = ratesFor.get(mkt.label) ?? zeroRates();
    const individualTotal = signedRateSum(rates);
    const dateAdjRate = round2(mkt.dateAdjRate ?? 0);
    const regionalAdjRate = round2(mkt.regionalAdjRate ?? 0);
    const normalPrice = mkt.normalPrice ?? 0;
    const weight = mkt.weight ?? 100;
    const { adjustedPrice, trialPrice } = priceChain(
      normalPrice,
      dateAdjRate,
      regionalAdjRate,
      individualTotal,
    );

    return {
      latLng: mkt.latLng,
      caseNo: String(i + 1),
      location: mkt.address,
      normalPrice,
      tradeDate: mkt.tradeDate ?? "",
      dateAdjRate,
      adjustedPrice,
      regionalAdjRate,
      ...conditionColumns(mkt.condition),
      rates,
      absRateSum: sumAbs(rates),
      priceSimilarity: "普通",
      weight: `${weight}%`,
      trialPrice,
    };
  });

  const benchmarkComparedPrice = Math.round(
    formCases.reduce((sum, c) => {
      const w = Number.parseFloat(c.weight) || 0;
      return sum + c.trialPrice * (w / 100);
    }, 0),
  );

  const comparisonForm: ComparisonForm = {
    appraisalBaseDate: input.appraisalBaseDate ?? "",
    caseCode: input.caseCode ?? "",
    benchmarkParcelNo: input.benchmarkParcelNo ?? "",
    benchmark: input.benchmark,
    cases: formCases,
    benchmarkComparedPrice,
    caseRemark: "",
    overallRemark: "",
    fillDate: input.fillDate ?? "",
  };

  // 代表值取比較標的1(與前端 computed 對齊);無 case 時全 0。
  const lead = formCases[0];
  const leadRates = lead ? (ratesFor.get(input.cases[0]!.label) ?? zeroRates()) : zeroRates();
  const computed: ComputedSummary = {
    dateAdj: lead ? lead.dateAdjRate : 0,
    regionalTotal: round2(input.regionalTotal),
    individualTotal: signedRateSum(leadRates),
    trialPrice: lead ? lead.trialPrice : 0,
  };

  const comparison = toFactorRows(leadRates);

  return { comparison, comparisonForm, computed };
}

/** 簡化互動版:每個個別因素一列(19 列),rate 取比較標的1(lead)的對應 rate。 */
function toFactorRows(leadRates: ComparisonCaseRates): FactorRow[] {
  return RATE_KEYS.map((key) => {
    const meta = RATE_KEY_META[key];
    return {
      key,
      label: meta.label,
      group: meta.group,
      rate: leadRates[key],
      reference: {
        dataSource: "個別因素評分（cli 個別因素鏈）",
        derivation: "修正率 = 比準地等級點數 − 比較標的等級點數（delta）",
      },
    };
  });
}
