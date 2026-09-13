// facilities / query.ts 的 SQL 組裝測試:用一個假 repo 攔下每一句 SQL,不需要 DB。
// 執行:npm run test:facilities
//
// 這支在防的是 `$n` 對位 —— query.ts 的 placeholder 是「呼叫 param() 的順序」決定的,而
// SQL 字串是分段組出來的(with clause 先 stringify,prefilter/within 之後才 bind)。多一個
// ref_point CTE 就多兩個參數,一旦某一句的 params 與它引用的 $n 不一致,PostgreSQL 會回
// 「bind message supplies N parameters」或更糟 —— 把錯的值當座標算距離,而且不會報錯。
// 所以每一句都逐一驗:引用到的最大 $n == params.length,且 1..n 全部有被引用。

import assert from "node:assert/strict";
import { test } from "node:test";

import type { FacilitiesRepo, QueryResult, Row } from "./db.js";
import { parseArea } from "./input.js";
import { queryFacilities } from "./query.js";

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * 假 repo:記下每一句 SQL + params,依 SQL 內容回最低限度的列(queryFacilities 會對
 * center / doorplate count 直接取 rows[0]!,回空會炸)。
 */
function stubRepo(captured: Captured[], hit: Row): FacilitiesRepo {
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      captured.push({ sql, params });
      // 呼叫端用 T 宣告它預期的列形狀,stub 只能回 Row —— 透過 unknown 轉一次。
      const rows = (out: Row[]): QueryResult<T> => ({ rows: out as unknown as T[] });
      // 先比表,再比 center —— 每一句量距離的 SQL 裡都有 `(SELECT pt FROM center)`,
      // 拿 "FROM center" 當第一個判斷會把 POI 那句也誤判成取中心座標的那句。
      if (sql.includes("FROM pois")) return rows([hit]);
      if (sql.includes("count(*)")) return rows([{ n: 0 }]);
      if (sql.includes("FROM doorplate")) return rows([]);
      // 取中心座標的那一句(唯一一句 SELECT 出 ST_X(pt))。
      if (sql.includes("ST_X(pt) AS lon")) return rows([{ lon: 121.5, lat: 25 }]);
      return rows([]); // 站點 UNION
    },
    async close() {},
  };
}

