-- 地籍:段層 land_section + 宗地層 land_parcel(新北市公有土地,22.8 萬筆)。
--
-- 對應 Drizzle schema 的 landSection / landParcel(infra/lambda/shared/db/schema.ts),
-- 由 land-locate Lambda 查「(區, 段名 或 段代碼, 地號) → 經緯度 + 宗地邊界」。
--
-- 來源:assets/新北市公有土地資料供應/f_*.kml(1,318 檔)+ assets/新北市土地段代碼對照表.csv,
-- 由 infra/scripts/kml-to-csv.mjs 轉成 parcels.csv / sections.csv(見 infra/docs/land-locate-plan.md)。
--
-- ⚠️ 覆蓋率:這是**公有土地**資料供應,不是完整地籍圖。段層 1,318/1,869 ≈ 70%,宗地層
-- 只有公有地 —— 私有地地號查詢必定 miss,由 land-locate 退回段中心點(precision:"section")。
-- 日後換完整地籍圖時表結構不用改,只是 land_parcel 多灌資料 + source 欄改值。
--
-- 匯入路徑(比照 pois / doorplate 的 staging → finalize 兩段式):
--   本機:import.sh 的 landparcel target — 本檔建表 → \copy 兩份 CSV → 41-*.sql finalize
--   雲端:同樣的 DDL 走 Data API 一句一句下,parcels.csv 走 aws_s3.table_import_from_s3
--         (22.8 萬列,見 infra/README.md 步驟 2e)

CREATE EXTENSION IF NOT EXISTS postgis;

DROP TABLE IF EXISTS land_parcel;
DROP TABLE IF EXISTS land_section;
DROP TABLE IF EXISTS land_parcel_staging;

-- --- 段層 ---------------------------------------------------------------------
-- 對照表 1,869 段全灌 + 5 個「KML 有、對照表查無」的代碼(section 為 NULL)= 1,874 列。
-- 沒有 KML 的段也留列且 has_geometry=false:查詢時能回「段存在但無幾何」(404 + sectionExists)
-- 而不是假裝段不存在。centroid / bbox / parcel_count / has_geometry 由 41-*.sql 從宗地聚合。
CREATE TABLE land_section (
  county          text NOT NULL DEFAULT '新北市',
  district        text NOT NULL,            -- 行政區(對照表;5 個查無代碼由幾何判定)
  sectno          text NOT NULL,            -- 段代碼,補零 4 碼('0106')
  section         text,                     -- 段名(含小段),對齊 land_transaction.segment
  centroid        geometry(Point, 4326),    -- 該段宗地聚合而來;無 KML 的段為 NULL
  bbox            geometry(Polygon, 4326),  -- 同上
  parcel_count    integer NOT NULL DEFAULT 0,
  has_geometry    boolean NOT NULL DEFAULT false,
  district_source text,                     -- 'table' | 'auto-centroid' | 'override'
  -- 段代碼本身不唯一(對照表有 11 個重複代碼),(district, sectno) 才唯一。
  PRIMARY KEY (district, sectno)
);

-- --- 宗地層 -------------------------------------------------------------------
-- master_no / sub_no 是地號拆出來的整數(31-1 → 31, 1;169 → 169, 0)。之所以除了原樣
-- parcelno 還要存整數:land_official_value.lid 補零('0489')、land_transaction.lid 不補零
-- ('489'),字串比對會無聲 miss,用數值 join 才吸收得掉(plan §2.4)。
CREATE TABLE land_parcel (
  sectno    text NOT NULL,                     -- 段代碼,補零 4 碼
  parcelno  text NOT NULL,                     -- 地號原樣('31-1')
  master_no integer NOT NULL,                  -- 母號
  sub_no    integer NOT NULL DEFAULT 0,        -- 子號(無子號為 0,不是 NULL,才進得了索引)
  district  text NOT NULL,                     -- 反正規化,查詢免 join
  section   text,                              -- 反正規化;段名不詳者 NULL,只能用 sectno 查
  geom      geometry(MultiPolygon, 4326) NOT NULL,
  centroid  geometry(Point, 4326) NOT NULL,    -- ST_PointOnSurface,凹形宗地也落在面內
  area_m2   numeric,                           -- ST_Area(geom::geography)
  source    text NOT NULL DEFAULT 'kml-public-land',
  PRIMARY KEY (sectno, parcelno)
);

-- --- staging(finalize 後 drop)------------------------------------------------
-- WKT 以 text 進來,再由 41-*.sql 一句 INSERT ... SELECT 轉成 geometry,同 doorplate 的做法。
CREATE TABLE land_parcel_staging (
  sectno    text,
  parcelno  text,
  master_no integer,
  sub_no    integer,
  district  text,
  section   text,
  wkt       text
);
