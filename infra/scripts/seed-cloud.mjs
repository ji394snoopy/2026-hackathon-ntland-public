#!/usr/bin/env node
// One-shot seeding of the small tables into the *cloud* Aurora PostGIS, over the RDS
// Data API (no VPC, no psql, no \copy). This is the cloud counterpart to the local
// infra/local/import/import.sh — same table shapes, same SRID (4326), same geom
// construction — but every statement goes through rds-data instead of `docker exec psql`.
//
// WHAT THIS SEEDS (all the "small" tables — hundreds to a few thousand rows each):
//   transport GeoJSON layers:
//     hsr_lines, hsr_stations, metro_lines, metro_stations, lrt_lines, rail_lines,
//     freeway_lines   -> table (id, props jsonb, geom geometry(Geometry,4326))
//   bus_stops (公車站位資訊.json, lon/lat) -> (id, props jsonb, geom geometry(Point,4326))
//   pois (assets/osm/ntpc-pois.geojson + assets/osm/interchanges.geojson)
//                                          -> (id, category, name, props, geom Point 4326)
//     …then replays infra/local/import/sql/21-interchange-merge.sql so the 交流道 rows are
//     de-duplicated by the SAME rules as the local import (one shared SQL file, no port).
//
// PLUS a target-only table (NOT in `all`, run it explicitly):
//   landtx -> land_transaction (實價登錄買賣案件 ~5.7万 rows,
//     assets/不動產實價登錄資訊-買賣案件.csv). Non-spatial; derives segment/lid from rps02
//     and 民國->西元 date from rps07/rps14. Kept out of `all` because its source file must
//     be downloaded separately — see README 步驟 2d.
//
// WHAT THIS DOES *NOT* SEED (百万列级,走 S3 import 而非 Data API — see README):
//   doorplate (~2M rows) — README 步驟 2b.
//   land_official_value (公告地价, 每年约百万列) — README 步驟 2c.
//   Data API has no \copy and a per-statement size cap; `all` intentionally skips these.
//
// WHY BatchExecuteStatement: each table is small, so we build ONE parameterized INSERT
// per table and send rows in batches (default 500) of parameter-sets. Server-side the
// SQL is parsed once and reused, and geom is built in-DB with ST_GeomFromGeoJSON /
// ST_MakePoint from a GeoJSON/coord string parameter — identical to the local finalize
// SQL, so results match the local DB.
//
// USAGE:
//   node infra/scripts/seed-cloud.mjs [target] [flags]
//     target: transport | busstops | pois | landtx | all   (default: all)
//   Required (env or flag), normally taken from the CDK stack outputs:
//     --cluster-arn / DB_CLUSTER_ARN   Aurora cluster ARN
//     --secret-arn  / DB_SECRET_ARN    Secrets Manager ARN (DB credentials)
//   Optional:
//     --database    / DB_NAME          default "gis"
//     --profile     / AWS_PROFILE      named AWS profile (else default credential chain)
//     --region      / AWS_REGION       default from the AWS SDK chain
//     --batch-size  / SEED_BATCH_SIZE  default 500
//     --assets-dir  / ASSETS_DIR       default <repo>/assets
//     --dry-run                        parse + count rows, send no writes
//
// AUTH: uses the default AWS credential chain (env / profile / SSO), same as the CDK
// CLI. Make sure `aws sts get-caller-identity` points at the right account first.

import {
    BatchExecuteStatementCommand,
    ExecuteStatementCommand,
    RDSDataClient,
} from "@aws-sdk/client-rds-data";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");

// ---- CLI / env parsing -----------------------------------------------------------

// Accepts both `--flag=value` and `--flag value` forms. A `--flag` with no `=` consumes
// the next arg as its value *unless* that arg is itself a `--flag` (or absent), in which
// case it's treated as a boolean switch (e.g. --dry-run).
function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++; // consume the value
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

const { flags, positionals } = parseArgs(process.argv.slice(2));

