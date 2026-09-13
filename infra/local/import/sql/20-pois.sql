-- OSM-sourced POIs for 新北市, one unified table across all categories.
--
-- Populated from assets/osm/ntpc-pois.geojson (produced by fetch-osm.mjs). Unlike the
-- transport layers — where each dataset is its own table — every OSM POI category lives
-- here in one table keyed by a `category` column, so the facilities query can filter by
-- category with one indexed table instead of a table-per-kind UNION.
--
-- These are the categories NLSC's buffer API does NOT cover (公共設施/公共建設/特殊設施/
-- 工商活動 + 交流道). 殯葬/加油站/醫療/文教 come from the NLSC API instead, not here.
--
-- import.sh loads the GeoJSON into pois_staging (props text, geom_json text) first, then
-- this finalize step turns it into the typed table below.

DROP TABLE IF EXISTS pois;

CREATE TABLE pois (
  id       bigserial PRIMARY KEY,
  category text NOT NULL,          -- our PoiCategory, e.g. 'park', 'bank', 'substation'
  name     text,                   -- display name, may be NULL for unnamed features
  props    jsonb,                  -- full OSM tags + osm_id/osm_type, kept as-is
  geom     geometry(Point, 4326)   -- WGS84, same SRID as every other table
);

-- De-duplicate on the source OSM identity (osm_type + osm_id): OSM can represent the same
-- real-world feature as more than one element (e.g. a way AND an enclosing relation), and
-- overlapping admin-boundary fetches can pull the same element twice. DISTINCT ON keeps a
-- single row per (osm_type, osm_id). Rows missing an osm_id (shouldn't happen from
-- fetch-osm.mjs, but guard anyway) fall back to a synthetic per-row key so they're kept.
-- The 高公局 interchange rows ride the same path with a synthetic osm_type='csv'.
INSERT INTO pois (category, name, props, geom)
SELECT DISTINCT ON (
  props::jsonb ->> 'osm_type',
  COALESCE(props::jsonb ->> 'osm_id', 'row-' || ctid::text)
)
  props::jsonb ->> 'category'                       AS category,
  NULLIF(props::jsonb ->> 'name', '')               AS name,
  props::jsonb                                      AS props,
  ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326)   AS geom
FROM pois_staging
WHERE props::jsonb ->> 'category' IS NOT NULL
ORDER BY
  props::jsonb ->> 'osm_type',
  COALESCE(props::jsonb ->> 'osm_id', 'row-' || ctid::text);

DROP TABLE pois_staging;

-- GiST spatial index for ST_DWithin / ST_Contains; btree on category so a single-category
-- filter is cheap before the spatial test.
CREATE INDEX IF NOT EXISTS pois_geom_gix ON pois USING GIST (geom);
CREATE INDEX IF NOT EXISTS pois_category_idx ON pois (category);

ANALYZE pois;

-- The 交流道 rows arrive here from TWO sources (OSM + 高公局 CSV, both staged above as
-- category='motorway_junction'); merging and de-duplicating them is the next file,
-- sql/21-interchange-merge.sql, which import.sh runs immediately after this one.
