import {
  mockExportFormsResponse,
  mockSurveyFixtures,
  getPrefillDataByRole,
  getConditionPrefillByRole,
} from "../mock";
import {
  buildFacilitiesApiUrl,
  FACILITIES_LAMBDA_URL,
  FACILITIES_QUERY_RADIUS_METERS,
  isPointInSectionBoundary,
  resolveSectionBoundary,
  type LatLng,
} from "../lib/officialMap";
import { fetchWalkingDistance, type Coordinate } from "./distance";
import { applySurveyLinkage, SURVEY_LINKAGE } from "../lib/formLinkage";
import { prepareImageForUpload } from "../lib/imageFile";
import { recomputeChain } from "../lib/pricing";
import type {
  ComparisonCase,
  ComparisonCondition,
  ComparisonForm,
  FacilityOption,
  FactorRow,
  FieldReference,
  SurveyField,
} from "../types";
import type {
  CaseBundle,
  CaseSummary,
  CreateCaseRequest,
  ExportFormsRequest,
  ExportFormsResponse,
  ExportReportRequest,
  ExportReportResponse,
  FacilityItem,
  ListCaseImagesResponse,
  NearbyFacilitiesResponse,
  ProduceComparisonRequest,
  ProduceComparisonResponse,
  ProduceRegionalFactorsRequest,
  ProduceRegionalFactorsResponse,
  ProduceSurveyRequest,
  ProduceSurveyResponse,
  UploadCaseImageRequest,
  UploadCaseImageResponse,
} from "./types";

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

// 表3 勘查表欄位 key → 對應的周邊設施查詢 kind；同樣只補 reference（佐證來源），
// 欄位本身的 value／source 維持原勘查表登載或人工填寫結果，避免自動改動正式紀錄
const SURVEY_FACILITY_KIND: Record<string, string> = {
  school: "文教設施",
  park: "公園",
  parking: "停車場",
  financial_institution: "金融機構",
  cemetery: "殯葬設施",
  bus_stop: "公車站",
};

// SURVEY_FACILITY_KIND 裡的欄位（學校/公園/停車場/金融機構/墓地/公車站）全部套用
// pointInPolygon 內外判斷，PrintableSurveyForm.tsx 對應印表元件也已全部改為顯示
// 「○本區段內 ○本區段外(距 M)」（見 BoundaryPoiCell / CheckboxPoiList）。廢棄物處理／
// 環境污染／百貨公司／大型車站等欄位，facilities API 完全沒有對應 kind 可查，不套用、
// 維持人工現場勘查填寫（見 [[project_facilities_boundary_check]]）。

// 佐證欄位要寫「這一類實際查了多遠」而不是基準半徑：嫌惡設施查 3000m 卻寫「半徑600m內」
// 是會印進勘查表的不實敘述。車站類沒有 category，用中文 kind 當鍵。
function radiusOfKind(
  data: NearbyFacilitiesResponse,
  item: FacilityItem,
): number {
  return (
    data.area.categoryRadii?.[item.category ?? item.kind] ??
    data.area.radiusMeters
  );
}

// 表3 勘查表逐筆列印用：同一 kind 半徑內可能查得多筆（如多個停車場、多間學校），
// 依距離由近到遠全部列出，不只取最近一筆
function allOfKind(
  data: NearbyFacilitiesResponse,
  kind: string,
): FacilityItem[] {
  return data.facilities
    .filter((f) => f.kind === kind)
    .slice()
    .sort((a, b) => a.metersToCenter - b.metersToCenter);
}

// 判斷某個 kind 是否屬於「交通／公共建設／工商活動」三大類——用來決定 SurveyField 要不要
// 標 pending（還在等步行距離背景查詢），跟 overrideWithWalkingDistances 用同一份分組依據
// (facilities.byCategory)，不用等實際查完 OSRM 才知道，dedupe 完就能判斷。
function isInWalkingDistanceGroup(
  facilities: NearbyFacilitiesResponse,
  kind: string,
): boolean {
  return WALKING_DISTANCE_GROUPS.some((group) =>
    facilities.byCategory[group]?.items.some((item) => item.kind === kind),
  );
}

// 官方填表規則：同一細項有多筆時，只填對當地影響最大者，但判準不一——「文教設施」
// （接近學校之程度）依學制優先序（見 pickSchoolFacility）取值，其餘細項沿用「越近影響
// 越大」判準只取最近一筆。判準不一致代表 AI 自動挑的那一筆不一定是使用者想要的，所以
// 完整候選清單保留在 SurveyField.facilityOptions，讓使用者能手動切換成其他候選（見
// selectSurveyFacilityOption），不是只能接受 AI 自動選的結果。
function toFacilityOption(
  item: FacilityItem,
  isInsideBoundary?: (lon: number, lat: number) => boolean | null,
): FacilityOption {
  return {
    key: facilityKey(item),
    name: item.name ?? item.kind,
    lon: item.lon,
    lat: item.lat,
    metersToCenter: item.metersToCenter,
    insideBoundary: isInsideBoundary?.(item.lon, item.lat) ?? null,
    walked: item.distanceType === "walking",
  };
}