const target = positionals[0] ?? "all";
const clusterArn = flags["cluster-arn"] ?? process.env.DB_CLUSTER_ARN;
const secretArn = flags["secret-arn"] ?? process.env.DB_SECRET_ARN;
const database = flags["database"] ?? process.env.DB_NAME ?? "gis";
const region = flags["region"] ?? process.env.AWS_REGION;
const profile = flags["profile"] ?? process.env.AWS_PROFILE;
const batchSize = Number(flags["batch-size"] ?? process.env.SEED_BATCH_SIZE ?? 500);
const assetsDir = flags["assets-dir"] ?? process.env.ASSETS_DIR ?? path.join(REPO_ROOT, "assets");
const dryRun = Boolean(flags["dry-run"]);

const VALID_TARGETS = ["transport", "busstops", "pois", "landtx", "all"];
if (!VALID_TARGETS.includes(target)) {
  fail(`Unknown target "${target}". Use one of: ${VALID_TARGETS.join(" | ")}`);
}
if (!dryRun && (!clusterArn || !secretArn)) {
  fail(
    "Missing --cluster-arn / --secret-arn (or DB_CLUSTER_ARN / DB_SECRET_ARN env).\n" +
      "Get them from the CDK stack outputs (NtlandDatabaseStack: ClusterArn / SecretArn).\n" +
      "Tip: run with --dry-run to validate the source files without any AWS calls.",
  );
}

// Select the AWS profile via the default credential chain: setting AWS_PROFILE before the
// client is constructed makes the SDK resolve credentials from that named profile in
// ~/.aws/credentials|config (SSO / static keys / assume-role all work). Done this way we
// avoid pulling in @aws-sdk/credential-providers just to pass a profile.
if (profile) process.env.AWS_PROFILE = profile;

const client = dryRun ? null : new RDSDataClient(region ? { region } : {});

// ---- Data API helpers ------------------------------------------------------------

async function exec(sql) {
  if (dryRun) return;
  await client.send(
    new ExecuteStatementCommand({ resourceArn: clusterArn, secretArn, database, sql }),
  );
}

// Replays a .sql file from infra/local/import/sql/ statement-by-statement, so the cloud DB
// applies the exact same rules as the local one instead of a hand-ported copy. The Data API
// executes ONE statement per call, so the file is split on `;` after stripping `--` comment
// lines — which is only safe because these files keep every statement terminated and never
// put a semicolon inside a string literal. Say so in any file you add here.
async function execSqlFile(label, relPath) {
  const file = path.join(REPO_ROOT, "infra", "local", "import", "sql", relPath);
  const raw = readFileSync(file, "utf8");
  const stripped = raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  console.log(`   ${label}: replaying ${relPath} (${statements.length} statement(s))`);
  if (dryRun) {
    console.log(`   ${label}: [dry-run] would run ${statements.length} statement(s)`);
    return;
  }
  for (const statement of statements) await exec(`${statement};`);
}

// Send one parameterized INSERT with many parameter-sets, in batches. Each parameter set
// is an array of { name, value } Data API params.
async function batchInsert(label, sql, parameterSets) {
  if (parameterSets.length === 0) {
    console.log(`   ${label}: no rows to insert`);
    return;
  }
  if (dryRun) {
    console.log(`   ${label}: [dry-run] would insert ${parameterSets.length} row(s)`);
    return;
  }
  let done = 0;
  for (let i = 0; i < parameterSets.length; i += batchSize) {
    const chunk = parameterSets.slice(i, i + batchSize);
    await client.send(
      new BatchExecuteStatementCommand({
        resourceArn: clusterArn,
        secretArn,
        database,
        sql,
        parameterSets: chunk,
      }),
    );
    done += chunk.length;
    console.log(`   ${label}: inserted ${done}/${parameterSets.length}`);
  }
}

// Data API typed-parameter builders.
const strParam = (name, value) => ({ name, value: { stringValue: value } });
const nullableStrParam = (name, value) =>
  value === null || value === undefined
    ? { name, value: { isNull: true } }
    : { name, value: { stringValue: String(value) } };
const numParam = (name, value) => ({ name, value: { doubleValue: value } });
// numeric/integer that may be null (empty string / non-finite -> SQL NULL). Numbers are
// sent as doubleValue; the target column type (numeric/integer) does the final coercion.
const nullableNumParam = (name, value) => {
  const n = value === null || value === undefined || value === "" ? null : Number(value);
  return n === null || !Number.isFinite(n)
    ? { name, value: { isNull: true } }
    : { name, value: { doubleValue: n } };
};

