#!/usr/bin/env node
// Fetches the OSM-sourced POI categories (公共設施 / 公共建設 / 特殊設施 / 工商活動, the
// transport interchanges, and the 台鐵車站/客運站 the transport GeoJSON layers don't cover)
// for 新北市 from the Overpass API and writes them out as a single GeoJSON
// FeatureCollection whose features each carry a `category` property.
//
// Why Overpass (not osm2pgsql): the host has no osm2pgsql and the whole-Taiwan .pbf is
// hundreds of MB of road geometry we don't need. Overpass lets us pull only the handful
// of tag classes we care about, scoped to the 新北市 admin boundary, so the result is
// small and loads through the existing load-geojson.mjs → PostGIS path with no new tools.
//
// Output shape matches what load-geojson.mjs expects: a FeatureCollection of Point
// features (ways/relations are reduced to their `center`), with properties:
//   { category: <our PoiCategory>, name: <string|null>, osm_id, osm_type, tags: {...} }
//
// Usage:
//   node fetch-osm.mjs                 # -> writes assets/osm/ntpc-pois.geojson
//   node fetch-osm.mjs --out=/path.geojson
//   node fetch-osm.mjs --area="新北市"
//   OVERPASS_URL=https://overpass.kumi.systems/api/interpreter node fetch-osm.mjs
//
// The endpoint is rate-limited; this makes ONE request for all categories.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");

const OVERPASS_URL =
  process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

// Each entry: our category key -> the OSM selectors that map to it. A selector is a
// [key, value] tag match; value `null` means "any value for this key" (key existence).
// These mirror the 對照表 (設施查詢對照表.md). NLSC-covered categories (殯葬/加油站/
// 醫療/文教) are intentionally NOT here — those come from the NLSC buffer API, not OSM.
const CATEGORY_SELECTORS = {
  // 3 公共設施
  market: [["amenity", "marketplace"]],
  park: [["leisure", "park"]],
  // 4 公共建設
  tourism: [["tourism", "attraction"]],
  parking: [["amenity", "parking"]],
  wastewater: [["man_made", "wastewater_plant"]],
  // 5 特殊設施 (the ones NLSC does NOT cover — confirmed by live probe)
  substation: [["power", "substation"]],
  power_tower: [["power", "tower"]],
  waste: [
    ["amenity", "waste_transfer_station"],
    ["man_made", "works"], // incinerators are often tagged works + product; kept broad
  ],
  gas_storage: [["man_made", "storage_tank"]],
  // 火葬場 — NLSC 的殯葬(dis)只涵蓋公墓(9350200)/納骨堂(9930203)，不含火葬場，故從 OSM 補。
  crematorium: [["amenity", "crematorium"]],
  // 6 工商活動
  department_store: [
    ["shop", "department_store"],
    ["shop", "mall"],
  ],
  bank: [["amenity", "bank"]],
  entertainment: [
    ["amenity", "cinema"],
    ["amenity", "theatre"],
    ["amenity", "arts_centre"],
  ],
  hotel: [["tourism", "hotel"]],
  // 1 交通 (interchange points not in the transport GeoJSON layers)
  motorway_junction: [["highway", "motorway_junction"]],
  // 台鐵車站 —— 表1「大型車站－火車站」唯一的資料源。assets/ 只有鐵路「路線」圖層
  // (鐵路路線.json)，沒有站位檔，所以走 OSM。捷運/輕軌站在 OSM 同樣是 railway=station，
  // 但那兩類已由 metro_stations 圖層提供，靠 CATEGORY_REJECT 排掉，免得同一站被報兩次。
  railway_station: [
    ["railway", "station"],
    ["railway", "halt"], // 招呼站/簡易站
  ],
  // 客運站/轉運站 —— 表1「大型車站－客運站」的資料源。與 bus_stops(站牌)是不同層級：
  // 站牌是路邊停靠點，這裡是有站體的客運場站。
  bus_station: [["amenity", "bus_station"]],
  // 接近聚落程度 — 村里/市鎮的聚落中心點，用來衡量標的與聚落的接近程度。
  settlement: [
    ["place", "village"],
    ["place", "town"],
  ],
};

