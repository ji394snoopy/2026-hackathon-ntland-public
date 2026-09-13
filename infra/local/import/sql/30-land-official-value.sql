-- 新北市土地公告地價 / 公告土地現值 (99~115 年,逐年一列;每年約百萬列).
--
-- 對應 Drizzle schema 的 land_official_value(infra/lambda/shared/db/schema.ts)。
-- 非空間表(用 段/地號 查,不做空間查詢),所以沒有 geom 欄。
--
-- 匯入路徑(資料量大,雲端走 S3 import,見 README「土地公告地價匯入」):
--   雲端:每年一個已預處理成「含 year 欄」的 CSV → aws_s3.table_import_from_s3 直接灌。
--         CSV 欄位順序需對齊下方 (county, district, segment, lid, year,
--         official_value, official_price)。多年份重複 import 到同一張表即可。
--   本機:CSV 走 \copy 進同一張表(import.sh 的 land-value target,若有本機 CSV)。
--
-- 來源欄位名對照(來源 → 本表):
--   country                  -> county            縣市別
--   district                 -> district          行政區
--   segment                  -> segment           段小段
--   lid                      -> lid               地號
--   (預處理新增)              -> year              民國年(99~115)
--   official_value_busiprval -> official_value     公告土地現值(元/㎡)
--   official_price_busiprval -> official_price     公告地價(元/㎡)
--
-- key = (segment, lid, year):同一地號一年一列。land-value Lambda 以此查最近年 vs
-- 前一年並算漲幅%。

DROP TABLE IF EXISTS land_official_value;

CREATE TABLE land_official_value (
  county         text,             -- 縣市別 (country)
  district       text,             -- 行政區
  segment        text NOT NULL,    -- 段小段
  lid            text NOT NULL,    -- 地號
  year           integer NOT NULL, -- 民國年 (99~115)
  official_value numeric,          -- 公告土地現值 (official_value_busiprval)
  official_price numeric,          -- 公告地價 (official_price_busiprval)
  PRIMARY KEY (segment, lid, year)
);

-- land-value 查詢:先鎖段+地號,再依年份 desc 逐年往前找到有資料的前一年。
CREATE INDEX IF NOT EXISTS land_official_value_lookup_idx
  ON land_official_value (segment, lid, year);

-- 允許只給 district+segment 的較寬查詢。
CREATE INDEX IF NOT EXISTS land_official_value_district_idx
  ON land_official_value (district, segment);
