import type {
  ComparisonCondition,
  ComparisonForm,
  FactorRow,
  ProduceResult,
  RegionalFactorRemarks,
  RegionalFactorRow,
  SurveyField,
} from "../types";

export type LocationInput = {
  address: string;
  lat: number;
  lng: number;
  // 若使用者以「四至文字描述」標記（見 BoundaryRangeMap），這裡會帶四個角點座標
  // （西南/東南/東北/西北），供地圖畫出區段範圍；沒有時代表仍是單點標記
  corners?: { lat: number; lng: number }[];
};

// 三階段產製 API：①表3勘查表 → 使用者確認 → ②表5區域因素分析明細表 → 使用者確認 →
// ③表4比較法調查估價表 → 使用者確認 → ④⑤前端彙總/輸出（沿用既有 ProduceResult，不再需要新型別）。
// 每一階段只吃「上一階段使用者已確認(可能已編輯)的資料」＋這一階段需要的原始輸入，
// 不會像過去的單一 produceForms() 那樣把三表一次算完。

// POST /api/produce/survey —— ①依區段編號＋比準地座標，打周邊設施查詢 API 組表3
export type ProduceSurveyRequest = {
  sectionId: string;
  locationRole: "benchmark" | "comparison1" | "comparison2" | "comparison3"; // 位置角色：比準地或三個比較標的之一
  location?: LocationInput; // 該位置之座標：使用者於地圖上標記
  // 區段範圍多邊形：使用者於地圖上圈選的區段經緯度陣列（至少 3 點，閉合與否皆可）。
  // 帶了它，後端設施查詢的圓心就改成這個多邊形的幾何重心，每筆設施因此同時回兩個距離：
  // metersToCenter（到區段中心，表5 區域因素用）與 metersToPoint（到 location，表4 個別因素用）。
  // 不帶就維持原行為：圓心＝location，兩個距離相同，只回前者。
  // 注意這是「用區段取中心」，不是「只取區段範圍內的設施」——勘查標準講的是逐類半徑
  //（站牌 800m、交流道 4000m），區段邊界內有幾個設施是地籍事實，不是勘查範圍。
  // 目前 produceSurvey() 仍是 mock（自行打 facilities API，見 fetchNearbyFacilities），
  // 尚未轉送這個欄位；後端契約見 API_INTEGRATION.md §1。
  sectionPolygon?: LocationInput[];
};
export type ProduceSurveyResponse = {
  meta: ProduceResult["meta"];
  survey: SurveyField[]; // 表3 勘查表（AI已填/需人工欄位並存）
  benchmark: ComparisonCondition; // 表4比準地條件基準值：mock基礎值 + 表3事實(SURVEY_LINKAGE)同步 + 使用者標記位置
};

// 某一筆地（比準地或某比較標的）的「表1 定稿」整份：produce-survey 回應 + 估價師編輯後的定稿。
// E0 對「比準地 + 各比較標的」各評一次區域因素（評分核心 regional-factor-grading 一次只評一筆），
// 所以 request 收的是 1+N 份表1 定稿，不是單份 survey/benchmark（見 E2E_MANUAL.md §E0）。
export type Table1Final = {
  meta: ProduceResult["meta"];
  survey: SurveyField[]; // 該筆地的表1 勘查表（非空陣列）
  benchmark: ComparisonCondition; // 該筆地的宗地條件
};
// 比較標的的表1 定稿；caseNo 省略時後端用陣列序號 "1".."3"
export type ComparableTable1Final = Table1Final & { caseNo?: string };

// POST /api/produce/regional-factors —— E0：拿比準地 + 各比較標的的①表1定稿，內部各評一次
// 區域因素再合成「比準地 vs 各比較標的」的表5比較欄
export type ProduceRegionalFactorsRequest = {
  sectionId: string; // 比準地區段編號
  benchmark: Table1Final; // 比準地的表1 定稿（整份，非單一 ComparisonCondition）
  comparables?: ComparableTable1Final[]; // 比較標的，0~3 份
  caseCode?: string;
  remarks?: RegionalFactorRemarks;
};
export type ProduceRegionalFactorsResponse = {
  // 表5：subject(比準地優劣等級) 為後端 AI 評分結果；compare[].rate 一律 null（修正率%由前端
  // 計算），compare 筆數 = 傳入的 comparables 筆數。subject/compare[] 另帶 optional
  // points(修正點數)/rank(等級序)/delta(點數差) 供前端換算參考，目前尚未接上換算邏輯
  // （見 RegionalFactorSubject/RegionalFactorCompare 型別註解），rate:null 沿用既有「需人工複核」語意。
  regionalFactors: RegionalFactorRow[];
  regionalTotal: number;
  caseCode: string; // 案號
  comparisonCases: { caseNo: string; sectionId: string }[]; // 比較標的1~3身分，供表5表頭
  regionalFactorRemarks: RegionalFactorRemarks; // 表5備註欄，預設空白，不編假樣板文字
  // 逐份容錯：某比較標的評分失敗時該筆不納入 regionalFactors，改列在這裡；比準地評分失敗則
  // 整支 API 502（fetch 會直接 throw，不會有這個欄位）
  failedComparables?: { caseNo: string; error: string }[];
};