// 把「已選定的候選設施」組回 SurveyField 的 value/origin/reference——deriveFacilityField
// （AI 自動選）跟 selectSurveyFacilityOption（使用者手動切換）共用同一套組字規則，避免
// 兩邊格式各自漂移。
function applyFacilityOption(
  field: SurveyField,
  kind: string,
  chosen: FacilityOption,
  options: FacilityOption[],
  radiusMeters: number,
  markPending: boolean,
  source: "ai" | "edited",
): SurveyField {
  const measurement = chosen.walked ? "步行距離" : "直線距離";
  // 步行距離是額外打步距 API（OSRM）算出來的，資料來源要老實標出「還多打了哪支 API」，
  // 不能讓人以為這個數字跟直線距離一樣只來自周邊設施查詢 API
  const apiLabel = chosen.walked
    ? "周邊設施查詢 API＋步距 API"
    : "周邊設施查詢 API";
  const insideNote =
    chosen.insideBoundary === true
      ? "，落在區段邊界內"
      : chosen.insideBoundary === false
        ? "，落在區段邊界外"
        : ""; // 邊界未解析成功時不宣稱內外，只留距離
  const value =
    chosen.insideBoundary === true
      ? `${chosen.name}，本區段內`
      : `${chosen.name}，距${chosen.metersToCenter}M`;
  return {
    ...field,
    value,
    items: [{ name: chosen.name, metersToCenter: chosen.metersToCenter }],
    facilityOptions: options,
    selectedFacilityKey: chosen.key,
    radiusMeters,
    source,
    origin: `AI 查詢｜${apiLabel}｜共${options.length}筆可選，目前：${chosen.name} ${chosen.metersToCenter}m`,
    warning: undefined,
    reference: {
      dataSource: `AI 查詢｜${apiLabel}｜半徑${radiusMeters}m`,
      measurement,
      derivation: `AI 於半徑${radiusMeters}m內查得${kind}共${options.length}筆，選用：${chosen.name} ${chosen.metersToCenter}m${chosen.walked ? "（步距 API 步行距離）" : ""}${insideNote}`,
      rawFact: value,
    },
    pending: markPending ? true : undefined,
  };
}

// 表3單一欄位（如「鄰近公車站」）的產製邏輯：取該 kind 影響最大者組出 value/reference，
// 同時把完整候選清單存進 facilityOptions。抽成獨立函式，讓 produceSurvey()（先用直線距離
// 快速產出）跟 enrichSurveyWithWalkingDistances()（背景補上步行距離）共用同一套規則。
function deriveFacilityField(
  field: SurveyField,
  facilities: NearbyFacilitiesResponse,
  kind: string,
  markPending: boolean,
  // 用 pointInPolygon.ts 判斷設施座標是否落在區段邊界內，供 PrintableSurveyForm.tsx 畫
  // 「○本區段內 ○本區段外(距 M)」。邊界解析不到時回傳 null——這裡不把 null 當「界外」，
  // 維持原本只顯示距離、不宣稱內外的寫法（見 isPointInSectionBoundary 說明）
  isInsideBoundary?: (lon: number, lat: number) => boolean | null,
): SurveyField {
  // allOfKind() 只回傳 dedupeNearestPerDetailType() 收斂後留下的那一筆／每個學制一筆；
  // 沒被留下的其餘候選附掛在 item.alternates，這裡展開回完整候選池，才能組出真正涵蓋
  // 「半徑內所有同 kind 設施」的 facilityOptions，不是只有 AI 自動選中的那一小撮
  const candidates = allOfKind(facilities, kind).flatMap((f) => [
    f,
    ...(f.alternates ?? []),
  ]);
  const chosenItem =
    kind === "文教設施"
      ? pickSchoolFacility(candidates)
      : (candidates
          .slice()
          .sort((a, b) => a.metersToCenter - b.metersToCenter)[0] ?? null);
  if (!chosenItem) {
    return {
      ...field,
      value: "",
      source: "empty",
      origin: "AI 查無周邊設施資料，需人工現場確認",
      warning: undefined,
      reference: undefined,
      items: undefined,
      facilityOptions: undefined,
      selectedFacilityKey: undefined,
      radiusMeters: undefined,
      pending: undefined,
    };
  }

  const options = candidates
    .map((f) => toFacilityOption(f, isInsideBoundary))
    .sort((a, b) => a.metersToCenter - b.metersToCenter);
  const chosen = options.find((o) => o.key === facilityKey(chosenItem))!;
  return applyFacilityOption(
    field,
    kind,
    chosen,
    options,
    facilities.area.radiusMeters,
    markPending,
    "ai",
  );
}

// 使用者在勘查表手動切換某設施類欄位的候選項（見 SurveyFormGrid.tsx 的候選清單 UI）：
// 只在 field.facilityOptions 裡找該 key 重組欄位，不重新打 API；source 一律標記為
// 「已修改」，因為這是人工覆蓋 AI 自動判準的結果，跟 AI 自動選的原值不同。
export function selectSurveyFacilityOption(
  field: SurveyField,
  facilityOptionKey: string,
): SurveyField {
  const kind = SURVEY_FACILITY_KIND[field.key];
  const chosen = field.facilityOptions?.find(
    (o) => o.key === facilityOptionKey,
  );
  if (!kind || !field.facilityOptions || !chosen) return field;
  return applyFacilityOption(
    field,
    kind,
    chosen,
    field.facilityOptions,
    field.radiusMeters ?? 0,
    false,
    "edited",
  );
}

// 使用者展開某設施類欄位的候選清單才呼叫（見 SurveyFormGrid.tsx 的展開按鈕）：系統自動選中
// 的那筆在 deriveFacilityField/enrichSurveyWithWalkingDistances 階段就已經查過步行距離，
// 其餘候選當初刻意沒有一併查（見 overrideWithWalkingDistances 說明），避免每個欄位一產出
// 就多打好幾支 OSRM；等使用者真的想看/切換候選時才逐筆補查，查過的候選之後展開不會重查。
export async function resolveFacilityAlternates(
  center: LatLng,
  field: SurveyField,
): Promise<SurveyField> {
  const options = field.facilityOptions;
  if (!options || options.length <= 1) return field;
  // 這個欄位本來就不是走步行距離判準（如學校/公園多半用直線距離），候選之間量測方式
  // 一致，不用另外查
  if (!options.some((o) => o.walked)) return field;
  if (options.every((o) => o.walked)) return field;

  const centerCoord: Coordinate = [center.lng, center.lat];
  const resolved = await Promise.all(
    options.map(async (o) => {
      if (o.walked) return o;
      const walking = await fetchWalkingDistance([centerCoord, [o.lon, o.lat]]);
      return walking
        ? { ...o, metersToCenter: walking.distanceMeters, walked: true }
        : o;
    }),
  );
  return { ...field, facilityOptions: resolved };
}

