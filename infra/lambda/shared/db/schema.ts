// Drizzle schema — the single source of truth for the appraisal-case tables. The DDL that
// bootstraps these tables in Aurora is *generated* from here (drizzle-kit generate) and
// then run once by hand via `aws rds-data execute-statement` (see local-deploy-steps.txt);
// we do NOT let drizzle-kit push against the Data API (see db-access-layer-plan.md §2.2).
//
// Design (plan §4):
//   - primary key  caseId   (self-minted, see ./ids)
//   - secondary key sectionId (區段編號, repeatable; one section -> many cases)
//   - three 定稿 tables, each 1:1 with appraisal_case by case_id, each holding jsonb columns
//     whose contents ARE the frontend types in ./types (the mapper layer is identity today).
//
// jsonb columns are typed via `.$type<T>()` so db.query / inserts are type-safe end to end;
// the Data API driver (drizzle-orm/aws-data-api/pg) handles jsonb (de)serialization — no
// manual JSON.stringify / ::jsonb casts like the hand-written facilities/store repos.

import {
    boolean,
    customType,
    date,
    doublePrecision,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    primaryKey,
    text,
    timestamp
} from "drizzle-orm/pg-core";
import type {
    CaseMeta,
    ComparisonCondition,
    ComparisonForm,
    ComputedSummary,
    FactorRow,
    RegionalFactorRemarks,
    RegionalFactorRow,
    SurveyField,
} from "./types";

/** 案件主表. caseId 主鍵(自建), sectionId 副鍵(可重複). */
export const appraisalCase = pgTable(
  "appraisal_case",
  {
    caseId: text("case_id").primaryKey(),
    sectionId: text("section_id").notNull(),
    meta: jsonb("meta").$type<CaseMeta>(),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // GET ?sectionId= lists a section's cases — index the副鍵 so it stays fast as cases grow.
  (t) => [index("appraisal_case_section_id_idx").on(t.sectionId)],
);

/**
 * 表1 勘查表定稿 —— **一列 = 一筆宗地的勘查**。
 *
 * 表1 本身不分「宗地」和「比較標的」:同一份格式、同一組欄位,勘查的就是一筆宗地。
 * 分別是**案件**的事 —— (role, targetIndex) 決定這份勘查在本案裡扮演什麼角色:
 *   role='benchmark'   targetIndex=0     比準地(宗地),一案一份
 *   role='comparison'  targetIndex=0..2  比較標的,一案 0~3 份
 * targetIndex 對齊表4/表5 的 caseNo(0-based → caseNo = targetIndex + 1)。
 *
 * (原本比準地存 case_survey、比較標的存 case_comparison_survey 兩張表,格式與可存的
 * 欄位都不一致 —— 見 README「case_survey 合表 + 宗地身分欄」migration。)
 *
 * parcelNo / district / lat / lng 是**宗地身分**。原本比準地的存在 appraisal_case.meta
 * (benchmarkParcel / location),比較標的則完全沒地方存 —— 前端打 produce-comparison 時
 * 明明帶了座標,存檔時卻掉了。收斂到這裡後兩者一致,「從歷史挑比較標的」才拿得回座標,
 * 也才有辦法做「新比準地附近有哪些勘查過的宗地」的空間查詢。
 *
 * ⚠️ 空間查詢用的 `centroid`(由 lat/lng 算出的 generated geometry 欄)**刻意不宣告在
 * 這裡**:它由 README 的 migration 在 DB 端建立,Drizzle 從不讀也不寫,只給 raw SQL 的
 * ST_DWithin 查詢用。宣告成 Drizzle 欄位反而會被 $inferInsert 帶進 INSERT 而寫壞。
 */
export const caseSurvey = pgTable(
  "case_survey",
  {
    caseId: text("case_id")
      .notNull()
      .references(() => appraisalCase.caseId),
    /** 'benchmark'(比準地/宗地) | 'comparison'(比較標的) */
    role: text("role").notNull(),
    targetIndex: integer("target_index").notNull().default(0),
    survey: jsonb("survey").$type<SurveyField[]>().notNull(),
    benchmark: jsonb("benchmark").$type<ComparisonCondition>().notNull(),
    // --- 宗地身分(全選填:舊資料、以及定位失敗的標的都留 null)---
    // 定位一筆宗地要 district + section + parcelNo 三個一起 —— 地號在同一個行政區內
    // **不唯一**,不同段可以有相同地號,少了 section 就會抓到別筆地。
    district: text("district"), // 行政區('金山區')
    section: text("section"), // 段名含小段('金美段')
    sectno: text("sectno"), // 段代碼('1027');可用來 join land_section / land_parcel
    parcelNo: text("parcel_no"), // 地號原樣('489' / '31-1')
    // 座標與面積:land-easymap 的 center.lat/lng 與 fields.areaM2。
    // 一律用 double precision 而非 numeric —— driver 直接回 JS number,不用像
    // regional_total 那樣在 mapper 做 string -> number(那是目前唯一的非 identity 轉換,
    // 不想再多一個同型的坑)。
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    areaM2: doublePrecision("area_m2"), // 上游的權威面積;benchmark.area 是估價師可改的顯示值
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.role, t.targetIndex] }),
    // 「這筆地以前勘查過嗎」—— 從歷史挑比較標的的非空間入口。三欄一組才定得出一筆宗地。
    index("case_survey_parcel_idx").on(t.district, t.section, t.parcelNo),
  ],
);

