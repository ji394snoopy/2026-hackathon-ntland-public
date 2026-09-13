-- 地籍 finalize:staging(WKT text)→ land_parcel(geometry)、建索引、聚合段中心點。
-- 跑在 40-land-parcel.sql 建表 + \copy 灌完 staging 與 land_section 之後。
--
-- 雲端(Data API)跑同樣這幾句,但必須**一句一次**(execute-statement 不能用 ';' 串),
-- 見 infra/README.md 步驟 2e。

-- --- 1) staging → land_parcel -------------------------------------------------
-- ST_MakeValid:KML 來源偶有自相交/重複點的環,不修會讓後續 ST_PointOnSurface 與空間索引
-- 出問題。ST_Multi:表定義是 MultiPolygon,但來源每筆通常只有一個面,統一包起來。
-- 面積用 geography 算(公尺),不是 4326 的度。
INSERT INTO land_parcel (sectno, parcelno, master_no, sub_no, district, section, geom, centroid, area_m2)
SELECT sectno,
       parcelno,
       master_no,
       sub_no,
       district,
       NULLIF(section, ''),                                          -- 段名不詳 → NULL
       ST_Multi(ST_MakeValid(ST_GeomFromText(wkt, 4326)))            AS geom,
       ST_PointOnSurface(ST_MakeValid(ST_GeomFromText(wkt, 4326)))   AS centroid,
       ST_Area(ST_GeomFromText(wkt, 4326)::geography)                AS area_m2
FROM land_parcel_staging
WHERE district IS NOT NULL
ON CONFLICT (sectno, parcelno) DO NOTHING;

-- --- 2) 索引 ------------------------------------------------------------------
-- 段名查(帶 district 消歧義,段名跨區重複很常見)。
CREATE INDEX IF NOT EXISTS land_parcel_lookup_idx   ON land_parcel (district, section, parcelno);
-- 數值地號查:land-locate 實際走的路徑(吸收補零/不補零的格式分歧)。
CREATE INDEX IF NOT EXISTS land_parcel_num_idx      ON land_parcel (district, section, master_no, sub_no);
CREATE INDEX IF NOT EXISTS land_parcel_geom_gix     ON land_parcel USING GIST (geom);
CREATE INDEX IF NOT EXISTS land_parcel_centroid_gix ON land_parcel USING GIST (centroid);

CREATE INDEX IF NOT EXISTS land_section_lookup_idx   ON land_section (district, section);
CREATE INDEX IF NOT EXISTS land_section_sectno_idx   ON land_section (sectno);
CREATE INDEX IF NOT EXISTS land_section_centroid_gix ON land_section USING GIST (centroid);

-- --- 3) 段中心點 / bbox / 宗地數 ------------------------------------------------
-- 不在轉檔腳本算,交給 PostGIS:更準,也免得兩邊各寫一套。
-- 聚合鍵用 (sectno, district) 而非只有 sectno —— 11 個代碼在對照表裡重複,只用 sectno
-- 會把兩個不同區的同代碼段混在一起。land_parcel 已反正規化 district,直接一起 group。
UPDATE land_section s
SET centroid     = agg.centroid,
    bbox         = agg.bbox,
    parcel_count = agg.n,
    has_geometry = true
FROM (
  SELECT sectno,
         district,
         ST_Centroid(ST_Collect(centroid)) AS centroid,
         ST_Envelope(ST_Collect(geom))     AS bbox,
         count(*)                          AS n
  FROM land_parcel
  GROUP BY sectno, district
) agg
WHERE s.sectno = agg.sectno AND s.district = agg.district;

-- --- 4) 收尾 ------------------------------------------------------------------
DROP TABLE IF EXISTS land_parcel_staging;

ANALYZE land_parcel;
ANALYZE land_section;
