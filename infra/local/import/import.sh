#!/usr/bin/env bash
# Import the opendata assets into the local Docker PostGIS container.
#
# Everything runs through `docker exec` against the running container, so no host
# ogr2ogr / psql is required — only Docker (and Node, for the GeoJSON/JSON loaders).
#
# Prereqs:
#   - `docker compose -f infra/local/docker-compose.yml up -d` (container running/healthy)
#   - the asset files present under $ASSETS_DIR (default: repo assets/)
#
# Usage:
#   infra/local/import/import.sh              # import everything
#   infra/local/import/import.sh doorplate    # only the door-plate CSV
#   infra/local/import/import.sh transport    # only the GeoJSON transport layers
#   infra/local/import/import.sh busstops     # only the bus-stop points
#   infra/local/import/import.sh pois         # OSM POIs + 高公局交流道 (rebuilds `pois`)
#   infra/local/import/import.sh landparcel   # 地籍段/宗地 (NOT in `all` — 212MB source)
#
# Config via env (defaults match the discovered local container):
#   CONTAINER=ntland-postgis  DB=gis  DB_USER=postgres

set -euo pipefail

CONTAINER="${CONTAINER:-ntland-postgis}"
DB="${DB:-gis}"
DB_USER="${DB_USER:-postgres}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ASSETS_DIR="${ASSETS_DIR:-$REPO_ROOT/assets}"
SQL_DIR="$SCRIPT_DIR/sql"

# psql inside the container, failing fast on any SQL error.
psql_c() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" "$@"; }

require_container() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "ERROR: container '$CONTAINER' is not running. Start it with:" >&2
    echo "  docker compose -f infra/local/docker-compose.yml up -d" >&2
    exit 1
  fi
}

# Ensure PostGIS is enabled (idempotent; the image enables it on first init, but a DB
# created another way might not have it).
ensure_postgis() {
  psql_c -c "CREATE EXTENSION IF NOT EXISTS postgis;" >/dev/null
}

import_doorplate() {
  local csv="$ASSETS_DIR/新北市門牌位置數值資料.csv"
  [ -f "$csv" ] || { echo "SKIP doorplate: not found at $csv" >&2; return; }
  echo ">> doorplate: creating table"
  psql_c < "$SQL_DIR/10-doorplate.sql"

  echo ">> doorplate: \\copy loading CSV (~192MB, ~1.99M rows — this takes a bit)"
  # Load only the non-geometry columns; the file has a header row. The CSV column order
  # matches the table's first 11 columns (geom is populated afterwards).
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" -c \
    "\copy doorplate (countycode,areacode,village,neighbor,street_road_section,area,lane,alley,number,x_3826,y_3826) FROM STDIN WITH (FORMAT csv, HEADER true)" \
    < "$csv"

  echo ">> doorplate: building 4326 geometry + GiST index"
  psql_c < "$SQL_DIR/11-doorplate-finalize.sql"
  echo ">> doorplate: done"
}

# Load one GeoJSON file into table <table> with a jsonb props column + geom(srid).
# $1 = source file, $2 = target table, $3 = srid (default 4326)
import_geojson_file() {
  local file="$1" table="$2" srid="${3:-4326}"
  [ -f "$file" ] || { echo "SKIP $table: not found at $file" >&2; return; }
  echo ">> $table: loading GeoJSON (srid=$srid)"

  # Staging table with raw text columns, plus the final typed table.
  psql_c <<SQL
DROP TABLE IF EXISTS ${table}_staging;
CREATE TABLE ${table}_staging (props text, geom_json text);
SQL

  node "$SCRIPT_DIR/load-geojson.mjs" "$file" --srid="$srid" \
    | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" -c \
        "\copy ${table}_staging (props, geom_json) FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', QUOTE '\"')"

  psql_c <<SQL
DROP TABLE IF EXISTS ${table};
CREATE TABLE ${table} (
  id    bigserial PRIMARY KEY,
  props jsonb,
  geom  geometry(Geometry, ${srid})
);
INSERT INTO ${table} (props, geom)
SELECT props::jsonb,
       ST_SetSRID(ST_GeomFromGeoJSON(geom_json), ${srid})
FROM ${table}_staging;
DROP TABLE ${table}_staging;
CREATE INDEX IF NOT EXISTS ${table}_geom_gix ON ${table} USING GIST (geom);
ANALYZE ${table};
SQL
  echo ">> $table: done"
}

