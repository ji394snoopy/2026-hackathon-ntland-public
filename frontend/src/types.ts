export type FieldSource =
  | "ai"
  | "manual"
  | "edited"
  | "empty"
  | "confirmed"
  | "prefilled";

// 每個 AI 產製值的「對照」：可稽核核心，說明這值哪來、依據什麼
export type FieldReference = {
  dataSource: string; // 數據來源，如 'Google Places｜金山國小' / '都市計畫圖資'
  measurement?: string; // 量測方式，如 '最近距離 150m' / '直線距離 80m'
  bracket?: string; // 依據的基準表級距，如 '優<200m｜稍優200-600m｜...'
  derivation?: string; // 推導結果，如 '150m 落在「優」級'
  rawFact?: string; // 原始事實(推導起點/可跨表追溯)，如 '區段中心 → 金山國小 150m'
};

// 表3設施類欄位（見 api/index.ts SURVEY_FACILITY_KIND）半徑內查得的單一候選設施：
// 「接近學校之程度」用學制優先序、其餘設施用最近距離，各自判準不一，AI 只會自動選
// 一筆填入 value；facilityOptions 保留同 kind 的完整候選清單，供使用者手動切換。
export type FacilityOption = {
  key: string; // 穩定識別碼（座標＋名稱），供切換時指定要選哪一筆
  name: string;
  lon: number;
  lat: number;
  metersToCenter: number;
  insideBoundary: boolean | null; // pointInPolygon 判斷結果，null=邊界未解析成功
  // true=OSRM 步行距離，false=直線距離。系統自動選中的那筆一開始就會查步行距離；
  // 其餘候選為避免一次展開就打一堆 OSRM，維持直線距離，等使用者實際展開候選清單
  // 才由 resolveFacilityAlternates()（見 api/index.ts）補查
  walked: boolean;
};

export type SurveyField = {
  key: string;
  label: string; // 中文欄位名
  group: string; // 土地使用管制/交通運輸/自然條件/公共建設/特殊設施/環境污染/工商活動
  value: string; // 當前值（可編輯）
  source: FieldSource; // ai已填 / 需人工(empty) / 已修改(edited) / 已確認
  origin?: string; // 來源簡述(列上顯示的小字)：'Places｜150m' / '圖資' / 'AI建議'
  reference?: FieldReference; // 完整對照(點 ⓘ 展開)；ai 欄位應有，empty 欄位為 undefined
  aiSuggestion?: string; // AI 建議值（供參考）
  confidence?: "high" | "low";
  warning?: string; // AI 自檢提示，如「距離對應級距不一致，建議複核」
  options?: string[]; // 若為下拉
  multi?: boolean; // options 是否為複選（如建築基地改良/農地改良），value 以「、」串接已勾選項目
  // 同類設施查得多筆時的完整清單（value 為其摘要文字，供編輯用；items 供表1逐筆列印）。
  // 每筆帶兩個距離，因為兩張表的量測基準點本來就不是同一個：
  //   metersToCenter — 到「區段中心」（區段多邊形的幾何重心）。表5 區域因素評的是整個地價
  //                    區段的條件，一律用這個；items 也依它排序。
  //   metersToPoint  — 到「本案地點(比準地)」。表4 個別因素評的是這一筆宗地自己，用這個。
  //                    選填：前端沒帶區段多邊形（查詢中心＝比準地）時兩者相同，後端就只寫
  //                    前者。沒有值代表「沒有第二個基準點」，不是 0。
  items?: { name: string; metersToCenter: number; metersToPoint?: number }[];
  facilityOptions?: FacilityOption[]; // 設施類欄位查得的完整候選清單（含目前選中者），供使用者切換 AI 自動判定的結果
  selectedFacilityKey?: string; // facilityOptions 中目前顯示於 value 的那一筆的 key
  radiusMeters?: number; // 查得 facilityOptions 當下的查詢半徑，供切換候選時重組 reference 文字
  // 步行距離背景查詢尚未完成：欄位先用直線距離顯示(source仍為ai)，UI顯示查詢中/停用編輯，
  // 查完後由 enrichSurveyWithWalkingDistances() 補上真正的步行距離並清掉這個旗標。
  // 若使用者在查詢完成前就手動編輯了這個欄位，補上時要放棄套用，不覆蓋使用者的輸入。
  pending?: boolean;
};

// 表4 個別因素比較用：跟表5 RegionalFactorCompare 同樣的精神——差異率是「該筆比較標的自己的
// 宗地條件 vs 比準地」算出來的，1~3筆比較標的各自一格、互不共用同一個數字，也各自有自己的
// 稽核依據。rate 為 null 表示尚無依據可推導（如尚未有查估人員判定的個別因素比較邏輯），
// 需人工複核；0 是「已核實無差異」，兩者意義不同不可混用（同表5 RegionalFactorCompare.rate）。
export type FactorCompareCell = {
  rate: number | null; // 修正百分比 / 差異率
  reference?: FieldReference; // 對照：依基準表哪一格、原始事實(跨表追溯回表3)
  edited?: boolean;
  warning?: string;
};

