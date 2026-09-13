-- Runs after the CSV bulk-load: build the WGS84 point geometry from the TWD97/TM2
-- (EPSG:3826) x/y columns, then index it.
--
-- ST_SetSRID(ST_MakePoint(x, y), 3826) tags the raw meters as 3826; ST_Transform then
-- reprojects to 4326 (lon/lat). Rows missing either coordinate are left with NULL geom.

UPDATE doorplate
SET geom = ST_Transform(ST_SetSRID(ST_MakePoint(x_3826, y_3826), 3826), 4326)
WHERE x_3826 IS NOT NULL AND y_3826 IS NOT NULL;

-- GiST spatial index — required for fast nearest-neighbor / bbox queries over ~2M points.
CREATE INDEX IF NOT EXISTS doorplate_geom_gix ON doorplate USING GIST (geom);

-- Help the planner after a large bulk load + update.
ANALYZE doorplate;