// ---- source-file readers (mirror the local loaders) ------------------------------

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas/newlines, and
// doubled "" escapes. Returns an array of row objects keyed by the header row. Enough for
// the government 實價登錄 export (UTF-8, comma-delimited, single header row).
function readCsv(file) {
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/, ""); // strip BOM if present
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++; // CRLF
      record.push(field); field = "";
      // skip fully-empty trailing line
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length > 0) { record.push(field); rows.push(record); }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = r[j] ?? "";
    return obj;
  });
}

// GeoJSON FeatureCollection (or bare array) -> [{ props, geometry }] with a geometry.
function readFeatures(file) {
  const json = readJson(file);
  const features = Array.isArray(json) ? json : (json.features ?? []);
  const rows = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue; // featureless rows handled elsewhere (bus stops)
    rows.push({ props: feature.properties ?? {}, geometry });
  }
  return rows;
}

// ---- table definitions -----------------------------------------------------------

// Generic GeoJSON layer -> (props jsonb, geom geometry(Geometry,4326)). Matches
// import.sh's import_geojson_file: id bigserial, props jsonb, geom built with
// ST_SetSRID(ST_GeomFromGeoJSON(...),4326), GiST index on geom.
const GEOJSON_LAYERS = [
  { table: "hsr_lines", file: "高鐵路線.json" },
  { table: "hsr_stations", file: "高鐵站位資訊.json" },
  { table: "metro_lines", file: "捷運路線.json" },
  { table: "metro_stations", file: "捷運站位資訊.json" },
  { table: "lrt_lines", file: "輕軌路線.json" },
  { table: "rail_lines", file: "鐵路路線.json" },
  { table: "freeway_lines", file: "國道路線.json" },
];

async function seedGeojsonLayer({ table, file }) {
  const src = path.join(assetsDir, file);
  console.log(`>> ${table}: reading ${file}`);
  const rows = readFeatures(src);
  console.log(`   ${table}: ${rows.length} feature(s)`);

  // Create the typed table + index (idempotent-ish: drop & recreate so re-runs are clean,
  // same as the local finalize which DROPs then CREATEs).
  await exec(`DROP TABLE IF EXISTS ${table};`);
  await exec(
    `CREATE TABLE ${table} (` +
      `id bigserial PRIMARY KEY, props jsonb, geom geometry(Geometry, 4326));`,
  );

  const insertSql =
    `INSERT INTO ${table} (props, geom) ` +
    `VALUES (CAST(:props AS jsonb), ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326));`;
  const parameterSets = rows.map((r) => [
    strParam("props", JSON.stringify(r.props)),
    strParam("geom", JSON.stringify(r.geometry)),
  ]);
  await batchInsert(table, insertSql, parameterSets);

  await exec(`CREATE INDEX IF NOT EXISTS ${table}_geom_gix ON ${table} USING GIST (geom);`);
  await exec(`ANALYZE ${table};`);
  console.log(`>> ${table}: done`);
}

// bus_stops: plain JSON array with longitude/latitude strings (WGS84). Matches
// import.sh's import_busstops: props jsonb, geom = ST_SetSRID(ST_MakePoint(lon,lat),4326).
async function seedBusStops() {
  const table = "bus_stops";
  const src = path.join(assetsDir, "公車站位資訊.json");
  console.log(`>> ${table}: reading 公車站位資訊.json`);
  const items = readJson(src);
  if (!Array.isArray(items)) fail("公車站位資訊.json: expected a JSON array");

  const rows = [];
  let skipped = 0;
  for (const item of items) {
    const lon = Number(item.longitude);
    const lat = Number(item.latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      skipped++;
      continue;
    }
    rows.push({ props: item, lon, lat });
  }
  console.log(`   ${table}: ${rows.length} stop(s), skipped ${skipped} without coords`);

  await exec(`DROP TABLE IF EXISTS ${table};`);
  await exec(
    `CREATE TABLE ${table} (` +
      `id bigserial PRIMARY KEY, props jsonb, geom geometry(Point, 4326));`,
  );

  const insertSql =
    `INSERT INTO ${table} (props, geom) ` +
    `VALUES (CAST(:props AS jsonb), ST_SetSRID(ST_MakePoint(:lon, :lat), 4326));`;
  const parameterSets = rows.map((r) => [
    strParam("props", JSON.stringify(r.props)),
    numParam("lon", r.lon),
    numParam("lat", r.lat),
  ]);
  await batchInsert(table, insertSql, parameterSets);

  await exec(`CREATE INDEX IF NOT EXISTS ${table}_geom_gix ON ${table} USING GIST (geom);`);
  await exec(`ANALYZE ${table};`);
  console.log(`>> ${table}: done`);
}

