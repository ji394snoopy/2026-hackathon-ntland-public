# tests — facilities API 本地測試

如何在本地測試 **facilities API**（基地環境評估系統的後端核心）。

`infra/lambda/facilities/` 是一個查 PostGIS 的 Lambda：給一個**範圍**（1 個點 + 半徑，
或多邊形），回傳範圍內的設施清單（捷運/高鐵/公車站 + OSM POI + NLSC 即時設施）與各自到
範圍中心的距離，外加門牌數量與最近幾筆。

本文件是獨立、可照抄執行的測試指引。內容整理自 `infra/README.md`（「OSM POI」與「設施
範圍查詢」兩節）與 `設施查詢對照表.md`（「測試方法」）。

---

## 0. 前置條件（一次性）

測試前需要：**本機 Docker PostGIS 已啟動 + 資料已灌 + handler 已打包**。

### 0.1 起 Docker PostGIS

容器名 `ntland-postgis`、DB `gis`、**host port 5433**（不是 5432；避免和本機既有
Postgres 衝突）。

```bash
# 從 repo root
docker compose -f infra/local/docker-compose.yml up -d

# 確認 healthy
docker ps --filter name=ntland-postgis
```

首次建立資料 volume 時會自動 `CREATE EXTENSION postgis`。

### 0.2 灌資料

腳本全程走 `docker exec` 連容器內 `psql`，**host 不需裝 ogr2ogr / psql**，只要 Docker + Node。

```bash
infra/local/import/import.sh all        # 全部（transport / busstops / doorplate / pois）
```

只想灌部分：

```bash
infra/local/import/import.sh transport  # 高鐵/捷運/國道/鐵路/輕軌路線與站位
infra/local/import/import.sh busstops   # 公車站位
infra/local/import/import.sh pois       # OSM POI（金融/公園/停車場…14 類）
infra/local/import/import.sh doorplate  # 門牌 CSV（大檔 ~2M 筆）
```

> `pois` 表若還沒產生 GeoJSON 快照，先跑一次：
> `node infra/local/import/fetch-osm.mjs`（打 Overpass，寫到 `assets/osm/ntpc-pois.geojson`），
> 再 `import.sh pois`。

灌完可快速驗證（分類統計）：

```bash
docker exec ntland-postgis psql -U postgres -d gis -c \
  "SELECT category, count(*) FROM pois GROUP BY category ORDER BY 2 DESC;"
```

### 0.3 打包 handler

「內建 harness」與「一行呼叫」跑的都是**打包版** `index.mjs`（連同 `pg` 一起打包，等同
部署形狀）。改過 `infra/lambda/facilities/*.ts` 後都要重打包：

```bash
cd infra
npm run build:lambdas      # 產生 infra/build/lambda/facilities/index.mjs
```

> **注意**：`query.ts` 有加 `import { queryNlscFacilities } from "./nlsc.js"`；門牌那條
> 查詢用 `geomPrefilter` 先走 GiST 索引再做 `::geography` 精算（否則 2M 筆會全表掃描、
> 看起來像 hang）。若你動到 query 層，記得 `npm run build`（tsc 型別檢查）+ 重打包。

---

## 三種測試層級

由淺到深：純 SQL 直查（驗資料）→ 內建 harness（跑預設範例）→ 自訂座標一行呼叫。

### 層級 ① 純 SQL 直查（不經 Lambda，驗證資料本身）

最快確認「資料有沒有灌對」。直接對容器下 SQL。

```bash
# radius 模式：某點 800m 內各類 POI 數量
docker exec ntland-postgis psql -U postgres -d gis -c \
  "SELECT category, count(*)
   FROM pois
   WHERE ST_DWithin(geom::geography, ST_MakePoint(121.636,25.221)::geography, 800)
   GROUP BY category ORDER BY 2 DESC;"

# polygon 模式：落在 4 點多邊形內的 POI
docker exec ntland-postgis psql -U postgres -d gis -c \
  "WITH area AS (SELECT ST_SetSRID(ST_GeomFromText(
       'POLYGON((121.632 25.218,121.641 25.218,121.641 25.225,121.632 25.225,121.632 25.218))'),4326) g)
   SELECT category, count(*) FROM pois, area
   WHERE ST_Contains(area.g, geom) GROUP BY category ORDER BY 2 DESC;"

# 找離某點最近的捷運站（GiST + KNN <->）
docker exec ntland-postgis psql -U postgres -d gis -c \
  "SELECT props->>'MARKNAME1' AS name,
          round(ST_Distance(geom::geography,
                ST_MakePoint(121.4627,25.0111)::geography)) AS meters
   FROM metro_stations
   ORDER BY geom <-> ST_SetSRID(ST_MakePoint(121.4627,25.0111),4326)
   LIMIT 5;"
```

### 層級 ② 內建 harness（跑一組預設範例查詢）

跑打包好的 handler，對幾個預設範例（radius GET / polygon POST / 無效輸入）印出各類設施
筆數與最近幾筆。

infra 內建的 harness：

```bash
cd infra
npm run build:lambdas                              # 先打包（若還沒）
PGPORT=5433 node lambda/facilities/run-local.mjs
```

本 tests/ 資料夾的**固定測試套件**（多了斷言 + PASS/FAIL 總結，適合當回歸測試）：