/** 這句 SQL 引用到的 `$n` 集合。 */
function placeholders(sql: string): number[] {
  return [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
}

/** 每一句的 params 數量與它引用的 $n 必須完全吻合:不多綁、不少綁、不跳號。 */
function assertParamsAlign(captured: Captured[]): void {
  assert.ok(captured.length > 0, "沒有任何 SQL 被送出");
  for (const { sql, params } of captured) {
    const used = new Set(placeholders(sql));
    const max = used.size === 0 ? 0 : Math.max(...used);
    assert.equal(
      max,
      params.length,
      `最大 $n (${max}) 與 params 長度 (${params.length}) 不符:\n${sql}`,
    );
    for (let i = 1; i <= params.length; i++) {
      assert.ok(used.has(i), `$${i} 被綁定但 SQL 裡沒用到:\n${sql}`);
    }
  }
}

const POI_ROW: Row = {
  category: "park",
  name: "中山公園",
  lon: 121.5005,
  lat: 25.0005,
  meters: 80,
  meters_point: 310,
};

test("帶 point:每句都有 ref_point CTE 與真正的 meters_point,且 $n 對位", async () => {
  const captured: Captured[] = [];
  const area = parseArea({ lon: 121.5, lat: 25, radius: 600, point: [121.503, 25.002] });
  const result = await queryFacilities(stubRepo(captured, POI_ROW), area, { includeNlsc: false });

  assertParamsAlign(captured);
  for (const { sql } of captured) {
    assert.match(sql, /ref_point AS \(SELECT ST_SetSRID\(ST_MakePoint\(\$\d+, \$\d+\)/, sql);
  }
  // 真正量距離的三句(站點/POI/門牌最近幾筆)要用 ref_point 算,不是塞 NULL。
  const measuring = captured.filter(({ sql }) => sql.includes("AS meters_point"));
  assert.equal(measuring.length, 3, "應有站點/POI/門牌三句量第二個距離");
  for (const { sql } of measuring) {
    assert.match(sql, /\(SELECT pt FROM ref_point\)::geography\) AS meters_point/, sql);
    assert.doesNotMatch(sql, /NULL::double precision AS meters_point/, sql);
  }

  // point 原樣回拋,設施帶上 metersToPoint。
  assert.deepEqual(result.area.point, { lon: 121.503, lat: 25.002 });
  assert.equal(result.facilities[0]?.metersToPoint, 310);
  assert.equal(result.facilities[0]?.metersToCenter, 80);
  assert.equal(result.byCategory["公共設施"]?.nearest?.metersToPoint, 310);
});

test("沒帶 point:不生 ref_point,meters_point 是 typed NULL,hit 也不帶 metersToPoint", async () => {
  const captured: Captured[] = [];
  const area = parseArea({ lon: 121.5, lat: 25, radius: 600 });
  // 上游回的 meters_point 為 null(NULL 欄)—— 不可變成 0。
  const result = await queryFacilities(
    stubRepo(captured, { ...POI_ROW, meters_point: null }),
    area,
    { includeNlsc: false },
  );

  assertParamsAlign(captured);
  for (const { sql } of captured) assert.doesNotMatch(sql, /ref_point/, sql);
  for (const { sql } of captured.filter((c) => c.sql.includes("AS meters_point"))) {
    assert.match(sql, /NULL::double precision AS meters_point/, sql);
  }

  assert.equal(result.area.point, undefined);
  assert.ok(!("metersToPoint" in (result.facilities[0] ?? {})), "不該出現 metersToPoint 欄");
  assert.equal(result.facilities[0]?.metersToCenter, 80);
});

test("polygon + radius + point:圓心是多邊形重心,成員判定仍是半徑", async () => {
  const captured: Captured[] = [];
  const area = parseArea({
    polygon: [
      [121.495, 24.995],
      [121.505, 24.995],
      [121.505, 25.005],
      [121.495, 25.005],
    ],
    radius: 600,
    categories: [{ category: "park", radius: 1000 }],
    point: [121.503, 25.002],
  });
  await queryFacilities(stubRepo(captured, POI_ROW), area, { includeNlsc: false });

  assertParamsAlign(captured);
  for (const { sql } of captured) {
    // 成員判定走 ST_DWithin(半徑),不是 ST_Contains(多邊形包含)。
    assert.doesNotMatch(sql, /ST_Contains/, sql);
    // 圓心是直接綁進去的點(重心已在 input.ts 算完),SQL 裡沒有 ST_Centroid。
    assert.doesNotMatch(sql, /ST_Centroid/, sql);
    assert.match(sql, /center AS \(SELECT ST_SetSRID\(ST_MakePoint\(/, sql);
  }
  // 逐類半徑在這個模式下可用 —— POI 那句應該有 ovr VALUES 表。
  const poiSql = captured.find((c) => c.sql.includes("FROM pois"))!.sql;
  assert.match(poiSql, /ovr\(category, radius_m\) AS \(VALUES/);
});

test("polygon 包含判定 + point:ST_Contains 照舊,第二個距離照樣量得到", async () => {
  const captured: Captured[] = [];
  const area = parseArea({
    polygon: [
      [121.495, 24.995],
      [121.505, 24.995],
      [121.505, 25.005],
    ],
    point: [121.503, 25.002],
  });
  const result = await queryFacilities(stubRepo(captured, POI_ROW), area, { includeNlsc: false });

  assertParamsAlign(captured);
  assert.equal(result.area.kind, "polygon");
  const poi = captured.find((c) => c.sql.includes("FROM pois"))!.sql;
  assert.match(poi, /ST_Contains/);
  assert.match(poi, /\(SELECT pt FROM ref_point\)::geography\) AS meters_point/);
  assert.equal(result.facilities[0]?.metersToPoint, 310);
});