// 表3頁面掛載後（見 SurveyFormPage.tsx）才背景補查步行距離：produceSurvey() 為了讓
// TaskSetupPage 能快速跳轉，先用 skipWalkingDistance 拿直線距離、把相關欄位標 pending；
// 這裡用同一個地點重新查一次（這次含 OSRM），只回填「查完當下仍是 pending」的欄位——
// 若使用者在查詢完成前已經手動編輯/確認過該欄位，pending 會被清掉，這裡就不會覆蓋過去。
export async function enrichSurveyWithWalkingDistances(
  location: LatLng,
  survey: SurveyField[],
): Promise<SurveyField[]> {
  const pendingKeys = new Set(
    survey
      .filter((f) => f.pending && SURVEY_FACILITY_KIND[f.key])
      .map((f) => f.key),
  );
  if (pendingKeys.size === 0) return survey;

  let facilities: NearbyFacilitiesResponse | null = null;
  try {
    facilities = await fetchNearbyFacilities(location);
  } catch (err) {
    // 後台補充步行距離失敗（通常是 facilities API 故障），
    // 拿掉 pending 讓 UI 停止動畫，欄位保留原本的直線距離值
    console.warn("enrichSurveyWithWalkingDistances 查詢設施失敗", err);
    return survey.map((f) =>
      pendingKeys.has(f.key) ? { ...f, pending: undefined } : f,
    );
  }

  if (!facilities) {
    // 查不到就拿掉 pending，欄位維持原本的直線距離值，不要讓 UI 卡在「查詢中」動畫
    return survey.map((f) =>
      pendingKeys.has(f.key) ? { ...f, pending: undefined } : f,
    );
  }

  // produceSurvey() 當初已經替 pending 欄位算過 isInsideBoundary 並反映在 value 裡；這裡拿到
  // 步行距離後重新 derive 該欄位時，若沒有同樣傳入 isInsideBoundary，會把「本區段內」的內外
  // 判斷結果洗掉、退回成單純距離字串。pendingKeys 本來就只含 SURVEY_FACILITY_KIND 裡的欄位，
  // 這些欄位全部都要套用內外判斷，不用再篩一次。
  const sectionBoundary = await resolveSectionBoundary(location).catch(
    () => null,
  );
  const isInsideBoundary = sectionBoundary
    ? (lon: number, lat: number) =>
        isPointInSectionBoundary({ lat, lng: lon }, sectionBoundary.feature)
    : undefined;

  return survey.map((field) => {
    if (!pendingKeys.has(field.key)) return field;
    return deriveFacilityField(
      field,
      facilities,
      SURVEY_FACILITY_KIND[field.key],
      false,
      isInsideBoundary,
    );
  });
}

// ① 表3勘查表：傳查詢起點(位置座標)給後端，打周邊設施查詢 API 算距離、組表3 JSON。
// 部分欄位為預填值（根據表單預設），部分欄位為 AI 查詢結果；merge 時預填值為主。
export async function produceSurvey(
  req: ProduceSurveyRequest,
): Promise<ProduceSurveyResponse> {
  // TODO: 換成 fetch(...)
  await delay(); // 模擬 AI 產製時間

  // 1. 取得 mock 基礎值（模板）
  const base =
    mockSurveyFixtures[req.sectionId] ?? mockSurveyFixtures["P002-00"];

  // 2. 取得該位置角色(locationRole)的預填數據
  const prefillData = getPrefillDataByRole(req.locationRole);
  const prefillCondition = getConditionPrefillByRole(req.locationRole);

  // 3. 初始化 survey：先用 mock 模板結構，然後逐欄覆蓋預填值
  let survey = base.survey.map((field) => {
    const prefilled = prefillData[field.key];
    if (prefilled) {
      // 預填值優先，覆蓋 mock 的值
      return prefilled;
    }
    return field;
  });

  // 4. 如果提供了座標，打周邊設施查詢 API 補充資料
  let benchmark = { ...prefillCondition }; // 先用預填值初始化

  if (req.location) {
    // 先用 skipWalkingDistance 拿直線距離版本，讓這支函式快速回傳、TaskSetupPage
    // 能馬上跳轉到表3頁面；交通／公共建設／工商活動三類欄位標 pending，
    // 頁面掛載後由 enrichSurveyWithWalkingDistances() 背景補上真正的步行距離。
    const facilities = await fetchNearbyFacilities(
      { lat: req.location.lat, lng: req.location.lng },
      undefined,
      { skipWalkingDistance: true },
    );

    if (facilities) {
      // SURVEY_FACILITY_KIND 裡的欄位（學校/公園/停車場/金融機構/墓地/公車站）都要拿設施實際
      // 座標比對區段邊界；邊界解析不到時 isInsideBoundary 回傳 null，deriveFacilityField 會
      // 維持原本只顯示距離、不宣稱內外的寫法，不編邊界資料。
      const needsBoundaryCheck = survey.some(
        (field) =>
          SURVEY_FACILITY_KIND[field.key] && field.source !== "prefilled",
      );
      const sectionBoundary = needsBoundaryCheck
        ? await resolveSectionBoundary({
            lat: req.location.lat,
            lng: req.location.lng,
          }).catch(() => null)
        : null;
      const isInsideBoundary = sectionBoundary
        ? (lon: number, lat: number) =>
            isPointInSectionBoundary({ lat, lng: lon }, sectionBoundary.feature)
        : undefined;

      // 這幾個欄位的資料來源是「AI 主動查找」(SURVEY_FACILITY_KIND)
      // 但預填值已經設定，所以只在查詢有結果且預填值為空時才補充 AI 查詢結果
      survey = survey.map((field) => {
        const kind = SURVEY_FACILITY_KIND[field.key];
        if (!kind) return field;

        // 若預填值已有內容（source 為 "prefilled"），則維持預填值不動
        // 只有在預填為空(source 為 "empty")時才用 AI 查詢結果補充
        if (field.source === "prefilled") {
          return field;
        }

        return deriveFacilityField(
          field,
          facilities,
          kind,
          isInWalkingDistanceGroup(facilities, kind),
          isInsideBoundary,
        );
      });

      // 5. 表3事實確定後，同步推導表4對應欄位
      // 預填值的欄位不會被 linkage 覆蓋（因為 source 為 "prefilled"）
      let linkState = { survey, benchmark };
      for (const key of Object.keys(SURVEY_LINKAGE)) {
        if (SURVEY_FACILITY_KIND[key]) {
          linkState = applySurveyLinkage(linkState, key);
        }
      }
      survey = linkState.survey;
      benchmark = linkState.benchmark;
    }
  }

  return {
    meta: {
      ...base.meta,
      // base（mockSurveyFixtures）只有一份共用模板，四個 locationRole 全部指到同一物件，
      // base.meta.sectionId 因此固定是模板本身的區段——不能直接沿用，否則比準地跟三個比較
      // 標的的 meta.sectionId 會全部相同，E0（produce-regional-factors）算 comparisonCases/
      // sameSectionAsBenchmark 時就會誤判成「全部同區段」。四筆地實際上落在不同地價區段
      // （新北市樹林區真實案例：比準地P001-00／比較標的1~3各為P002-00/P003-00/P004-00，
      // 見 prefillData.ts 的 *_CONDITION_PREFILL.sectionId），改用已依 locationRole 取出的
      // prefillCondition.sectionId，讓兩邊（meta 與宗地條件）對同一筆地回報一致的區段編號。
      sectionId: prefillCondition.sectionId ?? base.meta.sectionId,
      location: req.location
        ? { lat: req.location.lat, lng: req.location.lng }
        : base.meta.location,
    },
    survey,
    benchmark,
  };
}