```bash
# 從 repo root
node tests/run-facilities-tests.mjs
# 或指定連線
PGPORT=5433 PGHOST=127.0.0.1 node tests/run-facilities-tests.mjs
# NLSC 即時 API 較慢時，縮短單類等待
NLSC_TIMEOUT_MS=3000 node tests/run-facilities-tests.mjs
```

`tests/run-facilities-tests.mjs` 跑 5 個固定案例並斷言：

| # | 案例 | 斷言重點 |
|---|---|---|
| ① | radius 板橋車站 500m (GET) | 200、有公車站/捷運站、**含帶 `category` 的 OSM POI**（bank/park/parking…）、門牌 > 0 |
| ② | radius 金山 demo 800m (GET) | 200、facilities 非空 |
| ③ | polygon 板橋方框 (POST) | 200、`area.kind === "polygon"`、無 `radiusMeters` |
| ④ | invalid 無 area (GET) | 400 + error 訊息 |
| ⑤ | invalid radius=0 (GET) | 400 + error 訊息 |

退出碼：全通過為 `0`，任一斷言失敗為 `1`（可接 CI / hook）。

### 層級 ③ 自訂座標（一行呼叫打包好的 handler）

改任意座標快速手測。**結尾一定要 `process.exit(0)`** —— 打包版 `pg` 會留一個 socket
handle 讓 event loop 不結束，行程會 hang（這是測試腳本，強制退出無妨）。

radius 模式（1 點 + 半徑）：

```bash
cd infra
PGPORT=5433 node --input-type=module -e '
  const { handler, closePool } = await import("./build/lambda/facilities/index.mjs");
  const res = await handler({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: { lon: "121.636", lat: "25.221", radius: "800" },
  });
  const body = JSON.parse(res.body);
  const byKind = {};
  for (const f of body.facilities) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  console.log(res.statusCode, byKind);
  await closePool();
  process.exit(0);   // 不加會 hang
'
```

polygon 模式（4 個點，POST GeoJSON Polygon）：

```bash
cd infra
PGPORT=5433 node --input-type=module -e '
  const { handler, closePool } = await import("./build/lambda/facilities/index.mjs");
  const res = await handler({
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({ polygon: { type: "Polygon", coordinates: [[
      [121.632,25.218],[121.641,25.218],[121.641,25.225],[121.632,25.225],[121.632,25.218],
    ]] } }),
  });
  const body = JSON.parse(res.body);
  const byKind = {};
  for (const f of body.facilities) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  console.log("area", body.area, "\nby kind", byKind);
  await closePool();
  process.exit(0);
'
```

---

## 連線設定

腳本用 `PG*` 環境變數連線，預設對齊本機 Docker 容器：

| 變數 | 預設 | 說明 |
|---|---|---|
| `PGHOST` | `127.0.0.1` | |
| `PGPORT` | `5433` | 容器 host 對映埠（**非 5432**） |
| `PGUSER` | `postgres` | |
| `PGPASSWORD` | `postgres` | |
| `PGDATABASE` | `gis` | |
| `NLSC_TIMEOUT_MS` | `8000` | 單一 NLSC 類別的逾時；縮短可讓離線/慢網時更快降級 |

---

## 回傳形狀（摘要）

```jsonc
{
  "area": { "kind": "radius", "center": { "lon": .., "lat": .. }, "radiusMeters": 500 },
  "facilities": [
    { "kind": "捷運站", "name": "...", "lon": .., "lat": .., "metersToCenter": 234 },
    { "kind": "金融機構", "category": "bank", "name": "...", "lon": .., "lat": .., "metersToCenter": 98 }
  ],
  "doorplate": { "count": 9173, "nearest": [ { "address": "...", "lon": .., "lat": .., "metersToCenter": 5 } ] }
}
```

- `facilities` 合流三來源：PostGIS 站點（無 `category`）、OSM POI（**帶 `category`**，
  如 `bank`/`park`/`parking`/`substation`）、NLSC 即時（殯葬/加油站/醫療/文教）。
- `doorplate` 只回 `count` + 最近 5 筆（不逐筆回 ~2M 門牌）。
- polygon 模式無 `radiusMeters`，`center` 為多邊形 centroid。

完整範例輸入/輸出與參考數字見 [`examples/README.md`](examples/README.md)。

---

## 疑難排解

| 症狀 | 原因 / 解法 |
|---|---|
| `無法載入打包好的 handler` | 還沒 `cd infra && npm run build:lambdas` |
| 502 `queryNlscFacilities is not defined` | 打包版過舊；重跑 `npm run build:lambdas`（query.ts 已補上 import） |
| 呼叫很久沒回（像 hang） | 多半是門牌全表掃描；確認用的是含 `geomPrefilter` 的最新 query.ts 並已重打包 |
| 一行呼叫跑完不結束 | 正常；`pg` 留了 socket handle，結尾要 `process.exit(0)` |
| 連不上 DB / 逾時 | 容器沒起或埠不對；`docker ps` 檢查，`PGPORT` 對映實際埠（預設 5433） |
| NLSC 類別缺（醫療/文教/殯葬/加油站） | 即時 API，網路慢或斷線時該類為空；DB-backed 設施仍會回。可調 `NLSC_TIMEOUT_MS` |