// pois: OSM POIs with a `category` column. Matches 20-pois.sql: the GeoJSON props carry
// `category`, `name`, and the raw OSM tags; features without a category are skipped, and
// we de-dup on (osm_type, osm_id) in JS (the local version does DISTINCT ON in SQL).
//
// Two GeoJSON inputs, exactly as import_pois() in import.sh stages them: the OSM snapshot
// plus the 高公局 interchange CSVs converted by infra/scripts/interchange-to-geojson.mjs.
// Both land in the same table as category='motorway_junction'; 21-interchange-merge.sql
// (replayed at the end) de-duplicates them. Regenerate interchanges.geojson first if it is
// missing — it is gitignored like every other asset.
async function seedPois() {
  const table = "pois";
  const src = path.join(assetsDir, "osm", "ntpc-pois.geojson");
  console.log(`>> ${table}: reading osm/ntpc-pois.geojson`);
  const features = readFeatures(src);

  const interchangeSrc = path.join(assetsDir, "osm", "interchanges.geojson");
  if (existsSync(interchangeSrc)) {
    const ic = readFeatures(interchangeSrc);
    console.log(`   ${table}: + osm/interchanges.geojson (${ic.length} 交流道)`);
    features.push(...ic);
  } else {
    console.log(
      `!! ${table}: osm/interchanges.geojson not found — 交流道 will be OSM-only.\n` +
        `   generate it with: node infra/scripts/interchange-to-geojson.mjs`,
    );
  }

  const seen = new Set();
  const rows = [];
  let noCategory = 0;
  let deduped = 0;
  for (const f of features) {
    const props = f.props ?? {};
    const category = props.category;
    if (category === undefined || category === null || category === "") {
      noCategory++;
      continue;
    }
    const key = `${props.osm_type ?? ""}:${props.osm_id ?? `row-${rows.length}`}`;
    if (seen.has(key)) {
      deduped++;
      continue;
    }
    seen.add(key);
    const name = props.name === undefined || props.name === "" ? null : props.name;
    rows.push({ category, name, props, geometry: f.geometry });
  }
  console.log(
    `   ${table}: ${rows.length} poi(s) (skipped ${noCategory} w/o category, ${deduped} dup)`,
  );

  await exec(`DROP TABLE IF EXISTS ${table};`);
  await exec(
    `CREATE TABLE ${table} (` +
      `id bigserial PRIMARY KEY, category text NOT NULL, name text, ` +
      `props jsonb, geom geometry(Point, 4326));`,
  );

  const insertSql =
    `INSERT INTO ${table} (category, name, props, geom) ` +
    `VALUES (:category, :name, CAST(:props AS jsonb), ` +
    `ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326));`;
  const parameterSets = rows.map((r) => [
    strParam("category", String(r.category)),
    nullableStrParam("name", r.name),
    strParam("props", JSON.stringify(r.props)),
    strParam("geom", JSON.stringify(r.geometry)),
  ]);
  await batchInsert(table, insertSql, parameterSets);

  await exec(`CREATE INDEX IF NOT EXISTS ${table}_geom_gix ON ${table} USING GIST (geom);`);
  await exec(`CREATE INDEX IF NOT EXISTS ${table}_category_idx ON ${table} (category);`);
  await exec(`ANALYZE ${table};`);

  // Same merge rules as the local import — replayed from the one shared SQL file.
  await execSqlFile(table, "21-interchange-merge.sql");
  console.log(`>> ${table}: done`);
}