// 某一筆比較標的自己的表1定稿 + 市場面覆寫（見 API_REFERENCE.md §E）：真正決定「有幾個比較
// 標的」的欄位是 comparisonSurveys（最多3筆），不是 comparisonLocations——後者只供圖台定位。
export type ComparisonSurveyInput = {
  benchmark: ComparisonCondition; // 必填：該標的的宗地條件
  survey?: SurveyField[]; // 該標的的表1定稿；有帶評分證據較足
  address?: string;
  lat?: number;
  lng?: number;
  normalPrice?: number; // 覆寫正常單價（不帶就用後端內部查 land-transaction 到的段值）
  tradeDate?: string; // 覆寫交易日期
  weight?: number; // 權重，後端預設 100
};

// POST /api/produce/comparison —— ③（E · produce-comparison，正式入口）帶入②總修正數 +
// 各比較標的自己的表1定稿，內部各打一次 individual-factor-grading（Bedrock）+ 拉實價登錄，
// 算個別因素差異與試算價格
export type ProduceComparisonRequest = {
  sectionId?: string; // 比準地區段編號（缺則後端視為空字串）
  benchmark: ComparisonCondition; // 承接①②，作為 comparisonForm.benchmark 最終值
  benchmarkSurvey?: SurveyField[]; // 比準地表1定稿；有帶評分證據較足
  regionalFactors?: RegionalFactorRow[]; // 使用者確認(可能已編輯)後的表5，用來算每個標的的區域因素調整率
  regionalTotal?: number; // E0 的總修正率，後端預設 0
  meta?: ProduceResult["meta"]; // 轉發給評分上游；缺則後端以 { sectionId } 代
  comparisonLocations?: LocationInput[]; // 比較標的定位（圖台用），最多3筆
  comparisonSurveys?: ComparisonSurveyInput[]; // 各比較標的自己的表1 + 市場面覆寫，最多3筆
};
export type ProduceComparisonResponse = {
  comparison: FactorRow[]; // 表4 個別因素（互動編輯用簡化欄位）
  comparisonForm: ComparisonForm; // 表4 官方版式完整資料
  computed: ProduceResult["computed"];
};

// POST /api/export —— 將編輯後的三表資料送後端產出下載檔
export type ExportFormsRequest = ProduceResult;
export type ExportFormsResponse = {
  ok: boolean;
  url: string;
};

// {CASE_STORE_URL} —— D · case-store：案件與三表定稿儲存（見 API_REFERENCE.md §D）。
// 只存取使用者確認過的定稿，不做計算；狀態只由三表定稿寫入連動，前端不能直接改。
export type CaseStatus =
  | "draft"
  | "survey_done"
  | "regional_done"
  | "comparison_done";

// POST {CASE_STORE_URL} —— D0 建立案件，回 201 CaseSummary（caseId 由後端產生）
export type CreateCaseRequest = {
  sectionId: string;
  meta?: ProduceResult["meta"]; // produce-survey 回的 meta，經估價師補齊
};

// GET {CASE_STORE_URL}[?sectionId=] 的元素，也是 D0 的回應
export type CaseSummary = {
  caseId: string; // 如 "case_06G92KD3002W1YJP6ZPT5C4KVV"
  sectionId: string;
  status: CaseStatus;
  meta: ProduceResult["meta"] | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
};

// 表1 定稿 + 宗地身分欄。宗地身分全選填，值為 null 的欄位後端不回。
// 定位一筆宗地要 district + section + parcelNo 三個一起（地號在同一行政區內不唯一）。
export type SurveyFinal = {
  survey: SurveyField[];
  benchmark: ComparisonCondition;
  district?: string;
  section?: string;
  sectno?: string;
  parcelNo?: string;
  lat?: number;
  lng?: number;
  areaM2?: number; // 上游權威面積；benchmark.area 是估價師可改的顯示值，兩者不同
};

export type RegionalFactorsFinal = {
  regionalFactors: RegionalFactorRow[];
  regionalTotal: number;
  remarks: RegionalFactorRemarks;
};

export type ComparisonFinal = {
  comparison: FactorRow[];
  comparisonForm: ComparisonForm;
  computed: ProduceResult["computed"];
};

// GET {CASE_STORE_URL}?caseId= —— 單一案件完整 bundle。三個 *Final 只有存過才會出現，
// 沒存過是整個欄位不存在（不是 null）。比較標的的表1 不在 bundle 裡。
export type CaseBundle = CaseSummary & {
  surveyFinal?: SurveyFinal;
  regionalFactorsFinal?: RegionalFactorsFinal;
  comparisonFinal?: ComparisonFinal;
};

