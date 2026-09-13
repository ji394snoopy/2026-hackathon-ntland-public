#!/usr/bin/env node
// Fixed test suite for the local facilities API.
//
// Invokes the *bundled* handler (infra/build/lambda/facilities/index.mjs) against the
// local Docker PostGIS — exactly what would be deployed — and asserts a set of fixed
// cases pass:
//
//   1. radius mode (板橋車站, GET)      -> 200, has metro/HSR/bus stops + OSM POIs,
//                                          and OSM POIs carry a `category` field.
//   2. radius mode (金山 demo, GET)     -> 200, has some facilities.
//   3. polygon mode (板橋方框, POST)    -> 200, area.kind === "polygon".
//   4. invalid: no area (GET)           -> 400.
//   5. invalid: bad radius (GET)        -> 400.
//   6. per-category radius, widened     -> 特殊設施 reaches 3000m while every other group
//                                          stays inside the 500m base radius.
//   7. per-category radius, narrowed    -> 公車站 capped at 200m returns fewer stops than
//                                          the same query without the override.
//   8. invalid: unknown category (GET)  -> 400.
//   9. invalid: polygon + categories    -> 400.
//  10. the 區域因素 demo profile        -> every alias/group in the string produce-survey
//                                          actually sends resolves to its standard radius.
//
// It prints per-kind counts and the nearest few of each, then a PASS/FAIL summary. Exit
// code is 0 only if every case passes.
//
// Prereqs (see tests/README.md):
//   docker compose -f infra/local/docker-compose.yml up -d
//   infra/local/import/import.sh all         # loads transport / busstops / pois / doorplate
//   cd infra && npm run build:lambdas        # produces the bundle this script imports
//
// Usage (from repo root or anywhere):
//   node tests/run-facilities-tests.mjs
//   PGPORT=5433 PGHOST=127.0.0.1 node tests/run-facilities-tests.mjs
//   NLSC_TIMEOUT_MS=3000 node tests/run-facilities-tests.mjs   # shorter NLSC wait
//
// Notes:
//   - Connects via PG* env vars; defaults below match infra/local/docker-compose.yml
//     (host port 5433). Set PGPORT if your container maps elsewhere.
//   - NLSC live-API hits (殯葬/加油站/醫療/文教) are included by the handler and are
//     network-dependent; the assertions below do NOT require them, so the suite still
//     passes offline (only the DB-backed + OSM POI slice is asserted).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Defaults for the local Docker DB — only set if not already provided by the caller.
process.env.PGHOST ??= "127.0.0.1";
process.env.PGPORT ??= "5433";
process.env.PGUSER ??= "postgres";
process.env.PGPASSWORD ??= "postgres";
process.env.PGDATABASE ??= "gis";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/ sits at repo root; the bundle lives under infra/build/lambda/facilities/.
const bundlePath = resolve(
  __dirname,
  "..",
  "infra",
  "build",
  "lambda",
  "facilities",
  "index.mjs",
);