// land_transaction: 實價登錄土地/房地/車位交易 (全市 ~5.7 萬列). Non-spatial table
// (queried by 段/地號, not geometry) — see infra/lambda/shared/db/schema.ts. Source is the
// government 買賣案件 CSV (UTF-8, comma-delimited, single header row of rps* column names).
//
// CSV 表頭欄名(來源 → 本表欄):
//   district                      -> district        鄉鎮市區
//   rps01                         -> rps01            交易標的(土地/房地/車位)
//   rps02                         -> rps02 (+衍生 segment/lid)  土地區段位置建物區段門牌
//   rps03_area                    -> rps03_area       土地移轉總面積(㎡)
//   rps04/rps05/rps06             -> rps04/05/06      都市/非都市分區、非都市編定
//   rps07_yyymmddroc              -> rps07 (+衍生 trade_date)   交易年月日(民國)
//   rps08                         -> rps08            交易筆棟數
//   rps09/rps10/rps11/rps12/rps13 -> rps09..rps13     移轉層次/總樓層/型態/用途/建材
//   rps14_yyymmddroc              -> rps14 (+衍生 build_date)   建築完成年月(民國)
//   rps15_area                    -> rps15_area       建物移轉總面積(㎡)
//   rps16_quantity..rps18_quantity-> rps16..rps18     格局 房/廳/衛
//   rps19/rps20                   -> rps19/rps20      隔間/管理組織
//   rps21_amountsunitdollars      -> rps21_amount     總價(元)
//   rps22_amountsunitdollars      -> rps22_unit       單價(元/㎡)
//   rps23                         -> rps23            車位類別
//   rps24_area                    -> rps24_area       車位移轉總面積(㎡)
//   rps25_amountsunitdollars      -> rps25_amount     車位總價(元)
//   rps26                         -> rps26            備註
//   rps27                         -> id               編號(主鍵)
//   rps28_area/rps29_area/rps30_area -> rps28/29/30_area  主建物/附屬建物/陽台面積(㎡)
//   rps31                         -> rps31            電梯(有/無)
//   rps32                         -> rps32            移轉編號
//
// 衍生欄:segment/lid 由 rps02 解析(房地/車位為門牌地址 → null);trade_date/build_date
// 由 rps07/rps14 民國 YYYMMDD 轉西元 date(原始字串保留在 rps07/rps14)。主鍵 id = rps27。
const LAND_TX_SRC = "不動產實價登錄資訊-買賣案件.csv";

// 民國 YYYMMDD(如 "1110301" = 民國111/03/01)-> 西元 "YYYY-MM-DD"。長度不足 6~7 碼、
// 非數字、月日為 00 一律回 null(保留原始字串在 rps 欄)。
function rocToIso(roc) {
  if (roc === null || roc === undefined) return null;
  const s = String(roc).trim();
  if (!/^\d{6,7}$/.test(s)) return null;
  const md = s.slice(-4);
  const yy = Number(s.slice(0, s.length - 4));
  const mm = Number(md.slice(0, 2));
  const dd = Number(md.slice(2, 4));
  if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = yy + 1911;
  // 政府資料常有「月底補 31」或無效日(如 6/31、2/30)這類髒資料 → Postgres date 會拒絕
  // 整批匯入。用 UTC Date 實際驗證該日是否存在(回讀年月日一致才合法),否則回 null。
  const dt = new Date(Date.UTC(year, mm - 1, dd));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== mm - 1 ||
    dt.getUTCDate() !== dd
  ) {
    return null;
  }
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// rps02 交易標的 -> { segment, lid }。土地類形如「北峰段1009地號」、
// 「四腳亭段楓子瀨小段19地號」、「更寮段更寮小段2-17地號」、「公正段208-4地號」。
// 房地/車位是門牌地址(無「段…地號」)→ 回 { segment:null, lid:null }。
function parseParcel(rps02) {
  if (typeof rps02 !== "string") return { segment: null, lid: null };
  // 抓「…段(可含 …小段)+ 地號數字(可含 -分號)」。段名允許中文/數字。
  const m = rps02.match(/^(.*?段(?:.*?小段)?)(\d+(?:-\d+)?)地號$/);
  if (!m) return { segment: null, lid: null };
  return { segment: m[1], lid: m[2] };
}