// 真實 Lambda API 端點（E0 · produce-regional-factors，見 E2E_MANUAL.md §E0）。評分核心
// regional-factor-grading 一次只評一筆地，E0 內部對「比準地＋每個比較標的」各評一次再合成
// 表5比較欄，所以比有比較標的時會比單一評分久，timeout 抓寬一點。
const PRODUCE_REGIONAL_FACTORS_API_BASE_URL: string | undefined = import.meta
  .env.VITE_PRODUCE_REGIONAL_FACTORS_API_URL as string | undefined;
// 值來自環境變數（每個環境的 Lambda URL 可能不同），見 .env.development
// VITE_PRODUCE_REGIONAL_FACTORS_LAMBDA_URL
const PRODUCE_REGIONAL_FACTORS_LAMBDA_URL: string | undefined = import.meta.env
  .VITE_PRODUCE_REGIONAL_FACTORS_LAMBDA_URL as string | undefined;
const PRODUCE_REGIONAL_FACTORS_TIMEOUT_MS = 60000;

// ② 表5區域因素分析明細表：拿①使用者確認後的比準地＋各比較標的的表1定稿，打 E0 API 內部
// 對每一筆地各評一次區域因素（Bedrock），再合成「比準地 vs 比較標的」的表5比較欄。
export async function produceRegionalFactors(
  req: ProduceRegionalFactorsRequest,
): Promise<ProduceRegionalFactorsResponse> {
  const url =
    PRODUCE_REGIONAL_FACTORS_API_BASE_URL ??
    PRODUCE_REGIONAL_FACTORS_LAMBDA_URL;
  if (!url) {
    throw new Error(
      "produce-regional-factors API URL 未設定，請設定環境變數 VITE_PRODUCE_REGIONAL_FACTORS_API_URL 或 VITE_PRODUCE_REGIONAL_FACTORS_LAMBDA_URL",
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(PRODUCE_REGIONAL_FACTORS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `produce-regional-factors 失敗（HTTP ${res.status}）：${bodyText.slice(0, 500)}`,
    );
  }
  return (await res.json()) as ProduceRegionalFactorsResponse;
}

// 真實 Lambda API 端點（E · produce-comparison，見 E2E_MANUAL.md §E／API_REFERENCE.md §E）。
// 內部對「比準地＋每個比較標的」各打一次 individual-factor-grading（Bedrock）+ 拉一次
// land-transaction 補正常單價/交易日期，(1+N) 次評分並行約 20–40 秒，timeout 抓寬一點。
const PRODUCE_COMPARISON_API_BASE_URL: string | undefined = import.meta.env
  .VITE_PRODUCE_COMPARISON_API_URL as string | undefined;
// 值來自環境變數（每個環境的 Lambda URL 可能不同），見 .env.development
// VITE_PRODUCE_COMPARISON_LAMBDA_URL
const PRODUCE_COMPARISON_LAMBDA_URL: string | undefined = import.meta.env
  .VITE_PRODUCE_COMPARISON_LAMBDA_URL as string | undefined;
const PRODUCE_COMPARISON_TIMEOUT_MS = 60000;

// 後端回應的原始形狀（見 API_REFERENCE.md §E 範例回應）：comparison[] 每列只有單一 rate——
// 實測那個數字就是 cases[0]（第一筆比較標的）的值，不是「三筆共用」；真正「每筆比較標的各自
// 一格」的差異率，其實已經算在 comparisonForm.cases[i].rates（19-key 物件）裡了，只是沒有透過
// comparison[].compare[] 攤平出來給前端。這跟前端一直以來的資料模型（見 types.ts ComparisonCase
// 註解：individual factor 差異率一律以 comparison[].compare[] 為單一事實來源，不額外存 case 自己
// 的 rates 快照，避免兩邊editing後漂移）對不起來，所以這裡收到回應後要重組一次，不能直接當
// ProduceComparisonResponse 用（那樣 it.compare 會是 undefined，畫面逐格 it.compare[i] 就會炸）。
type RawComparisonFactorRow = {
  key: string;
  label: string;
  group: string;
  rate: number;
  reference?: FieldReference;
};
type RawComparisonCase = ComparisonCase & { rates?: Record<string, number> };
type RawProduceComparisonResponse = {
  comparison: RawComparisonFactorRow[];
  comparisonForm: Omit<ComparisonForm, "cases"> & {
    cases: RawComparisonCase[];
  };
  computed: ProduceComparisonResponse["computed"];
};

// 把後端「每列單一 rate」的原始形狀，重組成前端「每筆比較標的各自一格 compare[]」的
// FactorRow[]——逐案例改讀 comparisonForm.cases[i].rates[key]，reference 沿用該列後端給的
// 佐證文字（目前後端三案例共用同一套推導說明，非逐案例各自撰寫，先原樣沿用，不臆測分案例文字）。
function toFactorRows(raw: RawProduceComparisonResponse): FactorRow[] {
  return raw.comparison.map((row) => ({
    key: row.key,
    label: row.label,
    group: row.group,
    compare: raw.comparisonForm.cases.map((c) => ({
      rate: c.rates?.[row.key] ?? null,
      reference: row.reference,
    })),
  }));
}

// ③ 表4比較法調查估價表：帶入②使用者確認後的表5 + 比準地/各比較標的自己的表1定稿，打 E
// API 內部對每一筆地各評一次個別因素（Bedrock）、拉實價登錄補正常單價，算出試算價格。
export async function produceComparison(
  req: ProduceComparisonRequest,
): Promise<ProduceComparisonResponse> {
  const url = PRODUCE_COMPARISON_API_BASE_URL ?? PRODUCE_COMPARISON_LAMBDA_URL;
  if (!url) {
    throw new Error(
      "produce-comparison API URL 未設定，請設定環境變數 VITE_PRODUCE_COMPARISON_API_URL 或 VITE_PRODUCE_COMPARISON_LAMBDA_URL",
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(PRODUCE_COMPARISON_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `produce-comparison 失敗（HTTP ${res.status}）：${bodyText.slice(0, 500)}`,
    );
  }
  const raw = (await res.json()) as RawProduceComparisonResponse;

  // 比準地/各比較標的的座落、正常單價、交易日期、日期調整率、地價區段是已定案的寫死宗地
  // 條件（見 prefillData.ts 的 *_CONDITION_PREFILL），已隨 req.benchmark／
  // req.comparisonSurveys[].benchmark 送給後端；這裡用同一份 request 資料強制覆蓋回 API
  // 回應，不管後端是否真的採用 override（或內部改查 land-transaction 等其他來源），確保
  // 比較法調查估價表這幾欄不被後端結果蓋掉。
  const GROUND_TRUTH_KEYS = [
    "location",
    "normalPrice",
    "tradeDate",
    "dateAdjRate",
    "sectionId",
  ] as const;
  const forceGroundTruth = <T extends Partial<ComparisonCondition>>(
    target: T,
    truth: ComparisonCondition | undefined,
  ): T => {
    if (!truth) return target;
    const forced = { ...target };
    for (const key of GROUND_TRUTH_KEYS) {
      if (truth[key] !== undefined) {
        (forced as Record<string, unknown>)[key] = truth[key];
      }
    }
    return forced;
  };
  const comparisonFormWithGroundTruth = {
    ...raw.comparisonForm,
    benchmark: forceGroundTruth(raw.comparisonForm.benchmark, req.benchmark),
    cases: raw.comparisonForm.cases.map((c, i) =>
      forceGroundTruth(c, req.comparisonSurveys?.[i]?.benchmark),
    ),
  };

  const comparison = toFactorRows(raw);
  // 重跑 recomputeChain（跟使用者手動編輯表4任一格時同一支函式）而不是直接沿用後端算好的
  // adjustedPrice/absRateSum/trialPrice：兩邊都是同一套價格鏈公式，用同一支算才不會日後
  // 前端編輯一格後跟初始值算法各自漂移。上面已把 ground truth 欄位蓋回去，這裡重算的
  // adjustedPrice 自然也是用寫死的 normalPrice/dateAdjRate 算出來的。
  const recomputed = recomputeChain(
    comparisonFormWithGroundTruth as ComparisonForm,
    comparison,
  );
  return {
    comparison,
    comparisonForm: recomputed.comparisonForm,
    computed: recomputed.computed,
  };
}

// 真實 Lambda API 端點（D · case-store，見 API_REFERENCE.md §D）。案件與三表定稿儲存，
// 單一 Function URL 用 method + query 路由；走 Aurora Data API，平常 < 1 秒，冷啟動會慢一些。
const CASE_STORE_API_BASE_URL: string | undefined = import.meta.env
  .VITE_CASE_STORE_API_URL as string | undefined;
const CASE_STORE_LAMBDA_URL: string | undefined = import.meta.env
  .VITE_CASE_STORE_LAMBDA_URL as string | undefined;
const CASE_STORE_TIMEOUT_MS = 30000;

function caseStoreUrl(): URL {
  const url = CASE_STORE_API_BASE_URL ?? CASE_STORE_LAMBDA_URL;
  if (!url) {
    throw new Error(
      "case-store API URL 未設定，請設定環境變數 VITE_CASE_STORE_API_URL 或 VITE_CASE_STORE_LAMBDA_URL",
    );
  }
  return new URL(url);
}

async function readCaseStoreJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `case-store ${label}失敗（HTTP ${res.status}）：${bodyText.slice(0, 500)}`,
    );
  }
  return (await res.json()) as T;
}