import_transport() {
  # All these GeoJSON files' geometries are already WGS84 (4326) — the SHP->GeoJSON
  # conversion reprojected them; the stray "EPSGCode: EPSG:3826" property is just a
  # leftover attribute, not the actual geometry SRID.
  import_geojson_file "$ASSETS_DIR/高鐵路線.json"     hsr_lines        4326
  import_geojson_file "$ASSETS_DIR/高鐵站位資訊.json"  hsr_stations     4326
  import_geojson_file "$ASSETS_DIR/捷運路線.json"     metro_lines      4326
  import_geojson_file "$ASSETS_DIR/捷運站位資訊.json"  metro_stations   4326
  import_geojson_file "$ASSETS_DIR/輕軌路線.json"     lrt_lines        4326
  import_geojson_file "$ASSETS_DIR/鐵路路線.json"     rail_lines       4326
  import_geojson_file "$ASSETS_DIR/國道路線.json"     freeway_lines    4326
}

import_busstops() {
  local file="$ASSETS_DIR/公車站位資訊.json"
  [ -f "$file" ] || { echo "SKIP busstops: not found at $file" >&2; return; }
  echo ">> bus_stops: loading JSON array (lon/lat -> 4326 points)"

  psql_c <<SQL
DROP TABLE IF EXISTS bus_stops_staging;
CREATE TABLE bus_stops_staging (props text, lon double precision, lat double precision);
SQL

  node "$SCRIPT_DIR/load-busstops.mjs" "$file" \
    | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" -c \
        "\copy bus_stops_staging (props, lon, lat) FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', QUOTE '\"')"

  psql_c <<SQL
DROP TABLE IF EXISTS bus_stops;
CREATE TABLE bus_stops (
  id    bigserial PRIMARY KEY,
  props jsonb,
  geom  geometry(Point, 4326)
);
INSERT INTO bus_stops (props, geom)
SELECT props::jsonb, ST_SetSRID(ST_MakePoint(lon, lat), 4326)
FROM bus_stops_staging;
DROP TABLE bus_stops_staging;
CREATE INDEX IF NOT EXISTS bus_stops_geom_gix ON bus_stops USING GIST (geom);
ANALYZE bus_stops;
SQL
  echo ">> bus_stops: done"
}

# OSM POIs (新北市) into the unified `pois` table. The GeoJSON is produced separately by
# fetch-osm.mjs (Overpass) and committed to assets/osm/; this only loads it. Reuses
# load-geojson.mjs to stream props+geom as TSV into a staging table, then 20-pois.sql
# splits out the `category` column and builds the typed, indexed table.
#
# The 高公局 interchange CSVs (assets/交流道/) are staged into the SAME table in the same
# run, as another batch of category='motorway_junction' rows tagged source='freeway-bureau'.
# They are NOT a separate target on purpose: 20-pois.sql starts with `DROP TABLE pois`, so
# a standalone target would be silently wiped by the next `import.sh pois`. Merging the two
# interchange sources happens at the end of 20-pois.sql, once both are staged.
import_pois() {
  local file="${OSM_POIS_FILE:-$REPO_ROOT/assets/osm/ntpc-pois.geojson}"
  if [ ! -f "$file" ]; then
    echo "SKIP pois: not found at $file" >&2
    echo "     generate it first: node $SCRIPT_DIR/fetch-osm.mjs" >&2
    return
  fi
  echo ">> pois: staging OSM POI GeoJSON"
  psql_c <<SQL
DROP TABLE IF EXISTS pois_staging;
CREATE TABLE pois_staging (props text, geom_json text);
SQL

  node "$SCRIPT_DIR/load-geojson.mjs" "$file" --srid=4326 \
    | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" -c \
        "\copy pois_staging (props, geom_json) FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', QUOTE '\"')"

  # 交流道 (高公局): Big5 CSV -> GeoJSON -> the same staging table. Regenerated on every
  # run since the conversion is instant (207 rows) and keeps the output in step with the
  # source CSVs.
  local ic_src="${INTERCHANGE_DIR:-$ASSETS_DIR/交流道}"
  local ic_geojson="${INTERCHANGE_GEOJSON:-$REPO_ROOT/assets/osm/interchanges.geojson}"
  if [ -d "$ic_src" ]; then
    echo ">> pois: converting 交流道 CSV -> GeoJSON"
    node "$REPO_ROOT/infra/scripts/interchange-to-geojson.mjs" --src="$ic_src" --out="$ic_geojson"
    echo ">> pois: staging 交流道 GeoJSON"
    node "$SCRIPT_DIR/load-geojson.mjs" "$ic_geojson" --srid=4326 \
      | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" -c \
          "\copy pois_staging (props, geom_json) FROM STDIN WITH (FORMAT csv, DELIMITER E'\t', QUOTE '\"')"
  else
    echo "SKIP 交流道: not found at $ic_src (pois will keep OSM-only interchanges)" >&2
  fi

  echo ">> pois: building typed table + indexes"
  psql_c < "$SQL_DIR/20-pois.sql"

  # 交流道 去重/合併。獨立一檔是因為 seed-cloud.mjs 也會照樣重播同一份 SQL,本機跟雲端
  # 才不會走出兩套規則。
  echo ">> pois: merging 交流道 (高公局 CSV + OSM)"
  psql_c < "$SQL_DIR/21-interchange-merge.sql"

  # 驗收:交流道兩個來源各幾筆、有無同名重複。
  psql_c -c "SELECT
      COALESCE(props->>'source', 'osm') AS source,
      count(*)                          AS rows,
      count(DISTINCT name)              AS distinct_names
    FROM pois WHERE category = 'motorway_junction'
    GROUP BY 1 ORDER BY 1;"
  echo ">> pois: done"
}