async function seedLandTransaction() {
  const table = "land_transaction";
  const src = path.join(assetsDir, LAND_TX_SRC);
  console.log(`>> ${table}: reading ${LAND_TX_SRC}`);
  const items = readCsv(src);
  if (!Array.isArray(items) || items.length === 0) {
    fail(`${LAND_TX_SRC}: no rows parsed (expected a CSV with a header row)`);
  }

  // 空字串在 CSV 代表 null;統一轉。
  const s = (v) => (v === undefined || v === null || v === "" ? null : String(v));

  const rows = [];
  let skipped = 0;
  let parsedParcel = 0;
  for (const it of items) {
    const id = s(it.rps27);
    if (id === null) {
      skipped++; // 無編號(主鍵)→ 跳過
      continue;
    }
    const { segment, lid } = parseParcel(it.rps02);
    if (segment) parsedParcel++;
    rows.push({
      id,
      district: s(it.district),
      segment,
      lid,
      tradeDate: rocToIso(it.rps07_yyymmddroc),
      buildDate: rocToIso(it.rps14_yyymmddroc),
      rps01: s(it.rps01),
      rps02: s(it.rps02),
      rps03_area: it.rps03_area,
      rps04: s(it.rps04),
      rps05: s(it.rps05),
      rps06: s(it.rps06),
      rps07: s(it.rps07_yyymmddroc),
      rps08: s(it.rps08),
      rps09: s(it.rps09),
      rps10: s(it.rps10),
      rps11: s(it.rps11),
      rps12: s(it.rps12),
      rps13: s(it.rps13),
      rps14: s(it.rps14_yyymmddroc),
      rps15_area: it.rps15_area,
      rps16_quantity: it.rps16_quantity,
      rps17_quantity: it.rps17_quantity,
      rps18_quantity: it.rps18_quantity,
      rps19: s(it.rps19),
      rps20: s(it.rps20),
      rps21_amount: it.rps21_amountsunitdollars,
      rps22_unit: it.rps22_amountsunitdollars,
      rps23: s(it.rps23),
      rps24_area: it.rps24_area,
      rps25_amount: it.rps25_amountsunitdollars,
      rps26: s(it.rps26),
      rps28_area: it.rps28_area,
      rps29_area: it.rps29_area,
      rps30_area: it.rps30_area,
      rps31: s(it.rps31),
      rps32: s(it.rps32),
    });
  }
  console.log(
    `   ${table}: ${rows.length} row(s), skipped ${skipped} without rps27, ` +
      `${parsedParcel} parsed a 段/地號 from rps02`,
  );

  // Drizzle schema 是真相,但 seed-cloud 慣例是自帶 DDL(drop & recreate,re-run 乾淨)。
  await exec(`DROP TABLE IF EXISTS ${table};`);
  await exec(
    `CREATE TABLE ${table} (` +
      `id text PRIMARY KEY, district text, segment text, lid text, ` +
      `trade_date date, build_date date, ` +
      `rps01 text, rps02 text, rps03_area numeric, rps04 text, rps05 text, rps06 text, ` +
      `rps07 text, rps08 text, rps09 text, rps10 text, rps11 text, rps12 text, rps13 text, ` +
      `rps14 text, rps15_area numeric, rps16_quantity integer, rps17_quantity integer, ` +
      `rps18_quantity integer, rps19 text, rps20 text, rps21_amount numeric, rps22_unit numeric, ` +
      `rps23 text, rps24_area numeric, rps25_amount numeric, rps26 text, ` +
      `rps28_area numeric, rps29_area numeric, rps30_area numeric, rps31 text, rps32 text);`,
  );

  const insertSql =
    `INSERT INTO ${table} (` +
    `id, district, segment, lid, trade_date, build_date, ` +
    `rps01, rps02, rps03_area, rps04, rps05, rps06, rps07, rps08, rps09, rps10, rps11, ` +
    `rps12, rps13, rps14, rps15_area, rps16_quantity, rps17_quantity, rps18_quantity, ` +
    `rps19, rps20, rps21_amount, rps22_unit, rps23, rps24_area, rps25_amount, rps26, ` +
    `rps28_area, rps29_area, rps30_area, rps31, rps32` +
    `) VALUES (` +
    `:id, :district, :segment, :lid, ` +
    `CAST(:trade_date AS date), CAST(:build_date AS date), ` +
    `:rps01, :rps02, :rps03_area, :rps04, :rps05, :rps06, :rps07, :rps08, :rps09, :rps10, ` +
    `:rps11, :rps12, :rps13, :rps14, :rps15_area, :rps16_quantity, :rps17_quantity, ` +
    `:rps18_quantity, :rps19, :rps20, :rps21_amount, :rps22_unit, :rps23, :rps24_area, ` +
    `:rps25_amount, :rps26, :rps28_area, :rps29_area, :rps30_area, :rps31, :rps32` +
    `) ON CONFLICT (id) DO NOTHING;`;

  const parameterSets = rows.map((r) => [
    strParam("id", r.id),
    nullableStrParam("district", r.district),
    nullableStrParam("segment", r.segment),
    nullableStrParam("lid", r.lid),
    nullableStrParam("trade_date", r.tradeDate),
    nullableStrParam("build_date", r.buildDate),
    nullableStrParam("rps01", r.rps01),
    nullableStrParam("rps02", r.rps02),
    nullableNumParam("rps03_area", r.rps03_area),
    nullableStrParam("rps04", r.rps04),
    nullableStrParam("rps05", r.rps05),
    nullableStrParam("rps06", r.rps06),
    nullableStrParam("rps07", r.rps07),
    nullableStrParam("rps08", r.rps08),
    nullableStrParam("rps09", r.rps09),
    nullableStrParam("rps10", r.rps10),
    nullableStrParam("rps11", r.rps11),
    nullableStrParam("rps12", r.rps12),
    nullableStrParam("rps13", r.rps13),
    nullableStrParam("rps14", r.rps14),
    nullableNumParam("rps15_area", r.rps15_area),
    nullableNumParam("rps16_quantity", r.rps16_quantity),
    nullableNumParam("rps17_quantity", r.rps17_quantity),
    nullableNumParam("rps18_quantity", r.rps18_quantity),
    nullableStrParam("rps19", r.rps19),
    nullableStrParam("rps20", r.rps20),
    nullableNumParam("rps21_amount", r.rps21_amount),
    nullableNumParam("rps22_unit", r.rps22_unit),
    nullableStrParam("rps23", r.rps23),
    nullableNumParam("rps24_area", r.rps24_area),
    nullableNumParam("rps25_amount", r.rps25_amount),
    nullableStrParam("rps26", r.rps26),
    nullableNumParam("rps28_area", r.rps28_area),
    nullableNumParam("rps29_area", r.rps29_area),
    nullableNumParam("rps30_area", r.rps30_area),
    nullableStrParam("rps31", r.rps31),
    nullableStrParam("rps32", r.rps32),
  ]);
  await batchInsert(table, insertSql, parameterSets);

  // land-transaction 查詢:district + segment + 交易日期排序;及依交易類別(土地優先/過濾)。
  await exec(
    `CREATE INDEX IF NOT EXISTS land_transaction_lookup_idx ` +
      `ON ${table} (district, segment, trade_date);`,
  );
  await exec(`CREATE INDEX IF NOT EXISTS land_transaction_kind_idx ON ${table} (rps01);`);
  await exec(`ANALYZE ${table};`);
  console.log(`>> ${table}: done`);
}