let handler, closePool;
try {
  ({ handler, closePool } = await import(bundlePath));
} catch (err) {
  console.error(`\n無法載入打包好的 handler:\n  ${bundlePath}\n`);
  console.error("請先在 infra/ 執行 `npm run build:lambdas` 產生 bundle。\n");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ---- tiny assertion helpers ------------------------------------------------

let failures = 0;
const results = [];

function record(caseName, ok, detail) {
  results.push({ caseName, ok, detail });
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${detail}`);
}

function groupByKind(facilities) {
  const byKind = {};
  for (const f of facilities) (byKind[f.kind] ??= []).push(f);
  return byKind;
}

function printBody(body) {
  console.log("  area:", JSON.stringify(body.area));
  const byKind = groupByKind(body.facilities);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`    ${kind}: ${list.length} 筆`);
    for (const f of list.slice(0, 3)) {
      const cat = f.category ? ` [${f.category}]` : "";
      console.log(`      - ${f.name ?? "(無名)"}${cat}  ${f.metersToCenter}m`);
    }
    if (list.length > 3) console.log(`      ... (+${list.length - 3})`);
  }
  if (body.doorplate) {
    console.log(`    門牌: ${body.doorplate.count} 筆 (最近 ${body.doorplate.nearest.length} 筆)`);
    for (const d of body.doorplate.nearest.slice(0, 3)) {
      console.log(`      - ${d.address}  ${d.metersToCenter}m`);
    }
  }
}

async function invoke(event) {
  const res = await handler(event);
  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = res.body;
  }
  return { statusCode: res.statusCode, body };
}

// A facilities response has the documented shape:
//   { area, facilities: [{ kind, category?, name, lon, lat, metersToCenter }], doorplate }
function assertFacilitiesShape(caseName, body) {
  record(caseName, body && typeof body === "object", "回傳是物件");
  record(caseName, body?.area && typeof body.area === "object", "含 area 物件");
  record(caseName, Array.isArray(body?.facilities), "facilities 是陣列");
  record(
    caseName,
    body?.doorplate && typeof body.doorplate.count === "number" && Array.isArray(body.doorplate.nearest),
    "含 doorplate { count, nearest[] }",
  );
  // Every facility hit has the required numeric/positional fields.
  const badHit = (body?.facilities ?? []).find(
    (f) =>
      typeof f.kind !== "string" ||
      typeof f.lon !== "number" ||
      typeof f.lat !== "number" ||
      typeof f.metersToCenter !== "number",
  );
  record(caseName, !badHit, "每筆 facility 具備 kind/lon/lat/metersToCenter");
}

// ---- cases -----------------------------------------------------------------

// 1) radius: 板橋車站 500m — the rich downtown case. Asserts DB-backed stations, OSM POIs
//    (with category), and doorplate all show up.
async function caseBanqiaoRadius() {
  const name = "① radius 板橋車站 500m (GET)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: { lon: "121.4627", lat: "25.0111", radius: "500" },
  });
  console.log(`  status ${statusCode}`);
  record(name, statusCode === 200, "HTTP 200");
  if (statusCode !== 200) {
    console.log("  body:", JSON.stringify(body));
    return;
  }
  printBody(body);
  assertFacilitiesShape(name, body);

  record(name, body.area.kind === "radius", "area.kind === 'radius'");
  record(name, body.area.radiusMeters === 500, "area.radiusMeters === 500");

  const byKind = groupByKind(body.facilities);
  // DB-backed point stations exist in this dense area.
  record(name, (byKind["公車站"]?.length ?? 0) > 0, "有公車站 (bus_stops)");
  record(name, (byKind["捷運站"]?.length ?? 0) > 0, "有捷運站 (metro_stations)");

  // OSM POIs must be present AND carry a stable `category` key.
  const withCategory = body.facilities.filter((f) => typeof f.category === "string");
  record(name, withCategory.length > 0, "回傳含帶 category 的 OSM POI");

  const categories = new Set(withCategory.map((f) => f.category));
  console.log("  OSM POI categories:", [...categories].sort().join(", "));
  // At least one of the well-known 板橋 categories should appear (金融/公園/停車場…).
  const expectedAny = ["bank", "park", "parking", "department_store", "hotel"];
  const hasExpected = expectedAny.some((c) => categories.has(c));
  record(
    name,
    hasExpected,
    `含預期分類之一 (${expectedAny.join("/")})`,
  );

  record(name, body.doorplate.count > 0, "門牌 count > 0");
}

// 2) radius: 金山 demo 800m — a smaller-town case (sanity that a different point works).
async function caseJinshanRadius() {
  const name = "② radius 金山 demo 800m (GET)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: { lon: "121.636", lat: "25.221", radius: "800" },
  });
  console.log(`  status ${statusCode}`);
  record(name, statusCode === 200, "HTTP 200");
  if (statusCode !== 200) {
    console.log("  body:", JSON.stringify(body));
    return;
  }
  printBody(body);
  assertFacilitiesShape(name, body);
  record(name, body.area.kind === "radius", "area.kind === 'radius'");
  record(name, body.facilities.length > 0, "facilities 非空");
}

// 3) polygon: 板橋方框 (POST GeoJSON Polygon, 4 corners + closing point).
async function caseBanqiaoPolygon() {
  const name = "③ polygon 板橋方框 (POST)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({
      polygon: {
        type: "Polygon",
        coordinates: [
          [
            [121.455, 25.005],
            [121.47, 25.005],
            [121.47, 25.018],
            [121.455, 25.018],
            [121.455, 25.005],
          ],
        ],
      },
    }),
  });
  console.log(`  status ${statusCode}`);
  record(name, statusCode === 200, "HTTP 200");
  if (statusCode !== 200) {
    console.log("  body:", JSON.stringify(body));
    return;
  }
  printBody(body);
  assertFacilitiesShape(name, body);
  record(name, body.area.kind === "polygon", "area.kind === 'polygon'");
  record(name, body.area.radiusMeters === undefined, "polygon 模式無 radiusMeters");
  record(name, body.facilities.length > 0, "facilities 非空");
}

// 4) invalid: neither polygon nor center/radius -> 400.
async function caseInvalidNoArea() {
  const name = "④ invalid 無 area (GET)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: {},
  });
  console.log(`  status ${statusCode}`, JSON.stringify(body));
  record(name, statusCode === 400, "HTTP 400");
  record(name, typeof body?.error === "string", "含 error 訊息");
}

// 5) invalid: center given but a bad (non-positive) radius -> 400.
async function caseInvalidBadRadius() {
  const name = "⑤ invalid radius=0 (GET)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: { lon: "121.4627", lat: "25.0111", radius: "0" },
  });
  console.log(`  status ${statusCode}`, JSON.stringify(body));
  record(name, statusCode === 400, "HTTP 400");
  record(name, typeof body?.error === "string", "含 error 訊息");
}

// 6) per-category radius, widened: base 500m but 特殊設施 (嫌惡設施) out to 3000m. Every
//    other group must stay inside the base radius — that's the whole point of the override,
//    one class reaches further without dragging bus stops and POIs along.
//    Rounding: metersToCenter is Math.round()ed, so allow 1m of slack on the boundary.
async function caseCategoryRadiusWiden() {
  const name = "⑥ 逐類半徑 放大 特殊設施:3000 (GET)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: {
      lon: "121.4627",
      lat: "25.0111",
      radius: "500",
      cats: "special:3000",
    },
  });
  console.log(`  status ${statusCode}`);
  record(name, statusCode === 200, "HTTP 200");
  if (statusCode !== 200) {
    console.log("  body:", JSON.stringify(body));
    return;
  }
  printBody(body);
  assertFacilitiesShape(name, body);

  record(name, body.area.radiusMeters === 500, "area.radiusMeters === 500 (基準不變)");
  record(name, body.area.maxRadiusMeters === 3000, "area.maxRadiusMeters === 3000");
  // The group name expands to every category under 特殊設施.
  const radii = body.area.categoryRadii ?? {};
  const expanded = ["cemetery", "fuel", "crematorium", "waste", "substation", "power_tower", "gas_storage"];
  const allExpanded = expanded.every((c) => radii[c] === 3000);
  console.log("  categoryRadii:", JSON.stringify(radii));
  record(name, allExpanded, "群組展開:特殊設施底下 7 類都是 3000");
  record(name, radii.park === undefined, "沒覆寫到的類別不出現在 categoryRadii");

  // 特殊設施 may exceed the base radius; nothing else may.
  const special = body.byCategory?.["特殊設施"]?.items ?? [];
  const others = Object.entries(body.byCategory ?? {})
    .filter(([group]) => group !== "特殊設施")
    .flatMap(([, summary]) => summary.items ?? []);
  const overreach = others.find((f) => f.metersToCenter > 501);
  record(
    name,
    !overreach,
    overreach
      ? `其他群組不得超過基準 500m — 實際有 ${overreach.kind} ${overreach.metersToCenter}m`
      : "其他群組全部 <= 基準 500m",
  );
  const specialOverreach = special.find((f) => f.metersToCenter > 3001);
  record(name, !specialOverreach, "特殊設施全部 <= 覆寫的 3000m");
  console.log(
    `  特殊設施 ${special.length} 筆，最遠 ${special.length ? Math.max(...special.map((f) => f.metersToCenter)) : "-"}m`,
  );
}

// 7) per-category radius, narrowed: 公車站 is the noisiest layer (板橋 has dozens within a
//    km), so capping it while the rest of the query stays wide is the other half of the
//    feature. Compares against the same query without the override.
async function caseCategoryRadiusNarrow() {
  const name = "⑦ 逐類半徑 縮小 公車站:200 (GET)";
  console.log(`\n=== ${name} ===`);
  const params = { lon: "121.4627", lat: "25.0111", radius: "1000" };
  const wide = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: params,
  });
  const narrow = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: { ...params, cats: "公車站:200" },
  });
  console.log(`  status ${wide.statusCode} / ${narrow.statusCode}`);
  record(name, wide.statusCode === 200 && narrow.statusCode === 200, "兩次 HTTP 200");
  if (wide.statusCode !== 200 || narrow.statusCode !== 200) {
    console.log("  body:", JSON.stringify(narrow.body));
    return;
  }

  const stopsOf = (body) => body.facilities.filter((f) => f.kind === "公車站");
  const wideStops = stopsOf(wide.body);
  const narrowStops = stopsOf(narrow.body);
  console.log(`  公車站: 1000m ${wideStops.length} 筆 -> 200m ${narrowStops.length} 筆`);
  record(name, narrowStops.length < wideStops.length, "覆寫後公車站筆數變少");
  const tooFar = narrowStops.find((f) => f.metersToCenter > 201);
  record(
    name,
    !tooFar,
    tooFar ? `公車站不得超過 200m — 實際有 ${tooFar.metersToCenter}m` : "公車站全部 <= 200m",
  );
  // Only bus stops shrink; the rest of the query still runs at the 1000m base.
  const otherKinds = narrow.body.facilities.filter((f) => f.kind !== "公車站");
  record(name, otherKinds.length > 0, "其他類別不受影響(仍有結果)");
  record(name, narrow.body.area.categoryRadii?.["公車站"] === 200, "categoryRadii 回報 公車站:200");
  // 中文 kind 與 category 鍵是同一個 selector 的兩種寫法,doorplate 則完全不受覆寫影響。
  record(
    name,
    narrow.body.doorplate.count === wide.body.doorplate.count,
    "門牌數不受逐類覆寫影響(一律用基準半徑)",
  );
}

// 8) invalid: a category name that isn't a group / category key / 中文 kind -> 400 (a typo
//    should surface, not silently do nothing).
async function caseInvalidUnknownCategory() {
  const name = "⑧ invalid 未知 category (GET)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: {
      lon: "121.4627",
      lat: "25.0111",
      radius: "500",
      cats: "nosuchcategory:800",
    },
  });
  console.log(`  status ${statusCode}`, JSON.stringify(body));
  record(name, statusCode === 400, "HTTP 400");
  record(name, typeof body?.error === "string" && body.error.includes("nosuchcategory"), "error 指出是哪個類別");
}

// 9) invalid: polygon + categories -> 400. A polygon's boundary IS the area; there's no
//    "expand this category further from the centre".
async function caseInvalidPolygonWithCategories() {
  const name = "⑨ invalid polygon + categories (POST)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({
      polygon: [
        [121.455, 25.005],
        [121.47, 25.005],
        [121.47, 25.018],
      ],
      categories: [{ category: "special", radius: 3000 }],
    }),
  });
  console.log(`  status ${statusCode}`, JSON.stringify(body));
  record(name, statusCode === 400, "HTTP 400");
  record(name, typeof body?.error === "string", "含 error 訊息");
}

// 10) the actual 區域因素 profile produce-survey sends in production (see
//     infra/lambda/produce-survey/lambda.ts FACILITIES_CATEGORY_RADII). Guards the whole
//     string: every alias resolves, every category lands on its documented radius, and the
//     two that differ most (站牌 800 vs 大型車站 2000) really are searched differently.
const REGIONAL_CATS = [
  "metro:2000",
  "hsr:2000",
  "bus_stop:800",
  "motorway_junction:4000",
  "education:1000",
  "market:1000",
  "park:1000",
  "tourism:2000",
  "parking:1000",
  "medical:2000",
  "commerce:2000",
  "substation:2000",
  "power_tower:2000",
  "gas_storage:2000",
  "fuel:2000",
  "cemetery:2000",
  "crematorium:2000",
  "waste:2000",
  "wastewater:2000",
].join(";");

async function caseRegionalProfile() {
  const name = "⑩ 區域因素 demo 標準 (GET)";
  console.log(`\n=== ${name} ===`);
  const { statusCode, body } = await invoke({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: {
      lon: "121.4627",
      lat: "25.0111",
      radius: "600",
      cats: REGIONAL_CATS,
    },
  });
  console.log(`  status ${statusCode}`);
  record(name, statusCode === 200, "HTTP 200");
  if (statusCode !== 200) {
    console.log("  body:", JSON.stringify(body));
    return;
  }
  printBody(body);

  const radii = body.area.categoryRadii ?? {};
  console.log("  categoryRadii:", JSON.stringify(radii));
  record(name, body.area.maxRadiusMeters === 4000, "maxRadiusMeters === 4000 (交流道最遠)");
  // Station aliases must resolve to the Chinese kinds the response is keyed by.
  const expected = {
    捷運站: 2000,
    高鐵站: 2000,
    公車站: 800,
    motorway_junction: 4000,
    education: 1000,
    park: 1000,
    parking: 1000,
    medical: 2000,
    bank: 2000, // 來自 commerce 群組展開
    cemetery: 2000,
    wastewater: 2000,
  };
  const wrong = Object.entries(expected).filter(([key, m]) => radii[key] !== m);
  record(
    name,
    wrong.length === 0,
    wrong.length === 0
      ? "每一類都套到標準表的半徑(含 metro/hsr/bus_stop 別名與 commerce 展開)"
      : `半徑不符: ${wrong.map(([k, m]) => `${k} 應 ${m} 實 ${radii[k]}`).join("、")}`,
  );

  // 站牌 800 vs 大型車站 2000 — the two must genuinely differ, not collapse to one radius.
  const busStops = body.facilities.filter((f) => f.kind === "公車站");
  const farBusStop = busStops.find((f) => f.metersToCenter > 801);
  record(name, !farBusStop, "公車站全部 <= 800m");
  const metro = body.facilities.filter((f) => f.kind === "捷運站");
  const farMetro = metro.find((f) => f.metersToCenter > 2001);
  record(name, !farMetro, "捷運站全部 <= 2000m");
  console.log(
    `  公車站 ${busStops.length} 筆(<=800m)，捷運站 ${metro.length} 筆(<=2000m)`,
  );
}

// ---- run --------------------------------------------------------------------

console.log("facilities 本地 API 測試");
console.log(`bundle: ${bundlePath}`);
console.log(`DB: ${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`);

try {
  await caseBanqiaoRadius();
  await caseJinshanRadius();
  await caseBanqiaoPolygon();
  await caseInvalidNoArea();
  await caseInvalidBadRadius();
  await caseCategoryRadiusWiden();
  await caseCategoryRadiusNarrow();
  await caseInvalidUnknownCategory();
  await caseInvalidPolygonWithCategories();
  await caseRegionalProfile();
} catch (err) {
  console.error("\n測試執行時發生未預期錯誤:", err instanceof Error ? err.stack : String(err));
  failures++;
}

const total = results.length;
const passed = total - failures;
console.log(`\n====================\n斷言結果: ${passed}/${total} 通過`);
if (failures > 0) {
  console.log("失敗項目:");
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  - [${r.caseName}] ${r.detail}`);
  }
}

// Close the pg pool, then hard-exit: the bundled pg build leaves a lingering socket handle
// that keeps the event loop alive, so process.exit is required to terminate (this is a
// throwaway test process, so a forced exit is fine). See tests/README.md.
await closePool();
process.exit(failures > 0 ? 1 : 0);