// D0 建立案件：caseId 由後端產生，之後存三表定稿、image-upload、export-report 都靠它。
export async function createCase(req: CreateCaseRequest): Promise<CaseSummary> {
  const res = await fetch(caseStoreUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(CASE_STORE_TIMEOUT_MS),
  });
  return readCaseStoreJson<CaseSummary>(res, "建立案件");
}

// 列案件（輕量 metadata，依建立時間新到舊、不分頁）。帶 sectionId 只列該區段的案件。
export async function listCases(sectionId?: string): Promise<CaseSummary[]> {
  const url = caseStoreUrl();
  if (sectionId) url.searchParams.set("sectionId", sectionId);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(CASE_STORE_TIMEOUT_MS),
  });
  return readCaseStoreJson<CaseSummary[]>(res, "列表");
}

// 取單一案件完整 bundle（含已存的三表定稿）。查無 caseId 時後端回 404，這裡照樣 throw。
export async function getCase(caseId: string): Promise<CaseBundle> {
  const url = caseStoreUrl();
  url.searchParams.set("caseId", caseId);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(CASE_STORE_TIMEOUT_MS),
  });
  return readCaseStoreJson<CaseBundle>(res, "讀取案件");
}

export async function exportForms(
  _req: ExportFormsRequest,
): Promise<ExportFormsResponse> {
  await delay(200);
  // TODO: 換成 fetch("/api/export", { method: "POST", body: JSON.stringify(_req) })
  return mockExportFormsResponse;
}