// ---- main ------------------------------------------------------------------------

async function main() {
  console.log(
    `seed-cloud: target=${target} database=${database} batchSize=${batchSize}` +
      (profile ? ` profile=${profile}` : "") +
      (dryRun ? " [DRY RUN]" : ` cluster=${clusterArn}`),
  );

  // PostGIS must exist before any ST_* / geometry column. Idempotent.
  console.log(">> ensuring PostGIS extension");
  await exec(`CREATE EXTENSION IF NOT EXISTS postgis;`);

  if (target === "transport" || target === "all") {
    for (const layer of GEOJSON_LAYERS) await seedGeojsonLayer(layer);
  }
  if (target === "busstops" || target === "all") {
    await seedBusStops();
  }
  if (target === "pois" || target === "all") {
    await seedPois();
  }
  // landtx 刻意不列入 all:實價登錄來源檔(assets/實價登錄.json)要另外下載,放進 all
  // 會讓沒下載的人跑 all 時失敗。要灌實價登錄請明確指定 `landtx` target。
  if (target === "landtx") {
    await seedLandTransaction();
  }

  console.log(
    `seed-cloud: target '${target}' complete.` +
      (target === "all"
        ? " (doorplate + land_official_value + land_transaction NOT seeded here — landtx 另跑、大表走 S3,見 README)"
        : ""),
  );
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("seed-cloud failed:", err);
  process.exit(1);
});