export type FactorRow = {
  key: string;
  label: string;
  group: string;
  compare: FactorCompareCell[]; // 索引對齊 comparisonForm.cases，支援1~3筆比較標的，各自獨立編輯
};

// 表5 區域因素分析：比準地是基準，只有優劣等級，不修正自己；比較標的1~3才有「相對比準地」
// 的修正百分比。兩側各自可能有自己的稽核依據(reference)，因為等級的推導起點不同
// （比準地→表3勘查表事實；比較標的→鏡射比準地或該案自己的區域級距，見 lib/regionalFactorBrackets.ts）。
export type RegionalFactorSubject = {
  grade: string;
  reference?: FieldReference;
  warning?: string;
  edited?: boolean;
  // E0 (produce-regional-factors) 回傳供前端換算修正率參考用；rate 由前端算，這幾欄不是
  // 拿來顯示的最終值。目前尚未接上換算邏輯（後端未提供換算公式），先透傳保留供之後接線用，
  // 不在缺公式的情況下自己編一套（見 [[project_produce_api_spec]]）。
  points?: number; // 修正點數
  rank?: number; // 等級序
};

// rate 為 null 表示此項目沒有依據可推導（跨區段但使用者尚未選等級／此因素無查表依據等），
// 需人工複核，不是 0——0 是「同區段、確定無差異」，null 是「不知道」，兩者意義不同不能混用。
// sameSectionAsBenchmark 決定 grade 能不能編輯（見 RegionalFactorPage.tsx）：
// 同區段一律鏡射比準地等級、唯讀；跨區段才由人工/AI 選填該比較標的自己所在區段的等級，
// 修正率＝該等級與比準地等級在基準表上的 rate 差(查表相減，不是等差公式估算)。
export type RegionalFactorCompare = {
  sectionId: string;
  sameSectionAsBenchmark: boolean;
  grade: string;
  rate: number | null;
  reference?: FieldReference;
  warning?: string;
  edited?: boolean; // 跨區段時使用者是否改過 AI 預填的等級；同區段鏡射不適用（一律唯讀）
  // 同 RegionalFactorSubject.points/rank，E0 回傳供前端換算修正率參考用，尚未接上換算邏輯
  points?: number;
  rank?: number;
  delta?: number; // 與比準地的點數差
};

export type RegionalFactorRow = {
  key: string;
  label: string;
  group: string;
  subject: RegionalFactorSubject;
  compare: RegionalFactorCompare[]; // 索引對齊 comparisonCases／comparisonForm.cases，支援1~3筆比較標的
  // 使用者在「其他影響因素(8)」自建的列：跟官方固定30列（key 對應 lib/regionalFactorGroups.ts）
  // 不一樣，key 是動態產生的、label 是使用者自己打的，兩側的等級/修正率也都是純人工輸入——
  // 不查表、不鏡射，因為這欄本來就是標準7類涵蓋不到的個案專業裁量，連「同區段無差異」的假設
  // 都不必然成立。RegionalFactorPage.tsx／PrintableRegionalFactorForm.tsx 用這個旗標決定：
  // 要不要跑 computeCompareCell 的鏡射/查表邏輯、label 是唯讀文字還是 input。
  custom?: boolean;
};

// 表5「影響地價區域因素分析明細表」底部備註欄：拆成比準地／各比較標的／全案三個獨立欄位，
// 各自可以填不同理由（不是同一件事硬湊在一起）。跟表4 comparisonForm.caseRemark／
// overallRemark 各自獨立——兩張表雖然官方版面上用詞相近，但表5在②階段產製、表4要到③才有，
// 內容主題也不同（表5這裡常見用途是敘明跨區段選取比較標的的理由，呼應手冊§19），共用同一份
// 資料反而會互相污染。
export type RegionalFactorRemarks = {
  subject: string; // 比準地
  cases: string; // 各比較標的
  overall: string; // 全案
};

// 表4 比較法調查估價表官方版式：宗地/道路/接近/周邊環境/行政等 19 項條件
export type ComparisonCondition = {
  location: string; // 座落，如「新北市金山區金美段489地號」
  normalPrice?: number; // 土地正常單價(元/M²)，用於表4比較法調查
  tradeDate?: string; // 交易日期，如「114.05.28」
  dateAdjRate?: number; // 日期調整率(%)，如 5.96
  area: string; // 面積(M²)
  width: string; // 寬度(M)
  depth: string; // 深度(M)
  shape: string; // 形狀
  frontage: string; // 臨街情形
  terrain: string; // 地勢
  roadType: string; // 道路種類
  roadName: string; // 面前道路名稱
  roadWidth: string; // 面前道路寬度(M)
  schoolName: string;
  schoolDistance: string;
  marketName: string;
  marketDistance: string;
  parkName: string;
  parkDistance: string;
  stationName: string;
  stationDistance: string;
  districtName: string; // 商圈名稱
  districtDistance: string;
  disamenityName: string; // 嫌惡設施類型
  disamenityDistance: string;
  parking: string; // 停車方便性
  zoning: string; // 使用分區或編定用地
  coverageRatio: string; // 建蔽率(%)
  plotRatio: string; // 容積率(%)
  buildRestriction: string; // 有無禁限建
  sectionId: string; // 地價區段
};