// 命中就「不」歸入該類的 tag。OSM 的 railway=station 同時涵蓋台鐵、捷運、輕軌，唯一分得出
// 來的是 station / subway / light_rail 這幾個 tag；捷運與輕軌另有專屬圖層，這裡排掉。
const CATEGORY_REJECT = {
  railway_station: [
    ["station", "subway"],
    ["station", "light_rail"],
    ["subway", "yes"],
    ["light_rail", "yes"],
    ["tram", "yes"],
  ],
};

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Builds the Overpass QL. We resolve the 新北市 boundary once into an `area`, then run
// every selector against nwr (node/way/relation) inside it. `out center tags` gives each
// element a single representative coordinate (nodes keep their own; ways/relations get a
// computed center), which is exactly what we reduce to a Point below.
function buildQuery(areaName) {
  const lines = [];
  lines.push("[out:json][timeout:180];");
  // Match the city admin boundary as an area. 新北市 is admin_level 4 in Taiwan.
  lines.push(`area["name"="${areaName}"]["admin_level"="4"]->.ntpc;`);
  lines.push("(");
  for (const selectors of Object.values(CATEGORY_SELECTORS)) {
    for (const [k, v] of selectors) {
      const sel = v === null ? `["${k}"]` : `["${k}"="${v}"]`;
      lines.push(`  nwr${sel}(area.ntpc);`);
    }
  }
  lines.push(");");
  lines.push("out center tags;");
  return lines.join("\n");
}

function matches(tags, [k, v]) {
  return v === null ? tags[k] !== undefined : tags[k] === v;
}

// Given an OSM element's tags, decide which of OUR categories it belongs to. First match
// wins (selectors are checked in declaration order), unless the category's CATEGORY_REJECT
// rules veto it — then we keep looking at the remaining categories. Returns null if nothing
// matched (an element Overpass returned for railway=station but that is a 捷運/輕軌 station
// lands here, and is dropped).
function classify(tags) {
  if (!tags) return null;
  for (const [category, selectors] of Object.entries(CATEGORY_SELECTORS)) {
    if (!selectors.some((s) => matches(tags, s))) continue;
    if ((CATEGORY_REJECT[category] ?? []).some((s) => matches(tags, s))) continue;
    return category;
  }
  return null;
}

function elementToFeature(el) {
  const lon = el.lon ?? el.center?.lon;
  const lat = el.lat ?? el.center?.lat;
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  const category = classify(el.tags);
  if (!category) return null;
  return {
    type: "Feature",
    properties: {
      category,
      name: el.tags?.name ?? el.tags?.["name:zh"] ?? null,
      osm_id: el.id,
      osm_type: el.type,
      tags: el.tags ?? {},
    },
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const areaName = args.area ?? "新北市";
  const outPath = args.out
    ? resolve(args.out)
    : resolve(REPO_ROOT, "assets/osm/ntpc-pois.geojson");

  const query = buildQuery(areaName);
  console.error(`>> Overpass: querying ${areaName} POIs (${OVERPASS_URL})`);

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // Some Overpass front-ends (Apache) return 406 without a UA / Accept header.
      "user-agent": "ntland-hackathon/1.0 (POI import)",
      accept: "application/json",
    },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Overpass request failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`,
    );
  }
  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  const features = [];
  const counts = {};
  for (const el of elements) {
    const f = elementToFeature(el);
    if (!f) continue;
    features.push(f);
    counts[f.properties.category] = (counts[f.properties.category] ?? 0) + 1;
  }

  const fc = { type: "FeatureCollection", features };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(fc));

  console.error(`>> wrote ${features.length} features -> ${outPath}`);
  console.error(">> per-category counts:");
  for (const [cat, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.error(`     ${cat.padEnd(18)} ${n}`);
  }
  if (features.length === 0) {
    console.error(
      "!! 0 features — check the area name / admin_level, or try a mirror via OVERPASS_URL.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
