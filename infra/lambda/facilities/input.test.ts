// facilities / input.ts 的 parseArea 單元測試(純函式,不連網、不連 DB)。
// 執行:npm run test:facilities(見 infra/package.json)。
//
// 需要 DB 的整合測試在 tests/run-facilities-tests.mjs(要 Docker PostGIS);這一支只釘
// 「呼叫端怎麼描述範圍」這層的契約,特別是新增的兩件事:
//   ① polygon + radius = 用多邊形取中心、成員判定仍走逐類半徑(不是包含判定)
//   ② point = 第二量測點,只多一個距離,絕不影響查得到哪些設施

import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidInputError, parseArea } from "./input.js";

/** 1km 見方左右的正方形(逆時針),形心應落在 [121.5, 25.0]。 */
const SQUARE: [number, number][] = [
  [121.495, 24.995],
  [121.505, 24.995],
  [121.505, 25.005],
  [121.495, 25.005],
];

test("polygon + radius:多邊形只用來取中心,解析成 radius 模式", () => {
  const area = parseArea({ polygon: SQUARE, radius: 1000 });
  assert.equal(area.kind, "radius");
  if (area.kind !== "radius") return;
  // 形心 = ST_Centroid 在度數平面上算出的同一個點。
  assert.ok(Math.abs(area.center[0] - 121.5) < 1e-9, `lon ${area.center[0]}`);
  assert.ok(Math.abs(area.center[1] - 25.0) < 1e-9, `lat ${area.center[1]}`);
  assert.equal(area.radiusMeters, 1000);
  assert.deepEqual(area.centerRing?.[0], SQUARE[0]);
  // ring 被閉合(首尾同點),才是合法的 linear ring。
  assert.equal(area.centerRing?.length, SQUARE.length + 1);
});

test("polygon + radius 允許逐類半徑 —— 那本來就是 radius 模式的東西", () => {
  const area = parseArea({
    polygon: SQUARE,
    radius: 600,
    categories: [{ category: "bus_stop", radius: 800 }],
  });
  assert.equal(area.kind, "radius");
  if (area.kind !== "radius") return;
  assert.equal(area.categoryRadii?.get("公車站"), 800);
  assert.equal(area.maxRadiusMeters, 800);
});

test("polygon 沒帶 radius 仍是包含判定,配逐類半徑一律 400", () => {
  const area = parseArea({ polygon: SQUARE });
  assert.equal(area.kind, "polygon");

  assert.throws(
    () => parseArea({ polygon: SQUARE, categories: [{ category: "special", radius: 3000 }] }),
    (err: unknown) => {
      assert.ok(err instanceof InvalidInputError);
      // 錯誤訊息要指出「加個 radius 就能用」,否則呼叫端只知道被擋、不知道怎麼改。
      assert.match(err.message, /polygon together with a radius/);
      return true;
    },
  );
});

test("point:三種寫法都收,且不改變 area 本身", () => {
  const expected: [number, number] = [121.6, 25.22];
  for (const input of [
    { lon: 121.5, lat: 25, radius: 500, point: expected },
    { lon: 121.5, lat: 25, radius: 500, point: "121.6,25.22" },
    { lon: 121.5, lat: 25, radius: 500, pointLon: 121.6, pointLat: 25.22 },
  ]) {
    const area = parseArea(input);
    assert.deepEqual(area.point, expected, JSON.stringify(input));
    assert.equal(area.kind, "radius");
    if (area.kind === "radius") assert.deepEqual(area.center, [121.5, 25]);
  }
});

test("point 也能配包含判定的 polygon(只是多一個距離)", () => {
  const area = parseArea({ polygon: SQUARE, point: [121.6, 25.22] });
  assert.equal(area.kind, "polygon");
  assert.deepEqual(area.point, [121.6, 25.22]);
});

test("沒帶 point 就不該無端生出一個", () => {
  assert.equal(parseArea({ lon: 121.5, lat: 25, radius: 500 }).point, undefined);
  assert.equal(parseArea({ polygon: SQUARE, radius: 500 }).point, undefined);
});

test("point 座標非法照樣擋下(不靜默忽略)", () => {
  assert.throws(
    () => parseArea({ lon: 121.5, lat: 25, radius: 500, point: [999, 25] }),
    InvalidInputError,
  );
  assert.throws(
    () => parseArea({ lon: 121.5, lat: 25, radius: 500, point: ["x", "y"] }),
    InvalidInputError,
  );
});

test("退化多邊形(共線)沒有形心,退回頂點平均而不是 NaN", () => {
  const line: [number, number][] = [
    [121.5, 25.0],
    [121.6, 25.0],
    [121.7, 25.0],
  ];
  const area = parseArea({ polygon: line, radius: 500 });
  assert.equal(area.kind, "radius");
  if (area.kind !== "radius") return;
  assert.ok(Number.isFinite(area.center[0]) && Number.isFinite(area.center[1]));
  assert.ok(Math.abs(area.center[0] - 121.6) < 1e-9, `lon ${area.center[0]}`);
  assert.ok(Math.abs(area.center[1] - 25.0) < 1e-9, `lat ${area.center[1]}`);
});

test("GeoJSON Polygon 與 ?poly= 字串都吃得到 polygon + radius 這條路", () => {
  const geojson = parseArea({
    polygon: { type: "Polygon", coordinates: [SQUARE] },
    radius: 700,
  });
  assert.equal(geojson.kind, "radius");

  const poly = parseArea({
    poly: SQUARE.map(([lon, lat]) => `${lon},${lat}`).join(";"),
    radius: "700",
    point: "121.6,25.22",
  });
  assert.equal(poly.kind, "radius");
  if (poly.kind !== "radius") return;
  assert.equal(poly.radiusMeters, 700);
  assert.deepEqual(poly.point, [121.6, 25.22]);
});