// 表4 比較標的19項個別因素與比準地的差異率（%）：不再存成每個 case 自己的一份快照，
// 一律以 ProduceResult.comparison（FactorRow[].compare[]）為單一事實來源——避免「案例自己的
// rates」跟「comparison 表列出來的 rate」各自編輯後彼此漂移（見舊版 lib/pricing.ts 的教訓）。
export type ComparisonCase = ComparisonCondition & {
  latLng?: { lat: number; lng: number }; // 比較標的座標(WGS84)，來自使用者於地點標記頁標記之座標，供圖台定位使用
  caseNo: string; // 實例編號
  normalPrice: number; // 土地正常單價
  tradeDate: string; // 交易日期，如「114.05.28」
  dateAdjRate: number; // 調整百分率
  adjustedPrice: number; // 調整至估價基準日單價(元/M²)
  regionalAdjRate: number; // 區域因素調整百分率
  absRateSum: number; // 調整百分率絕對值加總；來自 comparison[].compare[i].rate 加總，見 lib/pricing.ts
  priceSimilarity: string; // 價格形成因素之相近程度，如「普通」
  weight: string; // 比較標的權重，如「34%」；1~3筆比較標的各自可編輯，加總應為100%
  trialPrice: number; // 試算價格
};

// 表4 完整官方版式資料（供輸出 PDF 用；ComparisonAppraisalPage 之 comparison/computed 供互動編輯簡化欄位用）
export type ComparisonForm = {
  appraisalBaseDate: string; // 估價基準日，如「1140901」
  caseCode: string; // 案號，如「1140901-99-001」
  benchmarkParcelNo: string; // 比準地宗地流水號，通常為「-」
  benchmark: ComparisonCondition;
  cases: ComparisonCase[]; // 比較標的1~3；不足3筆者其餘欄位留白
  benchmarkComparedPrice: number; // 比準地比較價格
  benchmarkRemark: string; // 備註欄：比準地
  caseRemark: string; // 備註欄：各比較標的
  overallRemark: string; // 備註欄：全案
  fillDate: string; // 填寫日期，如「114 年 09 月 18 日」
};

export type ProduceResult = {
  meta: {
    sectionId: string;
    range: string;
    district: string;
    landUseType: string;
    benchmarkParcel: string;
    yearPeriod: string; // 年期，如 '1140901'
    surveyDate: string; // 勘查日期，如 '114年09月18日'
    location?: { lat: number; lng: number }; // 比準地概略座標(WGS84)，供圖台定位使用
    // 區段範圍多邊形(WGS84)：survey 裡每個 metersToCenter 都是量到它的幾何重心。存下來兩個
    // 距離才追溯得回去——少了它，表上的「距150M」就只是一個無從解釋的數字。
    sectionPolygon?: { lat: number; lng: number }[];
  };
  survey: SurveyField[]; // 表3 勘查表
  regionalFactors: RegionalFactorRow[]; // 表5
  regionalFactorRemarks?: RegionalFactorRemarks; // 表5備註欄；②表5產製後才有值，預設空白
  caseCode?: string; // 案號；②表5產製後才有值（沿用③comparisonForm.caseCode，兩處不應各自漂移）
  comparisonCases?: { caseNo: string; sectionId: string }[]; // 比較標的1~3身分(案例編號/地價區段)；②表5產製後才有值，供表5表頭與比較標的欄對照
  comparison: FactorRow[]; // 表4 個別因素（互動編輯用簡化欄位，1~3筆比較標的各自一份 compare[]）
  comparisonForm: ComparisonForm; // 表4 官方版式完整資料（輸出用）
  // 表4計算鏈的摘要：一律回讀 comparisonForm.cases[0]，供②→③銜接與匯出頁沿用單一數字欄位；
  // 每個比較標的各自完整的調整鏈請直接讀 comparisonForm.cases[i]，不要只看這裡。
  // 一律透過 lib/pricing.ts recomputeChain() 從 comparisonForm+comparison 重新算出，不手動拼湊
  // （dateAdj≡cases[0].dateAdjRate，regionalTotal≡cases[0].regionalAdjRate，
  // trialPrice≡cases[0].trialPrice）。
  computed: {
    dateAdj: number;
    regionalTotal: number;
    individualTotal: number;
    trialPrice: number;
  };
};

// 使用者在「補充圖片」步驟上傳、想額外放進報告的照片（現場照、附件等）；純前端狀態，
// 不經三階段產製 API，用 dataUrl 存放以便直接預覽與寫進匯出的 PDF
export type SupplementaryImage = {
  id: string;
  name: string;
  dataUrl: string;
};