// 真實 Lambda API 端點（G · image-upload，見 API_REFERENCE.md §G）。把一張圖片（產製圖籍或
// 補充照片）存進案件的 S3 資料夾，之後 export-report 帶同一個 caseId 就會把它併進報告 PDF。
const IMAGE_UPLOAD_API_BASE_URL: string | undefined = import.meta.env
  .VITE_IMAGE_UPLOAD_API_URL as string | undefined;
const IMAGE_UPLOAD_LAMBDA_URL: string | undefined = import.meta.env
  .VITE_IMAGE_UPLOAD_LAMBDA_URL as string | undefined;
const IMAGE_UPLOAD_TIMEOUT_MS = 30000;

function imageUploadUrl(): string {
  const url = IMAGE_UPLOAD_API_BASE_URL ?? IMAGE_UPLOAD_LAMBDA_URL;
  if (!url) {
    throw new Error(
      "image-upload API URL 未設定，請設定環境變數 VITE_IMAGE_UPLOAD_API_URL 或 VITE_IMAGE_UPLOAD_LAMBDA_URL",
    );
  }
  return url;
}

export async function uploadCaseImage(
  req: UploadCaseImageRequest,
): Promise<UploadCaseImageResponse> {
  const url = imageUploadUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(IMAGE_UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `image-upload 失敗（HTTP ${res.status}）：${bodyText.slice(0, 500)}`,
    );
  }
  return (await res.json()) as UploadCaseImageResponse;
}

// 使用者從 <input type="file">／拖放選的圖片直接上傳：先經 prepareImageForUpload 轉成
// export-report 放得進 PDF 的 PNG/JPEG、壓在 Function URL 大小上限內，再走 uploadCaseImage。
// 回傳的 fileName 是實際存進 S3 的檔名（加了防撞名前綴，可能改成 .jpg），不是原始檔名。
export async function uploadCaseImageFile(
  caseId: string,
  file: File,
): Promise<UploadCaseImageResponse & { fileName: string }> {
  const prepared = await prepareImageForUpload(file);
  const res = await uploadCaseImage({ caseId, ...prepared });
  return { ...res, fileName: prepared.fileName };
}

// 列出某案已上傳的圖片（含地圖擷取與補充照片），export-report 匯出時放進 PDF 的就是這份清單。
export async function listCaseImages(
  caseId: string,
): Promise<ListCaseImagesResponse> {
  const url = new URL(imageUploadUrl());
  url.searchParams.set("caseId", caseId);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(IMAGE_UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `image-upload 列表失敗（HTTP ${res.status}）：${bodyText.slice(0, 500)}`,
    );
  }
  return (await res.json()) as ListCaseImagesResponse;
}

// 真實 Lambda API 端點（Hx · export-report，見 API_REFERENCE.md §Hx）。正式匯出入口：內部打三支
// 填表 lambda、併入前端附的地圖、取回 caseId 對應的案件圖片，最後合成單一 PDF。耗時數秒～數十秒。
const EXPORT_REPORT_API_BASE_URL: string | undefined = import.meta.env
  .VITE_EXPORT_REPORT_API_URL as string | undefined;
const EXPORT_REPORT_LAMBDA_URL: string | undefined = import.meta.env
  .VITE_EXPORT_REPORT_LAMBDA_URL as string | undefined;
const EXPORT_REPORT_TIMEOUT_MS = 120000;

export async function exportReport(req: ExportReportRequest): Promise<Blob> {
  const url = EXPORT_REPORT_API_BASE_URL ?? EXPORT_REPORT_LAMBDA_URL;
  if (!url) {
    throw new Error(
      "export-report API URL 未設定，請設定環境變數 VITE_EXPORT_REPORT_API_URL 或 VITE_EXPORT_REPORT_LAMBDA_URL",
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(EXPORT_REPORT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `export-report 失敗（HTTP ${res.status}）：${bodyText.slice(0, 500)}`,
    );
  }
  // 新版後端把 PDF 寫進 S3、回 JSON { url }（避開 Function URL 6 MB 回應上限），再從 url 下載；
  // 舊版後端直接回 application/pdf。兩種都收，前後端部署先後順序不影響。
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return await res.blob();
  }
  const { url: pdfUrl } = (await res.json()) as ExportReportResponse;
  const pdfRes = await fetch(pdfUrl, {
    signal: AbortSignal.timeout(EXPORT_REPORT_TIMEOUT_MS),
  });
  if (!pdfRes.ok) {
    throw new Error(`下載匯出報告失敗（HTTP ${pdfRes.status}）：${pdfUrl}`);
  }
  return await pdfRes.blob();
}

// 這三大類的距離改用「步行距離」（OSRM routed-foot）覆蓋 FACILITIES_API 回傳的直線距離，
// 比較貼近實際現場感受的可及性；其餘分類（公共設施／特殊設施／其他）維持直線距離不動
// ——像殯葬設施等嫌惡設施本就是以直線距離判斷鄰避效應，不是走路可及性問題。
const WALKING_DISTANCE_GROUPS = ["交通", "公共建設", "工商活動"] as const;

function facilityKey(item: FacilityItem): string {
  return `${item.lon},${item.lat},${item.kind},${item.name ?? ""}`;
}

// byCategory[group].nearest 摘要物件的共用建構子，順便帶上 distanceType（若有）——
// 用同一個 helper 避免兩處（dedupe / 步行距離覆蓋後）各自拼一份容易漏欄位。
function toNearestSummary(item: FacilityItem) {
  return {
    kind: item.kind,
    name: item.name,
    metersToCenter: item.metersToCenter,
    ...(item.distanceType ? { distanceType: item.distanceType } : {}),
  };
}