// POST {IMAGE_UPLOAD_URL} —— G · image-upload：把一張圖片存進案件的 S3 資料夾
// （見 API_REFERENCE.md §G）。caseId/fileName 不可含 "/"、"\"、".." 或以 "." 開頭。
export type UploadCaseImageRequest = {
  caseId: string;
  fileName: string;
  dataBase64: string;
  contentType?: string;
};
export type UploadCaseImageResponse = {
  ok: true;
  s3Key: string;
};

// GET {IMAGE_UPLOAD_URL}?caseId= —— G · image-upload 列出某案已上傳圖片。url 指回 image-upload
// 自己的下載路由（bucket 是私有的），可直接當 <img src> 用。
export type CaseImageItem = {
  s3Key: string;
  fileName: string;
  size?: number;
  lastModified?: string;
  contentType?: string;
  url?: string;
};
export type ListCaseImagesResponse = {
  caseId: string;
  images: CaseImageItem[];
};

// POST {EXPORT_REPORT_URL} —— Hx · export-report：正式匯出入口，內部串三支填表 lambda +
// 地圖 + 案件圖片，合併成單一 PDF（見 API_REFERENCE.md §Hx）。
// survey/regional.content/comparison 都接受前端定稿形狀，後端自動轉換，不需先轉成 content tree。
export type ExportReportRequest = {
  // image-upload 回的 s3Key，後端直接從 S3 讀、依序併入；有帶就不看 caseId。單張讀不到只略過那張。
  s3Keys?: string[];
  // 沒帶 s3Keys 時，後端改列出 caseId 資料夾裡的全部圖片併入
  caseId?: string;
  survey?: unknown;
  regional?: { purpose: string; content?: unknown };
  comparison?: unknown;
  maps?: { name?: string; pdfBase64: string }[];
};

// export-report 回應：合併好的 PDF 已寫進 S3，這裡只給下載網址（CloudFront）。
// PDF 不直接放回應裡，是因為 Function URL 回應上限 6 MB，多張勘查表 + 地圖很容易超過。
export type ExportReportResponse = {
  url: string;
  s3Key: string;
  sizeBytes: number;
  pageCount: number;
  skippedCount: number; // 讀不到或格式不支援而略過的圖片數
};

// GET {facilities API}?lon=&lat=&radius= —— 依座標半徑查詢周邊設施，供設施距離示意圖與勘查表距離對照使用
export type FacilityItem = {
  kind: string; // 文教設施／醫療設施／停車場／公園／公車站／金融機構／加油站／殯葬設施…
  category?: string; // education / medical / parking / park / bank / fuel / cemetery（公車站無 category）
  name: string | null;
  lon: number;
  lat: number;
  metersToCenter: number; // 到 area.center（區段多邊形則為其幾何重心）的直線距離
  metersToPoint?: number; // 到 area.point（地點／比準地）的直線距離；未帶 point 時無值
  // 前端自行加註，非後端 API 原生欄位：只在 fetchNearbyFacilities() 內 OSRM 步行距離
  // 查詢「實際成功」時標為 "walking"；查詢失敗回退直線距離、或本來就不屬於步行距離
  // 三大類（交通/公共建設/工商活動）的項目一律不設這個欄位，代表就是直線距離，
  // 避免用「屬於哪個分類」推斷是否為步行距離而漏掉個別查詢失敗的情況。
  distanceType?: "walking";
  // 前端自行加註，非後端 API 原生欄位：dedupeNearestPerDetailType() 在收斂同一細項多筆
  // 資料時，把「非最近」的其餘候選附掛在留下的那一筆上，不整批丟棄——供 deriveFacilityField()
  // 組出 SurveyField.facilityOptions，讓使用者能手動切換 AI 自動判定的結果。
  alternates?: FacilityItem[];
};

export type FacilityCategorySummary = {
  count: number;
  // 「最近」一律以 metersToCenter 為準（與 items 的排序一致）；要離比準地最近的自己挑
  nearest: {
    kind: string;
    name: string | null;
    metersToCenter: number;
    metersToPoint?: number;
    distanceType?: "walking"; // 同 FacilityItem.distanceType，見該處說明
  } | null;
  items: FacilityItem[];
};

export type DoorplateItem = {
  address: string;
  lon: number;
  lat: number;
  metersToCenter: number;
  metersToPoint?: number;
};

export type NearbyFacilitiesResponse = {
  area: {
    kind: "radius";
    center: { lon: number; lat: number };
    centerFrom?: "polygon"; // center 由區段多邊形的幾何重心推導而來
    point?: { lon: number; lat: number }; // 第二量測點（地點／比準地），原樣回拋
    radiusMeters: number; // 基準半徑；未被 categoryRadii 覆寫的類別都用它
    maxRadiusMeters?: number; // 本次查詢實際涵蓋到的最遠半徑
    categoryRadii?: Record<string, number>; // 逐類覆寫後實際套用的半徑（key 為 category 鍵或車站中文 kind）
  };
  facilities: FacilityItem[];
  byCategory: Record<string, FacilityCategorySummary>; // 交通／公共設施／公共建設／特殊設施／工商活動／其他
  doorplate: {
    count: number;
    nearest: DoorplateItem[];
  };
};