/** 表5 區域因素分析明細表定稿. */
export const caseRegionalFactors = pgTable("case_regional_factors", {
  caseId: text("case_id")
    .primaryKey()
    .references(() => appraisalCase.caseId),
  regionalFactors: jsonb("regional_factors").$type<RegionalFactorRow[]>().notNull(),
  // 總修正率是百分比小數(如 2.5), 存 numeric 避免整數截斷; Drizzle numeric 讀回為 string,
  // mapper 負責轉回 number.
  regionalTotal: text("regional_total"),
  remarks: jsonb("remarks").$type<RegionalFactorRemarks>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 表4 比較法調查估價表定稿. */
export const caseComparison = pgTable("case_comparison", {
  caseId: text("case_id")
    .primaryKey()
    .references(() => appraisalCase.caseId),
  comparison: jsonb("comparison").$type<FactorRow[]>().notNull(),
  comparisonForm: jsonb("comparison_form").$type<ComparisonForm>().notNull(),
  computed: jsonb("computed").$type<ComputedSummary>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Opendata tables — 公告地價/現值 與 實價登錄 (比較法調查估價表的市場面來源)
//
// These are NOT case tables; they are reference/opendata like `pois`/`doorplate`
// (raw-SQL tables elsewhere). We still define them in Drizzle so the query lambdas
// (land-value / land-transaction) get a type-safe handle via the shared getDb(),
// exactly like case-store. No geometry column (queried by 段/地號, not spatially),
// so no PostGIS dependency here.
//
// 匯入路徑刻意分開(資料量差 20x):
//   - land_official_value：每年百萬列 → S3 import(aws_s3.table_import_from_s3),
//     DDL/staging 見 infra/local/import/sql/ 與 README。CSV 由使用者預處理成含 year 欄。
//   - land_transaction：全市 ~5.7 萬列 → seed-cloud.mjs 的 Data API batch insert
//     (解析 rps02 段/地號、民國 YYYMMDD → 西元 date)。
// ---------------------------------------------------------------------------

/**
 * 公告地價/公告土地現值(99~115 年,逐年一列)。key = (segment, lid, year)。
 * 由 land-value Lambda 用 (district,)segment,lid 查最近年 vs 前一年並算漲幅%。
 */
export const landOfficialValue = pgTable(
  "land_official_value",
  {
    county: text("county"), // 縣市別
    district: text("district"), // 行政區
    segment: text("segment").notNull(), // 段小段
    lid: text("lid").notNull(), // 地號
    year: integer("year").notNull(), // 民國年(99~115)
    officialValue: numeric("official_value"), // 公告土地現值 (official_value_busiprval)，元/㎡
    officialPrice: numeric("official_price"), // 公告地價 (official_price_busiprval)，元/㎡
  },
  (t) => [
    // 同一地號一年一列 → 段+地號+年 唯一。
    primaryKey({ columns: [t.segment, t.lid, t.year] }),
    // land-value 查詢:先鎖段+地號,再依年份 desc 逐年往前找。
    index("land_official_value_lookup_idx").on(t.segment, t.lid, t.year),
    // 允許只給 district+segment 的較寬查詢。
    index("land_official_value_district_idx").on(t.district, t.segment),
  ],
);

/**
 * 實價登錄土地/房地/車位交易(交易歷史)。原始 rps* 欄位全存,另補三個衍生欄:
 *   - segment / lid：由 rps02(交易標的)解析出的段小段與地號(房地/車位常解析不出 → null)
 *   - tradeDate：rps07_yyymmddroc(民國 YYYMMDD)轉成的西元 date;原始字串保留在 rps07。
 * 由 land-transaction Lambda 用 district+segment 查歷史交易案例(預設只回 rps01='土地')。
 * 主鍵 rps27(政府端交易「編號」,唯一)。
 */
export const landTransaction = pgTable(
  "land_transaction",
  {
    id: text("id").primaryKey(), // = rps27(編號),政府端唯一鍵
    district: text("district"), // 鄉鎮市區
    // --- 由 rps02 解析出的衍生欄(供 段/地號 查詢)---
    segment: text("segment"), // 段小段(解析自 rps02;房地/車位可能為 null)
    lid: text("lid"), // 地號(解析自 rps02;房地/車位可能為 null)
    tradeDate: date("trade_date"), // 交易日期(rps07 民國轉西元;排序/區間查詢用)
    buildDate: date("build_date"), // 建築完成日期(rps14 民國轉西元;可能為 null)
    // --- 原始欄位(對齊來源 JSON key)---
    rps01: text("rps01"), // 交易標的(土地/房地(土地+建物)/車位…)
    rps02: text("rps02"), // 土地區段位置建物區段門牌
    rps03Area: numeric("rps03_area"), // 土地移轉總面積(㎡)
    rps04: text("rps04"), // 都市土地使用分區
    rps05: text("rps05"), // 非都市土地使用分區
    rps06: text("rps06"), // 非都市土地使用編定
    rps07: text("rps07"), // 交易年月日(原始民國 YYYMMDD 字串)
    rps08: text("rps08"), // 交易筆棟數
    rps09: text("rps09"), // 移轉層次
    rps10: text("rps10"), // 總樓層數
    rps11: text("rps11"), // 建物型態
    rps12: text("rps12"), // 主要用途
    rps13: text("rps13"), // 主要建材
    rps14: text("rps14"), // 建築完成年月(原始民國 YYYMMDD 字串)
    rps15Area: numeric("rps15_area"), // 建物移轉總面積(㎡)
    rps16Quantity: integer("rps16_quantity"), // 格局-房
    rps17Quantity: integer("rps17_quantity"), // 格局-廳
    rps18Quantity: integer("rps18_quantity"), // 格局-衛
    rps19: text("rps19"), // 格局-隔間
    rps20: text("rps20"), // 有無管理組織
    rps21Amount: numeric("rps21_amount"), // 總價(元)
    rps22Unit: numeric("rps22_unit"), // 單價(元/㎡)— 比較法「土地正常單價」來源
    rps23: text("rps23"), // 車位類別
    rps24Area: numeric("rps24_area"), // 車位移轉總面積(㎡)
    rps25Amount: numeric("rps25_amount"), // 車位總價(元)
    rps26: text("rps26"), // 備註
    rps28Area: numeric("rps28_area"), // 主建物面積(㎡)
    rps29Area: numeric("rps29_area"), // 附屬建物面積(㎡)
    rps30Area: numeric("rps30_area"), // 陽台面積(㎡)
    rps31: text("rps31"), // 電梯(有/無)
    rps32: text("rps32"), // 移轉編號
  },
  (t) => [
    // land-transaction 查詢:district + segment,再依交易日期排序。
    index("land_transaction_lookup_idx").on(t.district, t.segment, t.tradeDate),
    // 依交易類別過濾(預設只回土地)。
    index("land_transaction_kind_idx").on(t.rps01),
  ],
);

// ---------------------------------------------------------------------------
// 地籍 — 段層 land_section + 宗地層 land_parcel (land-locate 的資料來源)
//
// 來源:assets/新北市公有土地資料供應/ 的 1,318 個 KML(22.8 萬筆公有地宗地)+
// 新北市土地段代碼對照表,由 infra/scripts/kml-to-csv.mjs 轉 CSV、走 S3/\copy 匯入
// (DDL 另存一份可直接跑的版本在 infra/local/import/sql/40-land-parcel.sql)。
// 設計與實測數字見 infra/docs/land-locate-plan.md。
//
// ⚠️ 這兩張表是**公有土地**子集,不是完整地籍圖:段層覆蓋 ~70%、宗地層只有公有地。
// 私有地地號查不到是預期行為,由 land-locate 退回段中心點(precision:"section")。
// ---------------------------------------------------------------------------

/**
 * PostGIS 幾何欄。
 *
 * 不用 drizzle 內建的 `geometry()`:0.45.2 的 getSQLType() 寫死回 `geometry(point)`
 * (忽略 type/srid 設定),而且 mapFromDriverValue 會對每個讀回值跑 parseEWKB —— 對
 * MultiPolygon 只會解出垃圾。這裡用 customType 宣告正確的 DDL,TS 型別就是 driver
 * 實際回傳的東西:**WKB hex 字串**。
 *
 * 所以查詢一律不要直接 select 幾何欄,改在 DB 端投影成 GeoJSON / 座標:
 *   sql<string>`ST_AsGeoJSON(${landParcel.geom})`、`ST_X(...)`、`ST_Y(...)`
 */
const postgisGeometry = (kind: "Point" | "Polygon" | "MultiPolygon", srid = 4326) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `geometry(${kind}, ${srid})`,
  });

/**
 * 段層。對照表 1,869 段全灌 + 5 個「KML 有、對照表查無」的代碼 = 1,874 列。
 * 沒有 KML 幾何的段也留列(has_geometry=false),查詢時才能區分「段不存在」與
 * 「段存在但沒有幾何」。key = (district, sectno):段代碼本身不唯一(11 個重複)。
 */
export const landSection = pgTable(
  "land_section",
  {
    county: text("county").notNull().default("新北市"),
    district: text("district").notNull(), // 行政區
    sectno: text("sectno").notNull(), // 段代碼,補零 4 碼('0106')
    section: text("section"), // 段名(含小段);5 個查無代碼為 NULL
    centroid: postgisGeometry("Point")("centroid"), // 由該段宗地聚合;無幾何為 NULL
    bbox: postgisGeometry("Polygon")("bbox"),
    parcelCount: integer("parcel_count").notNull().default(0),
    hasGeometry: boolean("has_geometry").notNull().default(false),
    /** 'table'(對照表直接決定)| 'auto-centroid'(幾何判定)| 'override'(人工釘死) */
    districtSource: text("district_source"),
  },
  (t) => [
    primaryKey({ columns: [t.district, t.sectno] }),
    // 段名查一定要帶 district(段名跨區重複很常見,'大同段' 就有 4 個區)。
    index("land_section_lookup_idx").on(t.district, t.section),
    index("land_section_sectno_idx").on(t.sectno),
  ],
);

/**
 * 宗地層。key = (sectno, parcelno)。
 *
 * 除了原樣的 parcelno,另存 master_no / sub_no 兩個整數(31-1 → 31, 1;169 → 169, 0):
 * land_official_value.lid 補零('0489')、land_transaction.lid 不補零('489'),字串比對
 * 會無聲 miss,用數值查才吸收得掉(plan §2.4)。
 */
export const landParcel = pgTable(
  "land_parcel",
  {
    sectno: text("sectno").notNull(), // 段代碼,補零 4 碼
    parcelno: text("parcelno").notNull(), // 地號原樣('31-1')
    masterNo: integer("master_no").notNull(), // 母號
    subNo: integer("sub_no").notNull().default(0), // 子號(無子號為 0,不是 NULL)
    district: text("district").notNull(), // 反正規化,查詢免 join
    section: text("section"), // 反正規化;段名不詳者 NULL
    geom: postgisGeometry("MultiPolygon")("geom").notNull(),
    /** ST_PointOnSurface 而非 ST_Centroid:狹長/L 形宗地的重心可能落在面外。 */
    centroid: postgisGeometry("Point")("centroid").notNull(),
    areaM2: numeric("area_m2"), // ST_Area(geom::geography),平方公尺
    /** 資料來源;換成完整地籍圖時改成 'cadastral-full',表結構不用動。 */
    source: text("source").notNull().default("kml-public-land"),
  },
  (t) => [
    primaryKey({ columns: [t.sectno, t.parcelno] }),
    index("land_parcel_lookup_idx").on(t.district, t.section, t.parcelno),
    // land-locate 實際走的路徑:段 + 數值地號。
    index("land_parcel_num_idx").on(t.district, t.section, t.masterNo, t.subNo),
  ],
);

/** All tables, grouped — passed to drizzle({ schema }) so db.query.* is typed. */
export const schema = {
  appraisalCase,
  caseSurvey,
  caseRegionalFactors,
  caseComparison,
  landOfficialValue,
  landTransaction,
  landSection,
  landParcel,
};

// Convenience type aliases inferred straight from the schema (no hand-written row types).
export type AppraisalCaseRow = typeof appraisalCase.$inferSelect;
export type AppraisalCaseInsert = typeof appraisalCase.$inferInsert;
export type CaseSurveyRow = typeof caseSurvey.$inferSelect;
export type CaseSurveyInsert = typeof caseSurvey.$inferInsert;
export type CaseRegionalFactorsRow = typeof caseRegionalFactors.$inferSelect;
export type CaseRegionalFactorsInsert = typeof caseRegionalFactors.$inferInsert;
export type CaseComparisonRow = typeof caseComparison.$inferSelect;
export type CaseComparisonInsert = typeof caseComparison.$inferInsert;
export type LandOfficialValueRow = typeof landOfficialValue.$inferSelect;
export type LandOfficialValueInsert = typeof landOfficialValue.$inferInsert;
export type LandTransactionRow = typeof landTransaction.$inferSelect;
export type LandTransactionInsert = typeof landTransaction.$inferInsert;
export type LandSectionRow = typeof landSection.$inferSelect;
export type LandSectionInsert = typeof landSection.$inferInsert;
export type LandParcelRow = typeof landParcel.$inferSelect;
export type LandParcelInsert = typeof landParcel.$inferInsert;