// 文教設施這個 kind 太粗（國小/國中/高中/大學/幼兒園/圖書館全部混在一起），但地價查估
// 實務上通常在意的是「最近的國小」這類特定學制，不是「最近的任一文教設施」，所以額外
// 依名稱關鍵字拆出細項；其餘 kind（殯葬設施、污廢水處理設施…）本身已經夠細，直接用 kind。
function facilityDetailType(item: FacilityItem): string {
  if (item.kind === "文教設施" && item.name) {
    if (item.name.includes("幼兒園") || item.name.includes("幼稚園")) {
      return "文教設施:幼兒園";
    }
    if (item.name.includes("國小") || item.name.includes("國民小學")) {
      return "文教設施:國小";
    }
    if (item.name.includes("國中") || item.name.includes("國民中學")) {
      return "文教設施:國中";
    }
    if (item.name.includes("高中") || item.name.includes("高級中學")) {
      return "文教設施:高中";
    }
    if (item.name.includes("大學") || item.name.includes("學院")) {
      return "文教設施:大學";
    }
    if (item.name.includes("圖書館")) {
      return "文教設施:圖書館";
    }
    return "文教設施:其他";
  }
  return item.kind;
}

// 「接近學校之程度」查到多筆文教設施時（如同時有國小、國中），不是取距離最近，而是依
// 官方填表規則的學制優先序取值：大專院校 > 高中 > 國中 > 國小 > 幼兒園（婦幼）；圖書館等
// 其他文教設施不算學校層級，不列入判斷。同一優先序內若仍有多筆才比距離。
const SCHOOL_LEVEL_PRIORITY = [
  "大學",
  "高中",
  "國中",
  "國小",
  "幼兒園",
] as const;

function schoolLevelOf(
  item: FacilityItem,
): (typeof SCHOOL_LEVEL_PRIORITY)[number] | null {
  const detail = facilityDetailType(item);
  const level = detail.startsWith("文教設施:") ? detail.slice(5) : null;
  return (SCHOOL_LEVEL_PRIORITY as readonly string[]).includes(level ?? "")
    ? (level as (typeof SCHOOL_LEVEL_PRIORITY)[number])
    : null;
}

function pickSchoolFacility(items: FacilityItem[]): FacilityItem | null {
  const candidates = items.filter((item) => schoolLevelOf(item) !== null);
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => {
    const diff =
      SCHOOL_LEVEL_PRIORITY.indexOf(schoolLevelOf(a)!) -
      SCHOOL_LEVEL_PRIORITY.indexOf(schoolLevelOf(b)!);
    return diff !== 0 ? diff : a.metersToCenter - b.metersToCenter;
  })[0];
}

// 候選清單只給使用者在附近幾筆裡面手動改判準用，不是「查得到的全部都列出來」——像公車站
// 這種細項半徑內動輒兩三百筆，若全部當 alternates 保留，不但清單沒法用，
// overrideWithWalkingDistances 還會對每一筆都額外打一次 OSRM，等於一次噴出上百支步距查詢
// （曾在樹林區某案例實測到491筆公車站，把步距查詢卡住）。只保留最近幾筆當候選足夠涵蓋
// 「AI判準可能有爭議」的情境，太遠的不會是使用者真的想切換過去的對象。
const MAX_FACILITY_ALTERNATES = 4;
// 公車站密度太高、彼此可替代性也高（哪一站都差不多是「鄰近公車站」），使用者確認過不需要
// 切換選項，維持原本「只取最近一筆」的簡單判準，完全不保留 alternates，避免任何額外查詢。
const FACILITY_KINDS_WITHOUT_ALTERNATES = new Set(["公車站"]);

// 每個細項（如國小、國中、墓地、污水處理場…）若查到多筆，官方判準只看「影響最大者」——
// FacilityItem 除了距離之外沒有規模/嚴重程度等其他欄位可用來評估影響力，所以目前用
// 距離最近的一筆當代理判準（不論是嫌惡設施的鄰避效應、還是學校等正面設施的可及性，
// 越近通常影響越大）；也順便大幅縮減後續要打 OSRM 步行距離的筆數。但「最近」不代表
// 使用者一定認同，所以最近的幾筆不整批丟棄，改附掛在留下那一筆的 alternates（見
// MAX_FACILITY_ALTERNATES）——facilities/byCategory 的筆數/count/map 標點等既有邏輯只看
// 留下的那一筆，行為不變；只有 deriveFacilityField() 會展開 alternates 組出
// SurveyField.facilityOptions 供使用者切換（見 selectSurveyFacilityOption）。
function dedupeNearestPerDetailType(
  data: NearbyFacilitiesResponse,
): NearbyFacilitiesResponse {
  const groupedByType = new Map<string, FacilityItem[]>();
  for (const item of data.facilities) {
    const type = facilityDetailType(item);
    const group = groupedByType.get(type);
    if (group) group.push(item);
    else groupedByType.set(type, [item]);
  }

  const chosenByOriginalKey = new Map<string, FacilityItem>();
  for (const items of groupedByType.values()) {
    const [nearest, ...rest] = items
      .slice()
      .sort((a, b) => a.metersToCenter - b.metersToCenter);
    const alternates = FACILITY_KINDS_WITHOUT_ALTERNATES.has(nearest.kind)
      ? []
      : rest.slice(0, MAX_FACILITY_ALTERNATES);
    chosenByOriginalKey.set(
      facilityKey(nearest),
      alternates.length > 0 ? { ...nearest, alternates } : nearest,
    );
  }

  const resolve = (f: FacilityItem) => chosenByOriginalKey.get(facilityKey(f));

  const facilities = data.facilities
    .filter((f) => resolve(f))
    .map((f) => resolve(f)!);

  const byCategory = { ...data.byCategory };
  for (const [group, summary] of Object.entries(data.byCategory)) {
    const items = summary.items
      .filter((f) => resolve(f))
      .map((f) => resolve(f)!);
    byCategory[group] = {
      ...summary,
      items,
      count: items.length,
      nearest: items[0] ? toNearestSummary(items[0]) : null,
    };
  }

  return { ...data, facilities, byCategory };
}

