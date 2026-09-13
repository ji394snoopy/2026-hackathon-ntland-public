#!/usr/bin/env node
// Converts the 高公局 interchange CSVs (assets/交流道/*.csv) into one GeoJSON
// FeatureCollection that loads through the existing load-geojson.mjs → pois pipeline.
//
// Why this exists: `pois.motorway_junction` was previously OSM-only, and OSM stores
// motorway junctions as *ramp nodes* — one physical interchange becomes several points
// (三重交流道: 5 points spread over 824m; 林口交流道: 3 points spread over 2.7km), mixed
// in with expressway exit ramps (「中興橋出口」) and unnamed nodes. That makes
// "最近交流道 Xm" unreliable. These CSVs are the 高公局's official list: one row per
// interchange, with the 國道 route and its 里程 K.
//
// The CSVs are **Big5** encoded (not UTF-8) with the header 設施名稱,里程K+000,位置座標X,
// 位置座標Y, and the route name comes from the filename (國道1號(平面)_095217.csv).
// Coordinates are already WGS84 lon/lat, matching every other table.
//
// Nationwide (207 rows) is kept on purpose, not just 新北市: a parcel near the city
// border is legitimately closest to a 桃園/基隆/宜蘭 interchange, and clipping the source
// would report "no interchange nearby" instead.
//
// Output properties match what 20-pois.sql reads:
//   { category: "motorway_junction", name, road, km, source: "freeway-bureau",
//     osm_type, osm_id }
// osm_type/osm_id are synthetic ("csv" / "<road>|<name>|<km>") purely so the DISTINCT ON
// de-duplication in 20-pois.sql — which keys on those two columns — keeps one row each.
//
// Usage:
//   node infra/scripts/interchange-to-geojson.mjs           # -> assets/osm/interchanges.geojson
//   node infra/scripts/interchange-to-geojson.mjs --out=/path.geojson
//   node infra/scripts/interchange-to-geojson.mjs --src=/path/to/交流道

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");

// 新北市 and its neighbours, used only for the summary line printed to stderr — every
// row is emitted regardless.
const NTPC_BBOX = { minLon: 121.25, maxLon: 122.05, minLat: 24.65, maxLat: 25.32 };

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// The filename is "<road>_<id>.csv" — 國道1號(平面)_095217.csv -> 國道1號(平面). The
// numeric suffix is the opendata resource id and carries no meaning for us.
function roadFromFilename(filename) {
  return filename.replace(/\.csv$/i, "").replace(/_\d+$/, "");
}

// Splits one CSV line on commas. The source has no quoted fields or embedded commas —
// every row is 設施名稱,里程,X,Y — so a plain split is correct here and avoids pulling in
// a CSV parser for 207 rows.
function splitRow(line) {
  return line.split(",").map((c) => c.trim());
}

function parseFile(path, road) {
  // Big5 -> UTF-8. Node's TextDecoder supports big5 natively, so no iconv dependency.
  const decoder = new TextDecoder("big5");
  const text = decoder.decode(readFileSync(path));
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  // Drop the header row (設施名稱,里程K+000,位置座標X,位置座標Y).
  const rows = lines[0].includes("設施名稱") ? lines.slice(1) : lines;

  const features = [];
  for (const line of rows) {
    const cells = splitRow(line);
    if (cells.length < 4) continue;
    const [name, km, xRaw, yRaw] = cells;
    const lon = Number(xRaw);
    const lat = Number(yRaw);
    // Guard against blank / malformed coordinate cells; 0,0 is never a valid interchange.
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon === 0 || lat === 0) continue;
    features.push({
      type: "Feature",
      properties: {
        category: "motorway_junction",
        name: name || null,
        road,
        // 里程 is NOT always an integer — 國道1號(高架) uses values like "高架13" — so it
        // is kept verbatim as text rather than coerced to a number.
        km: km || null,
        source: "freeway-bureau",
        osm_type: "csv",
        osm_id: `${road}|${name}|${km}`,
      },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }
  return features;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const srcDir = args.src ? resolve(args.src) : resolve(REPO_ROOT, "assets/交流道");
  const outPath = args.out
    ? resolve(args.out)
    : resolve(REPO_ROOT, "assets/osm/interchanges.geojson");

  const files = readdirSync(srcDir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();
  if (files.length === 0) {
    console.error(`!! no CSV files found in ${srcDir}`);
    process.exit(2);
  }

  const features = [];
  const perRoad = [];
  for (const file of files) {
    const road = roadFromFilename(file);
    const rows = parseFile(join(srcDir, file), road);
    features.push(...rows);
    perRoad.push([road, rows.length]);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ type: "FeatureCollection", features }));

  const inNtpc = features.filter((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return (
      lon >= NTPC_BBOX.minLon &&
      lon <= NTPC_BBOX.maxLon &&
      lat >= NTPC_BBOX.minLat &&
      lat <= NTPC_BBOX.maxLat
    );
  }).length;

  console.error(`>> wrote ${features.length} interchange(s) -> ${outPath}`);
  for (const [road, n] of perRoad) console.error(`     ${road.padEnd(16)} ${n}`);
  console.error(`>> ${inNtpc} of them fall in/near the 新北市 bbox`);

  if (features.length === 0) {
    console.error("!! 0 features — check the Big5 decoding / CSV header.");
    process.exit(2);
  }
}

main();
