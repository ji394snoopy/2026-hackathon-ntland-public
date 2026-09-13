-- 新北市門牌位置數值資料 (~1.99M rows). Source CSV coordinates are EPSG:3826
-- (TWD97 / TM2, meters) in columns x_3826 / y_3826 — NOT lon/lat.
--
-- Loaded in two steps by import.sh:
--   1) \copy the raw CSV into this table's non-geometry columns (fast bulk load).
--   2) populate geom by projecting (x_3826, y_3826) from 3826 to 4326 so it can be
--      queried alongside the transport layers (which are 4326).
--
-- The source header's Chinese column "street、road、section" contains ideographic
-- commas; renamed here to a clean street_road_section identifier.

DROP TABLE IF EXISTS doorplate;

CREATE TABLE doorplate (
  countycode          text,
  areacode            text,
  village             text,
  neighbor            text,
  street_road_section text,
  area                text,
  lane                text,
  alley               text,
  number              text,
  x_3826              double precision,
  y_3826              double precision,
  -- Populated after load. Point geometry in WGS84 (lon/lat).
  geom                geometry(Point, 4326)
);