// 將「交通／公共建設／工商活動」三大類設施的 metersToCenter 由直線距離改為 OSRM 步行距離；
// 逐筆查詢，查詢失敗（逾時/無路徑）的個別設施保留原本直線距離，不整批放棄、也不捏造數字。
// distanceType 只在「這一筆真的查成功」時標記，跟它屬於哪個分類無關——分類只決定要不要
// 嘗試查，查詢結果才決定最後到底是不是步行距離，避免查失敗回退直線後還誤標成步行距離。
async function overrideWithWalkingDistances(
  data: NearbyFacilitiesResponse,
  center: LatLng,
): Promise<NearbyFacilitiesResponse> {
  // 只查「目前顯示」的那一筆（不含 alternates）：alternates 只有使用者展開候選清單時才
  // 值得知道步行距離，這裡先不查，避免每個欄位都額外多打好幾支 OSRM——展開時的查詢見
  // resolveFacilityAlternates()。
  const targets = new Map<string, FacilityItem>();
  for (const group of WALKING_DISTANCE_GROUPS) {
    const summary = data.byCategory[group];
    if (!summary) continue;
    for (const item of summary.items) targets.set(facilityKey(item), item);
  }
  if (targets.size === 0) return data;

  const centerCoord: Coordinate = [center.lng, center.lat];
  const entries = await Promise.all(
    Array.from(targets.entries()).map(async ([key, item]) => {
      const walking = await fetchWalkingDistance([
        centerCoord,
        [item.lon, item.lat],
      ]);
      return [
        key,
        walking
          ? { meters: walking.distanceMeters, walked: true as const }
          : { meters: item.metersToCenter, walked: false as const },
      ] as const;
    }),
  );
  const distanceByKey = new Map(entries);

  const overrideItem = (item: FacilityItem): FacilityItem => {
    const found = distanceByKey.get(facilityKey(item));
    if (!found) return item;
    return {
      ...item,
      metersToCenter: found.meters,
      ...(found.walked ? { distanceType: "walking" as const } : {}),
    };
  };

  const facilities = data.facilities
    .map(overrideItem)
    .sort((a, b) => a.metersToCenter - b.metersToCenter);

  const byCategory = { ...data.byCategory };
  for (const group of WALKING_DISTANCE_GROUPS) {
    const summary = byCategory[group];
    if (!summary) continue;
    const items = summary.items
      .map(overrideItem)
      .sort((a, b) => a.metersToCenter - b.metersToCenter);
    byCategory[group] = {
      ...summary,
      items,
      nearest: items[0] ? toNearestSummary(items[0]) : null,
    };
  }

  return { ...data, facilities, byCategory };
}

async function fetchRawFacilities(
  url: string,
  timeoutMs: number,
  label: string,
): Promise<NearbyFacilitiesResponse | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      console.log(`✅ 使用${label}:`, url);
      return (await res.json()) as NearbyFacilitiesResponse;
    }
    // API 返回非 2xx 狀態碼時拋出異常，讓上層 catch 處理
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `${label}失敗（HTTP ${res.status}）：${bodyText.slice(0, 200)}`,
    );
  } catch (err) {
    console.warn(`${label}查詢失敗`, err);
    throw err; // 重新拋出，讓 produceSurvey 捕獲並失敗
  }
}

/**
 * 依座標半徑查詢周邊設施（學校/公園/醫療/停車/公車站/金融/加油站/殯葬…）
 * 供「設施距離示意圖」標點，及與勘查表人工填寫距離互相對照佐證。
 * 優先順序：① VITE_FACILITIES_API_URL（環境變數，可用於自行架設的後端）
 * ② FACILITIES_LAMBDA_URL（真實 Lambda，ntpc-facilities）
 * 取得原始資料後，交通／公共建設／工商活動三類再套用 OSRM 步行距離覆蓋——OSRM 序列化
 * 節流下這步可能要幾秒到幾十秒，呼叫端若需要「先秀出頁面、稍後補上步行距離」（見
 * produceSurvey + enrichSurveyWithWalkingDistances），可傳 skipWalkingDistance 先拿
 * 直線距離版本，之後再自行呼叫一次拿完整版本。
 */
export async function fetchNearbyFacilities(
  center: LatLng,
  radiusMeters?: number,
  options?: { skipWalkingDistance?: boolean },
): Promise<NearbyFacilitiesResponse | null> {
  const radius = radiusMeters ?? FACILITIES_QUERY_RADIUS_METERS;

  // PostGIS-backed Lambda 跑在 VPC 裡，冷啟動（建立 DB connection pool）可能耗時數秒，
  // timeout 抓寬一點避免第一次呼叫就被判定失敗
  const FACILITIES_API_TIMEOUT_MS = 8000;

  let lastError: Error | null = null;

  // 方案 1: 環境變數設定的 API（優先級最高，可用於自行架設的後端）
  const envUrl = buildFacilitiesApiUrl(center, radius, undefined);
  if (envUrl) {
    try {
      const result = await fetchRawFacilities(
        envUrl,
        FACILITIES_API_TIMEOUT_MS,
        "環境變數 API",
      );
      if (result) {
        const deduped = dedupeNearestPerDetailType(result);
        if (options?.skipWalkingDistance) return deduped;
        return overrideWithWalkingDistances(deduped, center);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn("環境變數 API 失敗，嘗試 Lambda API...", err);
      // 繼續嘗試下一個 API
    }
  }

  // 方案 2: 真實 Lambda（ntpc-facilities，VITE_FACILITIES_LAMBDA_URL）
  const lambdaUrl = buildFacilitiesApiUrl(
    center,
    radius,
    FACILITIES_LAMBDA_URL,
  );
  if (lambdaUrl) {
    try {
      const result = await fetchRawFacilities(
        lambdaUrl,
        FACILITIES_API_TIMEOUT_MS,
        "真實 Lambda API",
      );
      if (result) {
        const deduped = dedupeNearestPerDetailType(result);
        if (options?.skipWalkingDistance) return deduped;
        return overrideWithWalkingDistances(deduped, center);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn("真實 Lambda API 失敗", err);
    }
  }

  // 所有 API 都失敗
  if (lastError) {
    throw lastError;
  }

  // 無任何 API URL 可用（不應該發生）
  return null;
}

// Type definitions for GeoJSON
declare global {
  namespace GeoJSON {
    interface Polygon {
      type: "Polygon";
      coordinates: number[][][];
    }
  }
}