# 地籍段層 + 宗地層(land_section / land_parcel)。來源是 assets/新北市公有土地資料供應/
# 的 1,318 個 KML(212MB,不進 repo)+ 段代碼對照表,由 infra/scripts/kml-to-csv.mjs 先轉成
# 兩份 CSV,再比照 doorplate 走 staging -> finalize。刻意不列入 `all`:來源檔不在 repo,
# 跟 landtx 同理,要灌請明確指定 target。
import_landparcel() {
  local kml_dir="${KML_DIR:-$ASSETS_DIR/新北市公有土地資料供應}"
  local out_dir="${LAND_PARCEL_OUT:-$REPO_ROOT/infra/tmp/land-parcel}"
  local parcels="$out_dir/parcels.csv"
  local sections="$out_dir/sections.csv"

  # CSV 不在就現轉(~1 分鐘);已經有就直接用,要重轉就先把 out_dir 砍掉。
  if [ ! -f "$parcels" ] || [ ! -f "$sections" ]; then
    if [ ! -d "$kml_dir" ]; then
      echo "SKIP landparcel: KML 來源不存在 $kml_dir" >&2
      echo "     (assets/新北市公有土地資料供應/ 是 212MB 來源,沒進 repo,需另外取得)" >&2
      return
    fi
    echo ">> land_parcel: converting KML -> CSV (1,318 檔,約 1 分鐘)"
    node "$REPO_ROOT/infra/scripts/kml-to-csv.mjs"
  else
    echo ">> land_parcel: reusing existing CSV at $out_dir"
  fi

  echo ">> land_parcel: creating tables + staging"
  psql_c < "$SQL_DIR/40-land-parcel.sql"

  echo ">> land_parcel: \\copy loading parcels.csv (~22.8 萬列)"
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" -c \
    "\copy land_parcel_staging (sectno,parcelno,master_no,sub_no,district,section,wkt) FROM STDIN WITH (FORMAT csv, HEADER true)" \
    < "$parcels"

  echo ">> land_section: \\copy loading sections.csv (1,874 列)"
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" -c \
    "\copy land_section (county,district,sectno,section,district_source) FROM STDIN WITH (FORMAT csv, HEADER true)" \
    < "$sections"

  echo ">> land_parcel: building geometry + indexes + 段中心點聚合"
  psql_c < "$SQL_DIR/41-land-parcel-finalize.sql"

  # 驗收(plan §8):宗地列數 / 段列數 / 有幾何的段數 / 無效幾何數。
  psql_c -c "SELECT
      (SELECT count(*) FROM land_parcel)                          AS parcels,
      (SELECT count(*) FROM land_section)                         AS sections,
      (SELECT count(*) FROM land_section WHERE has_geometry)      AS sections_with_geom,
      (SELECT count(*) FROM land_section WHERE section IS NULL)   AS sections_without_name,
      (SELECT count(*) FROM land_parcel WHERE NOT ST_IsValid(geom)) AS invalid_geom;"
  echo ">> land_parcel: done"
}

main() {
  require_container
  ensure_postgis
  local target="${1:-all}"
  case "$target" in
    doorplate)  import_doorplate ;;
    transport)  import_transport ;;
    busstops)   import_busstops ;;
    pois)       import_pois ;;
    landparcel) import_landparcel ;;
    all)        import_transport; import_busstops; import_doorplate; import_pois ;;
    *) echo "Unknown target: $target (use: doorplate | transport | busstops | pois | landparcel | all)" >&2; exit 1 ;;
  esac
  echo "Import target '$target' complete."
}

main "$@"
