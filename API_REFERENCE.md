# 地價查估系統 — API 文件

描述後端各 Lambda 的 HTTP 介面契約（endpoint / request / response / 錯誤）。
逐步可複製的 `curl` 操作腳本見 [E2E_MANUAL.md](E2E_MANUAL.md)；本文件只描述介面，不含操作流程。

---

## Endpoint 取得方式（**不要寫死**）

所有 API 都是 **AWS Lambda Function URL**。網址由 CDK 部署時產生，
**重新部署／換 AWS 帳號／換環境（dev / prod）網址都會變**，
所以本文件一律用 `{{XXX_URL}}` 佔位符，實際值請在部署後從 CloudFormation Outputs 取得：

```bash
# 一次列出兩個 stack 的所有 Function URL
for s in NtlandLambdaStack NtlandBedrockStack; do
  aws cloudformation describe-stacks --stack-name "$s" \
    --query 'Stacks[0].Outputs[?ends_with(OutputKey, `FunctionUrl`)].{Key:OutputKey,Url:OutputValue}' \
    --output table
done
```

**`NtlandLambdaStack`**

| 佔位符 | CfnOutput Key | Lambda |
|--------|---------------|--------|
| `{{FACILITIES_URL}}` | `FacilitiesFunctionUrl` | `ntpc-facilities` |
| `{{ZONING_URL}}` | `ZoningFunctionUrl` | `ntpc-zoning-filter` |
| `{{WIND_URL}}` | `WindFunctionUrl` | `ntpc-wind-condition` |
| `{{BASE_TOPO_URL}}` | `BaseTopoFunctionUrl` | `ntpc-maptiles-base` |
| `{{DETAIL_TOPO_URL}}` | `DetailTopoFunctionUrl` | `ntpc-maptiles-detail` |
| `{{LAND_EASYMAP_URL}}` | `LandEasymapFunctionUrl` | `ntpc-land-easymap` |

**`NtlandBedrockStack`**

| 佔位符 | CfnOutput Key | Lambda |
|--------|---------------|--------|
| `{{DISTRICT_SURVEY_DRAFT_URL}}` | `DistrictSurveyDraftFunctionUrl` | `ntpc-district-survey-draft` |
| `{{PRODUCE_SURVEY_URL}}` | `ProduceSurveyFunctionUrl` | `ntpc-produce-survey` |
| `{{CASE_STORE_URL}}` | `CaseStoreFunctionUrl` | `ntpc-case-store` |
| `{{FACTOR_STANDARD_EXTRACT_URL}}` | `FactorStandardFunctionUrl` | `ntpc-factor-standard-extract` |
| `{{FACTOR_STANDARD_STORE_URL}}` | `FactorStandardStoreFunctionUrl` | `ntpc-factor-standard-store` |
| `{{REGIONAL_FACTOR_GRADING_URL}}` | `RegionalFactorGradingFunctionUrl` | `ntpc-regional-factor-grading` |
| `{{INDIVIDUAL_FACTOR_GRADING_URL}}` | `IndividualFactorGradingFunctionUrl` | `ntpc-individual-factor-grading` |
| `{{PRODUCE_REGIONAL_FACTORS_URL}}` | `ProduceRegionalFactorsFunctionUrl` | `ntpc-produce-regional-factors` |
| `{{PRODUCE_COMPARISON_URL}}` | `ProduceComparisonFunctionUrl` | `ntpc-produce-comparison` |
| `{{LAND_TRANSACTION_URL}}` | `LandTransactionFunctionUrl` | `ntpc-land-transaction` |
| `{{LAND_VALUE_URL}}` | `LandValueFunctionUrl` | `ntpc-land-value` |
| ~~`{{LAND_LOCATE_URL}}`~~ | `LandLocateFunctionUrl` | `ntpc-land-locate` ⚠️ deprecated，改用 `{{LAND_EASYMAP_URL}}` |
| `{{IMAGE_UPLOAD_URL}}` | `ImageUploadFunctionUrl` | `ntpc-image-upload` |
| `{{FILL_DISTRICT_SURVEY_URL}}` | `FillDistrictSurveyFunctionUrl` | `ntpc-fill-district-survey` |
| `{{FILL_REGIONAL_ANALYSIS_URL}}` | `FillRegionalAnalysisFunctionUrl` | `ntpc-fill-regional-analysis` |
| `{{FILL_INDIVIDUAL_ANALYSIS_URL}}` | `FillIndividualAnalysisFunctionUrl` | `ntpc-fill-individual-analysis` |
| `{{FILL_REPORT_URL}}` | `FillReportFunctionUrl` | `ntpc-fill-report` |
| `{{EXPORT_REPORT_URL}}` | `ExportReportFunctionUrl` | `ntpc-export-report` |

> **前端串接**：把取得的網址放進環境變數（如 `VITE_FACILITIES_URL`）或部署時注入的
> runtime config，**不要 hardcode 在原始碼**。本文件範例中的 `{{FACILITIES_URL}}`
> 即代表該環境變數的值（結尾含 `/`）。

---

## 共通規格

| 項目 | 值 |
|------|-----|
| 認證 | 無（Function URL `authType = NONE`，公開） |
| CORS | `allowedOrigins: ["*"]`、`allowedMethods: [GET, POST]`、`allowedHeaders: ["content-type"]` |
| 回應 Content-Type | `application/json; charset=utf-8`（填表/匯出類 API 回 `application/pdf`） |
| 座標系 | WGS84（EPSG:4326）。**注意各 API 的經緯順序不一致**，見各章節標註 |
| 錯誤格式 | `{ "error": string }` |

> ⚠️ **Bedrock 類 API（產表／評分／匯出）冷啟動或尖峰時，偶爾會回 HTTP 500 且 body 是
> 純文字 `Internal Server Error`（不是 JSON）**。呼叫端請以 `Content-Type` 或 try/catch
> 判斷，不要假設非 2xx 一定是 JSON；重試一次通常即可成功。

---

## API 一覽

正式流程最短路徑：**Bp → Be（前端編輯）→ D0 → D1 → C2 → E0 → D2 → E → D3 →（G）→ Hx**。
標「選用」的是被 orchestrator（Bp / E0 / E / Hx）包在內部的零件，可單獨呼叫來除錯或做局部功能。

| 章節 | API | 正式流程 | 內部會呼叫 |
|------|-----|:--------:|-----------|
| [A](#a--facilities--周邊設施查詢) | facilities | 選用 | — |
| [B](#b--district-survey-draft--表一單類草稿產製) | district-survey-draft | 選用 | — |
| [Bp](#bp--produce-survey--表一草稿產製正式入口) | produce-survey | ★ | A × 1、B × 8 |
| [Be](#be--估價師編輯表一無-api) | （前端編輯，無 API） | ★ | — |
| [D](#d--case-store--案件與三表定稿儲存) | case-store | ★ | — |
| [C1](#c1--factor-standard-extract--評價基準明細表數位化) | factor-standard-extract | 選用 | — |
| [C1s](#c1s--factor-standard-store--數位化結果存取) | factor-standard-store | 選用 | — |
| [C2](#c2--regional-factor-grading--區域因素評分表二) | regional-factor-grading | ★ | — |
| [E0](#e0--produce-regional-factors--表二產製正式入口) | produce-regional-factors | ★ | C2 × (1+N) |
| [E-pre](#e-pre--land-transaction--實價登錄交易查詢) | land-transaction | 選用 | — |
| [E](#e--produce-comparison--表三產製正式入口) | produce-comparison | ★ | individual-factor-grading × (1+N)、land-transaction |
| [D3](#d--case-store--案件與三表定稿儲存) | case-store `?form=comparison` | ★ | — |
| [G](#g--image-upload--案件圖片上傳列表) | image-upload | ★ | — |
| [H1](#h1--fill-district-survey--表一-pdf) | fill-district-survey | 選用 | — |
| [H2](#h2--fill-regional-analysis--表二-pdf) | fill-regional-analysis | 選用 | — |
| [H3](#h3--fill-individual-analysis--表三-pdf) | fill-individual-analysis | 選用 | — |
| [H4](#h4--fill-report--pdf-合併器) | fill-report | 選用 | — |
| [Hx](#hx--export-report--報告匯出正式入口) | export-report | ★ | H1、H2、H3、G、H4 |

> 三表的命名在程式碼裡不完全一致（cli 的表 3/4/5 對應前端的表 1/2/3）。本文件一律用
> **表一＝地價區段勘查表、表二＝區域因素分析明細表、表三＝比較法調查估價表**。
>
> 表格外但實際會用到的一支：[land-easymap](#land-easymap--地籍圖資便民系統即時查詢任何地號)（附錄 A）。
> 表一的定位流程（行政區＋段＋地號 → 經緯度／面積 → 存進 [D1](#d1--存表一定稿) 的宗地身分欄）走它，
> 它同時也是 [Bp](#bp--produce-survey--表一草稿產製正式入口) `benchmarkLocation` 座標的來源。

---

## A · facilities — 周邊設施查詢

查詢指定範圍內的點位設施（捷運/高鐵/公車站、OSM POI、NLSC 環域設施），
回傳每筆設施到範圍中心的直線距離，另附門牌地址摘要。

| | |
|--|--|
| **Endpoint** | `{{FACILITIES_URL}}` — `NtlandLambdaStack` / `FacilitiesFunctionUrl` |
| **Method** | `GET`（query string）或 `POST`（JSON body） |
| **正式流程** | ⬜ 選用。`produce-survey` 內部會自行呼叫；單獨呼叫用於除錯或前端「周邊設施」圖層 |
| **耗時** | 約 1–3 秒（含即時呼叫 NLSC 環域 API；Lambda timeout 30s） |
| **資料來源** | PostGIS（`metro_stations` / `hsr_stations` / `bus_stops` / `pois` / `doorplate`）＋ NLSC 即時 API |

### Request

範圍有兩種指定方式，**擇一**；同時給 polygon 與 center 時，**polygon 優先**。

**方式一：中心點 + 半徑**

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `lon` / `lat` | number | ✅ | 中心點經度、緯度。亦可用 `center_lon` / `center_lat` |
| `center` | `[lon, lat]` \| `"lon,lat"` | ✅ | 上述兩參數的合併寫法（POST 用陣列，GET 用逗號字串） |
| `radius` | number | ⬜ | **基準**半徑（公尺）。預設 `500`，上限 `20000`，須 > 0 |
| `categories` / `cats` | `{category, radius}[]` \| string | ⬜ | 逐類覆寫基準半徑，見下 |

**逐類半徑（`categories`）**

只做**覆寫**：列到的類別用自己的半徑，沒列到的一律吃 `radius`。可放大也可縮小 ——
嫌惡設施拉到 3000m 才問得出「最近的在哪」，公車站維持 200m 才不會回一堆用不到的站牌。

```jsonc
// POST：陣列
{ "center": [121.63575, 25.2219], "radius": 500,
  "categories": [ { "category": "特殊設施", "radius": 3000 },
                  { "category": "公車站",   "radius": 200  } ] }
```

```http
GET {{FACILITIES_URL}}?lon=121.63575&lat=25.2219&radius=500&cats=special:3000;公車站:200
```

`category` 四種寫法都通，會展開成底下所有類別：

| 寫法 | 例 |
|------|-----|
| 群組中文名 | `特殊設施`（＝底下 7 類嫌惡設施全部） |
| 群組英文別名 | `transport` / `public_facility` / `infrastructure` / `special` / `commerce` |
| `category` 鍵 | `park`、`cemetery`、`medical` |
| 車站英文別名 | `metro`（捷運站）/ `hsr`（高鐵站）/ `bus_stop`（公車站） |
| 中文 `kind` | `公園`、`殯葬設施`、`公車站` |

**目前 demo 採用的半徑標準**（區域因素由 [Bp](#bp--produce-survey--表一草稿產製正式入口) 帶，個別因素由前端表三那條路徑帶）

| 項目 | 區域因素 | 個別因素 | `category` |
|------|:---:|:---:|---|
| 大型車站 | 2000 | 2000 | `metro` / `hsr` |
| 站牌 / 車站 | 800 | 2000 | `bus_stop` |
| 交流道 | 4000 | — | `motorway_junction` |
| 學校 | 1000 | 2000 | `education` |
| 市場 | 1000 | 2000 | `market` |
| 公園、廣場 | 1000 | 2000 | `park` |
| 觀光 | 2000 | — | `tourism` |
| 停車場 | 1000 | — | `parking` |
| 服務性設施 / 商圈 | 2000 | 2000 | `medical`、`commerce` |
| 電器設施、燃料設施 | 2000 | 2000 | `substation`、`power_tower`、`gas_storage`、`fuel` |
| 殯葬 | 2000 | 2000 | `cemetery`、`crematorium` |
| 廢棄物處理設施 | 2000 | 2000 | `waste` |
| 環境污染 | 2000 | — | `wastewater` |
| 嫌惡設施（整群） | — | 2000 | `special` |

> - 群組與單項重疊時取**較大**的半徑。
> - `其他` 沒有固定成員，不能指定半徑。
> - 門牌 `doorplate` **不受覆寫影響**，一律用基準 `radius`（它是座標→地址的對照，不是設施圖層）。
> - 多邊形**包含判定**模式不支援 `categories`（邊界就是範圍，沒有「從中心放大」的語意），同時給會回 `400`；改用下面的「方式三」就可以。

**方式二：多邊形（包含判定）**

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `poly` | string | ✅ | GET 專用：`"lon,lat;lon,lat;lon,lat"`，至少 3 點 |
| `polygon` | GeoJSON Polygon \| `[lon, lat][]` | ✅ | POST 用：GeoJSON `{type:"Polygon",coordinates:[ring]}` 或裸環陣列 |

> 多邊形不需自己閉合（首尾點相同），後端會補齊；距離一律量到**多邊形形心**。
> **經緯順序是 `[lon, lat]`（經度在前）**，與其他 API 的 `{lat, lng}` 相反。

**方式三：多邊形 + 半徑（多邊形只用來取中心）**

把方式二的 `polygon`／`poly` 跟方式一的 `radius`（＋ `categories`）一起帶：多邊形**只負責提供圓心**
（它的幾何重心），成員判定仍是逐類半徑。`area.kind` 回 `"radius"` 並標 `centerFrom: "polygon"`。

這是表一勘查表的流程——勘查標準講的是逐類半徑（站牌 800m、交流道 4000m），
區段邊界內有幾個設施是地籍事實，不是勘查範圍。

**`point`（第二量測點，三種方式都可加）**

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `point` | `[lon, lat]` \| `"lon,lat"` | ⬜ | 第二個量測點（表一流程裡就是「地點／比準地」） |
| `pointLon` / `pointLat` | number | ⬜ | 同上，分開兩欄的寫法 |

> `point` **只讓每筆設施多回一個 `metersToPoint`，完全不影響查得到哪些設施**——範圍是 area 自己的事。
> 排序與 `nearest` 一律仍以 `metersToCenter` 為準；要「離 point 最近」的那筆由呼叫端自己挑。

```http
GET {{FACILITIES_URL}}?lon=121.63575&lat=25.2219&radius=600
```

```http
POST {{FACILITIES_URL}}
Content-Type: application/json

{ "center": [121.63575, 25.2219], "radius": 600 }
```

多邊形取中心 + 第二量測點（表一勘查表的呼叫方式）：

```http
POST {{FACILITIES_URL}}
Content-Type: application/json

{
  "polygon": [
    [121.6342, 25.2232], [121.6372, 25.2232],
    [121.6372, 25.2206], [121.6342, 25.2206]
  ],
  "radius": 600,
  "cats": "bus_stop:800;education:1000;cemetery:2000",
  "point": [121.63575, 25.2219]
}
```

### Response `200`

```typescript
type FacilitiesResponse = {
  area: {
    kind: "radius" | "polygon";           // polygon + radius 解析成 "radius"
    center: { lon: number; lat: number }; // polygon 模式為形心
    centerFrom?: "polygon";               // center 由多邊形形心推導（polygon + radius）
    point?: { lon: number; lat: number }; // 第二量測點，原樣回拋
    radiusMeters?: number;                // 基準半徑（僅 radius 模式）
    maxRadiusMeters?: number;             // 本次實際查到的最遠半徑（僅 radius 模式）
    categoryRadii?: Record<string, number>; // 逐類實際套用的半徑，只列有覆寫的（僅 radius 模式）
  };
  /** 扁平清單，已去重並依 metersToCenter 由近到遠排序 — 給地圖圖層用 */
  facilities: FacilityHit[];
  /** 同一批設施依 6 大類彙整 — 給報告 UI 用，前端不需再分群 */
  byCategory: Record<FacilityGroup, GroupSummary>;
  doorplate: {
    count: number;                        // 範圍內門牌總數
    nearest: Array<{                      // 最近的 5 筆
      address: string;
      lon: number;
      lat: number;
      metersToCenter: number;
      metersToPoint?: number;
    }>;
  };
};

type FacilityHit = {
  kind: string;            // 中文類別，如 "公車站"、"公園"、"殯葬設施"
  category?: string;       // 穩定英文鍵（POI / NLSC 才有；車站類無）
  name: string | null;     // 設施名稱，資料缺漏時為 null
  lon: number;
  lat: number;
  metersToCenter: number;  // 到 area.center 的直線距離（公尺，四捨五入至整數）
  metersToPoint?: number;  // 到 area.point 的直線距離；沒帶 point 就不輸出（缺值 ≠ 0）
};

type FacilityGroup = "交通" | "公共設施" | "公共建設" | "特殊設施" | "工商活動" | "其他";

type GroupSummary = {
  count: number;
  // 「最近」一律以 metersToCenter 為準，與 items 的排序一致
  nearest: {
    kind: string;
    name: string | null;
    metersToCenter: number;
    metersToPoint?: number;
  } | null;
  items: FacilityHit[];    // 已依 metersToCenter 排序
};
```

**`category` → `kind` 對照**

| 分群 | `category`（`kind`） |
|------|----------------------|
| 交通 | `motorway_junction`（交流道）、`settlement`（聚落）、＋車站類（捷運站/高鐵站/公車站，無 category） |
| 公共設施 | `market`（市場）、`park`（公園）、`education`（文教設施）、`medical`（醫療設施） |
| 公共建設 | `tourism`（觀光設施）、`parking`（停車場）、`wastewater`（污廢水處理設施） |
| 特殊設施 | `substation`（變電所）、`power_tower`（高壓電塔）、`gas_storage`（儲氣/儲油槽）、`waste`（垃圾/焚化設施）、`cemetery`（殯葬設施）、`crematorium`（火葬場）、`fuel`（加油站） |
| 工商活動 | `department_store`（百貨公司）、`bank`（金融機構）、`entertainment`（娛樂設施）、`hotel`（觀光飯店） |
| 其他 | 未對應到上述的 category（原樣回傳，不會消失） |

> `education` / `medical` / `cemetery` / `fuel` 來自 NLSC 即時 API；該 API 逾時或失敗時
> 會**靜默略過該類**（不會讓整支 API 失敗），所以這幾類偶爾可能為空。
>
> 這四類同樣吃 `radius` / `categories`：說 300m 就是 300m，不再有內建下限
> （舊版對這幾類有 800~1000m 的隱藏下限，`radius=600` 也會回 900m 外的設施）。
> 需要更大範圍請顯式覆寫，例如 `cats=medical:1000;education:800`。

**範例回應**（`?lon=121.63575&lat=25.2219&radius=600`，節錄）

```json
{
  "area": { "kind": "radius", "center": { "lon": 121.63575, "lat": 25.2219 }, "radiusMeters": 600 },
  "facilities": [
    { "kind": "停車場", "category": "parking", "name": null,
      "lon": 121.6355281, "lat": 25.2219175, "metersToCenter": 22 },
    { "kind": "文教設施", "category": "education", "name": "新北市私立天仁幼兒園",
      "lon": 121.635661, "lat": 25.221675, "metersToCenter": 27 }
  ],
  "byCategory": {
    "交通": {
      "count": 25,
      "nearest": { "kind": "公車站", "name": "金山區公所", "metersToCenter": 87 },
      "items": [
        { "kind": "公車站", "name": "金山區公所",
          "lon": 121.636495, "lat": 25.222305, "metersToCenter": 87 }
      ]
    },
    "公共設施": { "count": 0, "nearest": null, "items": [] }
  },
  "doorplate": {
    "count": 5265,
    "nearest": [
      { "address": "中正路２５號", "lon": 121.6359081, "lat": 25.2218892, "metersToCenter": 16 }
    ]
  }
}
```

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"Provide either a polygon (polygon/poly) or a center + radius (center/lon+lat, radius)."}` | 兩種範圍都沒給 |
| `400` | `{"error":"radius must be a positive number of meters."}` / `"radius must be <= 20000 meters."` | 半徑非正數或超過上限 |
| `400` | `{"error":"categories[\"xxx\"].radius must be a positive number of meters."}` | 逐類半徑非正數或超過上限 |
| `400` | `{"error":"Unknown category: \"xxx\". Valid values: ..."}` | 類別名稱打錯（含 `其他`） |
| `400` | `{"error":"categories[] (per-category radius) is only supported with a center + radius, not a polygon."}` | 多邊形模式帶了 `categories` |
| `400` | `{"error":"Coordinate out of range: [x, y]."}` | 經緯度超出 ±180 / ±90（常見於經緯寫反） |
| `400` | `{"error":"A polygon needs at least 3 points."}` | 多邊形點數不足 |
| `400` | `{"error":"Request body is not valid JSON."}` | POST body 非合法 JSON 物件 |
| `502` | `{"error":"query failed: <原因>"}` | 資料庫查詢失敗 |

---

## B · district-survey-draft — 表一單類草稿產製

用 Bedrock 產出表一**其中一個大類**的內容草稿。給了 `facts`（A 的回傳）就以實際查到的
周邊設施為依據；沒給就讓模型依情境編一份可編輯的草稿。

| | |
|--|--|
| **Endpoint** | `{{DISTRICT_SURVEY_DRAFT_URL}}` — `NtlandBedrockStack` / `DistrictSurveyDraftFunctionUrl` |
| **Method** | `POST`（JSON body）；亦支援 `GET ?category=`（但無法帶 `facts`） |
| **正式流程** | ⬜ 選用。`produce-survey` 內部會並行打 8 類；單獨呼叫用於檢視某一類草稿 |
| **耗時** | 一次 Bedrock，約 5–15 秒（Lambda timeout 120s） |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `category` | `CategoryName` | ✅ | 要產的大類。body 的值優先於 `?category=` |
| `facts` | `FacilitiesResponse` | ⬜ | [A](#a--facilities--周邊設施查詢) 的回傳。給了才是「有根據的草稿」。實際只讀 `byCategory` 與 `facilities` 兩個欄位（整包丟進來也可以，多的會被忽略），非物件一律視為沒給 |

`CategoryName`（8 類，**一次只能打一類**）：

```
landImprovement        土地改良        specialFacilities       特殊設施
commercialActivity     工商活動        landUseRegulation       土地使用管制
trafficAndTransport    交通運輸        publicInfrastructure    公共建設
environmentalPollution 環境污染        naturalConditions       自然條件
```

```http
POST {{DISTRICT_SURVEY_DRAFT_URL}}
Content-Type: application/json

{ "category": "trafficAndTransport", "facts": { /* A 的完整回傳 */ } }
```

### Response `200`

```typescript
type DistrictSurveyDraftResponse = {
  category: CategoryName;
  /** 該類的 content tree（分類巢狀、每格 { raw, value }）。schema 依 category 而異。 */
  content: Record<string, unknown>;
  /** true = 這類確實吃到 facts 裡的設施；false = facts 沒有這類可用事實，內容為模型編造 */
  usedFacts: boolean;
};
```

**範例回應**（`trafficAndTransport`，節錄）

```json
{
  "category": "trafficAndTransport",
  "usedFacts": true,
  "content": {
    "mainRoad": {
      "raw": "主要道路",
      "value": { "type": "measurement", "raw": "中正路 10 M", "label": "中正路", "value": 10, "unit": "M" }
    },
    "averageRoadWidthInSection": {
      "raw": "區段內道路平均寬度",
      "value": { "type": "number", "raw": "8 M", "value": 8, "unit": "M" }
    },
    "majorStation": {
      "raw": "大型車站",
      "items": [
        { "raw": "無高鐵站",
          "value": { "type": "majorStationFacility", "raw": "○無高鐵站 ○本區段內 ○本區段外(距 M)",
                     "name": "無高鐵站", "isExist": false } }
      ]
    }
  }
}
```

> `usedFacts: false` 代表這一類沒有事實依據，內容是模型生成的示意草稿，**務必由估價師覆核**。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"Missing \"category\". ..."}` | 沒帶 category |
| `400` | `{"error":"Unknown category \"xxx\". Expected one of: ..."}` | category 不在 8 類內 |
| `502` | `{"error":"<Bedrock 錯誤訊息>"}` | 模型呼叫失敗 |

---

## Bp · produce-survey — 表一草稿產製（正式入口）

**表一的實際入口**：給區段編號 + 比準地座標，內部自動查周邊設施、產 8 類草稿，
攤平組成前端要吃的 `SurveyField[]`，另附由勘查事實連動推導的 `benchmark`。

| | |
|--|--|
| **Endpoint** | `{{PRODUCE_SURVEY_URL}}` — `NtlandBedrockStack` / `ProduceSurveyFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ★ 正式 |
| **耗時** | 實測約 10–20 秒（先查設施，再 8 次 Bedrock 並行）。Lambda timeout 60 秒 |
| **內部呼叫** | **序列**：`FACILITIES_URL`（範圍由本支的 `facilities` 參數決定，10s）→ 把結果當 `facts` 轉發給 `DISTRICT_SURVEY_DRAFT_URL` × 8（並行，各 45s） |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `sectionId` | string | ✅ | 區段編號，如 `"P002-00"`。亦可用 `?sectionId=` |
| `benchmarkLocation` | `{ lat, lng }` | ⬜ | **地點**（比準地）座標。設施的 `metersToPoint` 量到這一點。缺這個又沒帶 `sectionPolygon` 就查不到周邊設施，設施類欄位全部降級為需人工。亦可用 `?lat=&lng=` |
| `sectionPolygon` | `{ lat, lng }[]` | ⬜ | **區段範圍多邊形**（至少 3 點，閉合與否皆可）。帶了它，設施查詢的圓心改成此多邊形的幾何重心，設施因此同時回兩個距離。僅 body 支援 |
| `facilities.radius` | number | ⬜ | 周邊設施的基準半徑，預設 `600`。亦可用 `?facilityRadius=` |
| `facilities.categories` | `{category, radius}[]` \| string | ⬜ | 逐類覆寫半徑，原樣轉給 [A](#a--facilities--周邊設施查詢) 的 `cats`。亦可用 `?cats=` |

> 這裡是 `{ lat, lng }`（緯度在前、欄名 `lng`），與 [A](#a--facilities--周邊設施查詢) 的 `[lon, lat]` 不同。
>
> **半徑標準由呼叫端帶，本支不內建任何一套。** 站牌 800m、交流道 4000m 這類級距屬業務規則，
> 會隨勘查標準調整；寫死在 Lambda 等於每次改標準都要重新部署。前端的標準表在
> `frontend/src/lib/facilityRadiusStandards.ts`（區域因素／個別因素兩套），
> 對照表見 [A](#a--facilities--周邊設施查詢) 的「目前 demo 採用的半徑標準」。
> 不帶 `facilities.categories` 時所有類別一律用基準半徑。

**前端的呼叫方式：polygon + point + range 一起帶**

```
input  polygon（區段範圍）+ point（地點／比準地）+ range（逐類半徑）
  ↓    圓心取 polygon 的幾何重心，以 range 逐類查設施（不是取 polygon 範圍內的設施）
out    metersToCenter → 到區段中心（表二 grading 用）
       metersToPoint  → 到 point（表三 grading 用）
```

| 距離 | 基準點 | 誰用 | 為什麼 |
| ---- | ------ | ---- | ------ |
| `metersToCenter` | 區段多邊形的幾何重心 | **表二**（[C2 · regional-factor-grading](#c2--regional-factor-grading--區域因素評分表二)） | 區域因素評的是整個地價區段的條件 |
| `metersToPoint` | 地點（比準地） | **表三**（[individual-factor-grading](#individual-factor-grading--個別因素評分)） | 個別因素評的是這一筆宗地自己 |

> 內部會把 `sectionPolygon` 轉成 `[lon, lat][]` 並以 **POST** 打 [A](#a--facilities--周邊設施查詢)
> （`polygon` + `radius` + `cats` + `point`）；區段 ring 動輒上百點，塞 query string 會撞長度上限。
> 沒帶 `sectionPolygon` 時維持原本的 GET `?lon=&lat=&radius=&cats=`（圓心＝比準地，兩個距離相同，
> 只輸出 `metersToCenter`）。

```http
POST {{PRODUCE_SURVEY_URL}}
Content-Type: application/json

{
  "sectionId": "P002-00",
  "benchmarkLocation": { "lat": 25.2219, "lng": 121.63575 },
  "sectionPolygon": [
    { "lat": 25.2232, "lng": 121.6342 },
    { "lat": 25.2232, "lng": 121.6372 },
    { "lat": 25.2206, "lng": 121.6372 },
    { "lat": 25.2206, "lng": 121.6342 }
  ],
  "facilities": {
    "radius": 600,
    "categories": [
      { "category": "metro", "radius": 2000 },
      { "category": "bus_stop", "radius": 800 },
      { "category": "motorway_junction", "radius": 4000 }
    ]
  }
}
```

### Response `200`

```typescript
type ProduceSurveyResponse = {
  meta: CaseMeta;                 // 見「附錄 B · 共用型別」
  survey: SurveyField[];          // 表一全欄位目錄（60 欄，固定順序）
  benchmark: ComparisonCondition; // 表三比準地宗地條件（由 survey 連動推導）
};
```

行為要點：

- **一律回傳完整欄位目錄**，不是只回查得到的欄位。查得到 → `source: "ai"`；
  查不到 → `source: "empty"`、`value: ""`、`origin: "AI 查無資料，需人工現場確認"`。
- **上游失敗不會讓整支 502**：facilities 掛掉 → 設施類欄位降級為 `empty`；
  某一類 draft 掛掉 → 該類欄位加上 `warning: "AI 產草稿失敗（<類別>）：需人工確認"`。
- 設施類欄位（`school` / `park` / `parking` / `financial_institution` / `cemetery` / `bus_stop`
  —— 對照表在 `mapToSurvey.ts` 的 `SURVEY_FACILITY_KIND`，就這 6 個）
  由 facilities 實測距離填寫，格式為 `名稱，距NNNM`（多筆以 `；` 串接），並附 `items[]` 與 `reference`。
  這類欄位**不會被 draft 覆蓋**（實測距離優先於模型草稿）。其他類別（交流道、聚落…）查到的設施
  不會直接寫進欄位，而是當 `facts` 餵給 [B](#b--district-survey-draft--表一單類草稿產製) 產草稿。
- **兩個距離**（帶了 `sectionPolygon`，即區段中心 ≠ 地點時）：
  - `items[]` 每筆帶 `metersToCenter` ＋ `metersToPoint`，**依 `metersToCenter` 排序**（這份表描述的是區段）。
  - `value` 以**純附加**方式寫兩個：`"金山國小，距150M（距比準地210M）"`。括號前是距區段中心、
    括號裡是距比準地。基準形 `名稱，距NNNM` 原封不動，所以既有「抓第一個 `距NNNM`」的解析
    （表一列印、表三連動、表二級距查表）行為完全不變。
  - `origin`／`reference` 同時報兩個：`"…共2筆，最近距區段中心80m、距比準地520m"`、
    `measurement: "直線距離（距區段中心／距比準地）"`。
  - `benchmark.{school,market,park,station,disamenity}Distance` 取**距比準地**，而且挑的是
    **離比準地最近**的那一筆，不是 `items[0]`（那是離區段中心最近的）——表三評的是這一筆宗地，
    區段中心旁的學校未必是宗地旁的學校。
  - 沒帶 `sectionPolygon` 時（圓心＝比準地）兩個距離相同，**不輸出** `metersToPoint`、`value`
    維持舊格式，`benchmark` 的挑法退化成 `items[0]`——行為與改動前一致。
- `meta.sectionPolygon` 原樣回拋請求帶的區段多邊形（`metersToCenter` 的基準點就是它的幾何重心），
  存表一時一起進 `case_survey.meta`，兩個距離事後才可驗、可重算。
- `reference` 裡寫的半徑是**該類別實際套用的半徑**（`area.categoryRadii[該類] ?? area.radiusMeters`），
  不是基準半徑 —— 嫌惡設施查 2000m 就會寫「半徑2000m內」。下面範例的 `半徑600m` 是沒帶
  `facilities.categories` 時的樣子。
- **draft 只採信有事實依據的草稿**：facilities 的結果會當 `facts` 轉發給 [B](#b--district-survey-draft--表一單類草稿產製)，
  B 回的 `usedFacts` 為 `false`（該類查無周邊設施，或 facilities 整支失敗）代表內容是模型憑空編的
  → **不寫進 `value`**，欄位維持 `source: "empty"`，只加
  `warning: "AI 草稿未依實測事實（<類別>）：需人工確認"`。
  > `landUseRegulation` / `naturalConditions` / `landImprovement` 這 3 類在 B 沒有對應的設施可餵，
  > `usedFacts` 恆為 `false`，所以它們的 15 個欄位目前一定是 `empty` + `warning`，由估價師填。
- draft 值的來源是**逐欄位寫死的對照表**（`produce-survey/draftFieldMap.ts`），不是靠欄位名猜。
  B 的 content 是 camelCase + 巢狀 `{ raw, value: { type, … } }`，與表一的 snake_case key 對不上，
  對照表把 56 欄各自指到 content 的哪一格，`reference.derivation` 會標出來源路徑
  （如 `← content.majorStation.items[0]`）以便回溯。剩下 4 欄（`building_density` /
  `building_type` / `land_use_status` / `other_factors`）draft 無對應，恆為 `empty`。
- `meta` 只推得出 `sectionId` / `surveyDate`（今日民國年）/ `location` / `sectionPolygon`，
  其餘（`yearPeriod` / `district` / `landUseType` / `benchmarkParcel`）回空字串，**由前端或估價師補**。
- `benchmark` 由這些 survey 欄位連動推導：`school` `market` `park` `bus_stop` `cemetery`
  `road_avg_width` `terrain` `zone_type` `coverage_ratio` `plot_ratio` `build_restriction`；
  其餘欄位（面積/寬度/深度/形狀…）為空字串，需人工補。

**範例回應**（節錄）

```json
{
  "meta": {
    "yearPeriod": "",
    "sectionId": "P002-00",
    "district": "",
    "landUseType": "",
    "benchmarkParcel": "",
    "surveyDate": "115年09月11日",
    "location": { "lat": 25.2219, "lng": 121.63575 },
    "sectionPolygon": [
      { "lat": 25.2232, "lng": 121.6342 },
      { "lat": 25.2232, "lng": 121.6372 },
      { "lat": 25.2206, "lng": 121.6372 },
      { "lat": 25.2206, "lng": 121.6342 }
    ]
  },
  "survey": [
    {
      "key": "urban_plan",
      "label": "都市計畫(內外)",
      "group": "土地使用管制",
      "value": "",
      "source": "empty",
      "origin": "AI 草稿未依實測事實，需人工現場確認",
      "warning": "AI 草稿未依實測事實（土地使用管制）：需人工確認",
      "options": ["都市計畫內", "都市計畫外"]
    },
    {
      "key": "main_road",
      "label": "主要道路",
      "group": "交通運輸",
      "value": "中正路 10 M",
      "source": "ai",
      "origin": "AI 產草稿｜交通運輸",
      "reference": {
        "dataSource": "AI 查詢｜地價區段草稿產製（district-survey-draft）",
        "derivation": "AI 產「交通運輸」類草稿（依周邊設施實測事實），對應欄位「主要道路」← content.mainRoad",
        "rawFact": "中正路 10 M"
      }
    },
    {
      "key": "school",
      "label": "接近學校之程度（國小/國中/高中/大專院校）",
      "group": "公共建設",
      "value": "金山國小，距150M（距比準地210M）",
      "source": "ai",
      "origin": "AI 查詢｜周邊設施查詢 API｜共1筆，最近距區段中心150m、距比準地210m",
      "items": [{ "name": "金山國小", "metersToCenter": 150, "metersToPoint": 210 }],
      "reference": {
        "dataSource": "AI 查詢｜周邊設施查詢 API｜半徑600m",
        "measurement": "直線距離（距區段中心／距比準地）",
        "derivation": "AI 於半徑600m內查得文教設施共1筆，最近：金山國小 距區段中心150m、距比準地210m",
        "rawFact": "金山國小，距150M（距比準地210M）"
      }
    }
  ],
  "benchmark": {
    "location": "",
    "area": "",
    "schoolName": "金山國小",
    "schoolDistance": "210",
    "sectionId": "P002-00",
    "…": "…"
  }
}
```

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"Invalid request: sectionId is required (body or ?sectionId=)."}` | 缺 sectionId 或 body 非合法 JSON |
| `405` | `{"error":"Method GET not allowed."}` | 非 POST |
| `502` | 純文字 `Internal Server Error` | Lambda 逾時／冷啟動（見「共通規格」）→ 重試 |

---

## Be · 估價師編輯表一（無 API）

**這一步沒有後端 API，但它是正式流程的關鍵一環。**

Bp 產出的是草稿：AI 只填得出設施類欄位（`source: "ai"`），其餘多數為 `source: "empty"`。
正式流程是估價師在前端畫面上把空欄逐一補齊、按確認，產生**表一定稿**：

- 人工補的欄位：`source` 改為 `"edited"`（或 `"manual"`）
- 確認 AI 值的欄位：`source` 改為 `"confirmed"`

下游的 [D1](#d--case-store--案件與三表定稿儲存) / [C2](#c2--regional-factor-grading--區域因素評分表二) /
[E0](#e0--produce-regional-factors--表二產製正式入口) / [E](#e--produce-comparison--表三產製正式入口) /
[Hx](#hx--export-report--報告匯出正式入口) **全部吃這份定稿**。

> ⚠️ **survey 越完整，表二評出的項目越多**：評分只根據「有事實的欄位」，空欄不評。
> 實測：精簡 12 欄 → 表二只評出 5 項；完整定稿 → 28 項。

---

## D · case-store — 案件與三表定稿儲存

單一 Function URL，用 **HTTP method + `?form=`** 路由。只負責存取使用者確認過的定稿，
**不做任何計算**（計算在 produce-* 系列）。

| | |
|--|--|
| **Endpoint** | `{{CASE_STORE_URL}}` — `NtlandBedrockStack` / `CaseStoreFunctionUrl` |
| **正式流程** | ★ 正式（D0 建案、D1/D2/D3 存三表定稿） |
| **耗時** | < 1 秒（Aurora Data API；Lambda timeout 30s） |

### 路由總表

| 步驟 | Method | Query | Body | 回應 |
|------|--------|-------|------|------|
| **D0** | `POST` | （無） | `{ sectionId, meta? }` | `201` `CaseSummary` |
| **D1** | `POST` \| `PUT` | `?form=survey` | `{ caseId, survey, benchmark }` | `200` `{ caseId, form, status }` |
| **D2** | `POST` \| `PUT` | `?form=regional-factors` | `{ caseId, regionalFactors, regionalTotal?, remarks? }` | `200` `{ caseId, form, status }` |
| **D3** | `POST` \| `PUT` | `?form=comparison` | `{ caseId, comparison, comparisonForm, computed? }` | `200` `{ caseId, form, status }` |
| — | `POST` \| `PUT` | `?form=comparison-survey` | `{ caseId, targetIndex, survey, benchmark }` | `200` `{ caseId, form, targetIndex }` |
| — | `PATCH` | `?caseId=` | `{ sectionId?, meta? }` | `200` `CaseSummary` |
| — | `GET` | （無） | — | `200` `CaseSummary[]`（全部案件） |
| — | `GET` | `?caseId=` | — | `200` `CaseBundle` |
| — | `GET` | `?sectionId=` | — | `200` `CaseSummary[]` |
| — | `GET` | `?form=survey&caseId=` | — | `200` `SurveyFinal` |
| — | `GET` | `?form=regional-factors&caseId=` | — | `200` `RegionalFactorsFinal` |
| — | `GET` | `?form=comparison&caseId=` | — | `200` `ComparisonFinal` |
| — | `GET` | `?form=comparison-survey&caseId=` | — | `200` `{ caseId, comparisonSurveys[] }` |
| — | `GET` | `?form=comparison-survey&caseId=&targetIndex=` | — | `200` `{ caseId, targetIndex, survey, benchmark }` |

> **沒有 delete 路由**，任何 `DELETE` 一律 `405`。`PATCH` 也**不會動 `status`** —
> 案件狀態只由下面的三表定稿寫入連動。

寫入都是 upsert（同一 `caseId` 重複寫會覆蓋），並連動更新案件狀態：

```
draft ──D1──> survey_done ──D2──> regional_done ──D3──> comparison_done
```

### D0 · 建立案件

```http
POST {{CASE_STORE_URL}}
Content-Type: application/json

{ "sectionId": "P002-00", "meta": { /* Bp 回的 meta，經估價師補齊 */ } }
```

```typescript
type CaseSummary = {
  caseId: string;      // 自動產生，如 "case_06G92KD3002W1YJP6ZPT5C4KVV"
  sectionId: string;
  status: "draft" | "survey_done" | "regional_done" | "comparison_done";
  meta: CaseMeta | null;
  createdAt: string;   // ISO 8601
  updatedAt: string;
};
```

**回應 `201`**

```json
{
  "caseId": "case_06G92KD3002W1YJP6ZPT5C4KVV",
  "sectionId": "P002-00",
  "status": "draft",
  "meta": { "sectionId": "P002-00", "surveyDate": "115年09月11日",
            "location": { "lat": 25.2219, "lng": 121.63575 }, "…": "…" },
  "createdAt": "2026-09-11T16:29:39.751Z",
  "updatedAt": "2026-09-11T16:29:39.751Z"
}
```

> `caseId` 之後所有 `?form=` 寫入、[image-upload](#g--image-upload--案件圖片上傳列表)、
> [export-report](#hx--export-report--報告匯出正式入口) 都會用到。

### D1 · 存表一定稿

```http
POST {{CASE_STORE_URL}}?form=survey
Content-Type: application/json

{ "caseId": "case_…", "survey": [ /* SurveyField[]，估價師定稿 */ ],
  "benchmark": { /* ComparisonCondition */ },
  "district": "金山區", "section": "金美段", "sectno": "1027", "parcelNo": "489",
  "lat": 25.2231, "lng": 121.6389, "areaM2": 330.5 }
```

`survey`（陣列）與 `benchmark`（物件）皆必填。回 `{ "caseId": "…", "form": "survey", "status": "survey_done" }`。

#### 宗地身分欄（選填，`?form=survey` 與 `?form=comparison-survey` 共用）

表一勘查的對象就是一筆宗地，所以**宗地和比較標的用同一份格式**；分別是案件的事，由路由
（`?form=survey` / `?form=comparison-survey`）決定。兩者都接受這組選填欄位：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `district` | string | 行政區，如 `"金山區"` |
| `section` | string | 段名含小段，如 `"金美段"` |
| `sectno` | string | 段代碼，如 `"1027"`（可 join `land_section` / `land_parcel`） |
| `parcelNo` | string | 地號原樣，如 `"489"` / `"31-1"` |
| `lat` / `lng` | number | 座標。**必須成對給**，只給一個回 `400`；範圍分別是 ±90 / ±180 |
| `areaM2` | number | 面積（㎡），必須為正數 |

> ⚠️ **定位一筆宗地要 `district` + `section` + `parcelNo` 三個一起**。地號在同一個行政區內
> **不唯一** —— 不同段可以有相同地號，少了 `section` 會撈到別筆地。

**這組欄位對齊前端的定位流程**：

```
前端輸入 district + section + 地號
  └─> land-easymap  →  center.lat/lng、fields.areaM2、resolved.sectno
        └─> 存表一時一起帶上（?form=survey 或 ?form=comparison-survey）
```

沒帶就存 null，不會擋 —— 定位失敗（上游 `center` 為 null、或私有地查無資料）的標的仍要能存表一。

這些欄位會原樣出現在 `GET ?form=survey` / `?form=comparison-survey` 的回應裡（值為 null
的欄位不出現）。要拿歷史表一當新案的比較標的時，`lat`/`lng` 可以直接餵進
`produce-comparison` 的 `comparisonSurveys[].lat/lng`。

> `areaM2` 是上游的權威面積，跟 `benchmark.area`（估價師可改的顯示值）**不是同一個東西**，
> 所以分開存，不要互相覆蓋。
>
> 這組欄位是 2026-09 合表時補的（原本比較標的完全沒地方存座標）。
> 合表 migration 見 `infra/README.md`「case_survey 合表 + 宗地身分欄」。

### D2 · 存表二定稿

```http
POST {{CASE_STORE_URL}}?form=regional-factors
Content-Type: application/json

{ "caseId": "case_…", "regionalFactors": [ /* RegionalFactorRow[] */ ],
  "regionalTotal": 0,
  "remarks": { "subject": "", "cases": "", "overall": "" } }
```

`regionalFactors`（陣列）必填；`regionalTotal`（數字或數字字串）、`remarks` 可省略（存 null）。

### D3 · 存表三定稿

```http
POST {{CASE_STORE_URL}}?form=comparison
Content-Type: application/json

{ "caseId": "case_…", "comparison": [ /* FactorRow[] */ ],
  "comparisonForm": { /* ComparisonForm */ }, "computed": { /* ComputedSummary */ } }
```

`comparison`（陣列）與 `comparisonForm`（物件）必填；`computed` 可省略。

### `?form=comparison-survey` · 各比較標的自己的表一

跟 D1 存的是**同一張表、同一份格式**，只差這筆勘查在本案裡的角色；每個比較標的各存一份，
以 `(caseId, "comparison", targetIndex)` 為主鍵。

```http
POST {{CASE_STORE_URL}}?form=comparison-survey
{ "caseId": "case_…", "targetIndex": 0, "survey": [ … ], "benchmark": { … },
  "district": "金山區", "section": "金美段", "sectno": "1027", "parcelNo": "489",
  "lat": 25.2231, "lng": 121.6389, "areaM2": 330.5 }
```

`targetIndex` 必須是 **≥ 0 的整數**，對齊表四/表五的 `caseNo = targetIndex + 1`。
宗地身分欄（`district` / `section` / `sectno` / `parcelNo` / `lat` / `lng` / `areaM2`）
與 D1 完全相同，見上節。

### PATCH · 更新案件 metadata

局部更新 `appraisal_case` 的 `sectionId` / `meta`，回更新後的 `CaseSummary`。

```http
PATCH {{CASE_STORE_URL}}?caseId=case_…
Content-Type: application/json

{ "meta": { "surveyDate": "115年09月12日", "…": "…" } }
```

**只有 body 裡實際出現的欄位會被寫入**：

| body | 效果 |
|------|------|
| `{ "sectionId": "P003-00" }` | 只改段號，`meta` 不動 |
| `{ "meta": { … } }` | 整包覆蓋 `meta`（不是深層 merge），`sectionId` 不動 |
| `{ "meta": null }` | 清空 `meta` |
| `{}` | `400` —— 沒有可更新的欄位 |

`status` **不可 PATCH**（demo 階段狀態只由三表定稿寫入連動）；送了也會被忽略，
只送 `status` 一個欄位則視同空 body 回 `400`。

### GET · 讀回

```http
GET {{CASE_STORE_URL}}                    # 全部案件（依建立時間新到舊，不分頁）
GET {{CASE_STORE_URL}}?caseId=case_…      # 單一案件完整 bundle
GET {{CASE_STORE_URL}}?sectionId=P002-00  # 某區段所有案件（依建立時間新到舊）
GET {{CASE_STORE_URL}}?form=comparison-survey&caseId=case_…
```

```typescript
type CaseBundle = CaseSummary & {
  /** 表一定稿 + 宗地身分欄（district/section/sectno/parcelNo/lat/lng/areaM2，值為 null 的不出現） */
  surveyFinal?: SurveyFinal;
  regionalFactorsFinal?: RegionalFactorsFinal;  // { regionalFactors, regionalTotal, remarks }
  comparisonFinal?: ComparisonFinal;            // { comparison, comparisonForm, computed }
};
```

完整定義見[附錄 B](#附錄-b--共用型別)。

> 三個 `*Final` **只有存過才會出現**，沒存過就整個欄位不存在（不是 null）。

#### 單張定稿讀回

編輯單一表時不必整包 bundle 拉下來，可以只取那一張：

```http
GET {{CASE_STORE_URL}}?form=survey&caseId=case_…            # -> SurveyFinal
GET {{CASE_STORE_URL}}?form=regional-factors&caseId=case_…  # -> RegionalFactorsFinal
GET {{CASE_STORE_URL}}?form=comparison&caseId=case_…        # -> ComparisonFinal
GET {{CASE_STORE_URL}}?form=comparison-survey&caseId=case_…&targetIndex=0
```

回的就是 bundle 裡對應 `*Final` 的那個物件本身（沒有外層包裝）。

> 語意差異：bundle 裡沒存過是「欄位不存在」，這裡沒存過是 **`404`**。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"sectionId (non-empty string) is required."}` | D0 缺 sectionId |
| `400` | `{"error":"caseId (non-empty string) is required."}` | 寫入缺 caseId |
| `400` | `{"error":"survey (array) is required."}` / `"benchmark (object) is required."` 等 | 必填欄位缺漏或型別不符 |
| `400` | `{"error":"Unknown ?form=xxx. Use survey \| comparison-survey \| regional-factors \| comparison, …"}` | form 值不合法 |
| `400` | `{"error":"GET ?form=survey requires ?caseId=."}` | 讀單張定稿沒帶 caseId |
| `400` | `{"error":"PATCH requires ?caseId=."}` | PATCH 沒帶 caseId |
| `400` | `{"error":"Nothing to patch. Send sectionId and/or meta (status is not patchable)."}` | PATCH body 沒有可更新欄位 |
| `400` | `{"error":"meta must be an object or null."}` / `"sectionId must be a non-empty string."` | PATCH 欄位型別不符 |
| `400` | `{"error":"targetIndex must be a non-negative integer."}` | `?targetIndex=` 不是非負整數 |
| `404` | `{"error":"No case with caseId=…"}` | caseId 不存在 |
| `404` | `{"error":"No survey 定稿 for caseId=…"}`（regional-factors / comparison 同款） | 單張定稿還沒存過 |
| `404` | `{"error":"No comparison-survey 定稿 for caseId=…, targetIndex=0."}` | 該比較標的的表一還沒存過 |
| `405` | `{"error":"Method DELETE not allowed."}` | 不支援的 method（本 API 無刪除路由） |
| `502` | `{"error":"case-store failed: <原因>"}` | 資料庫失敗 |

---

## C1 · factor-standard-extract — 評價基準明細表數位化

把「地價區段評價基準明細表」PDF 丟給 Bedrock，抽成結構化的評分基準 JSON
（區域因素 + 個別因素的各項目、等級、修正點數、判定條件）。

| | |
|--|--|
| **Endpoint** | `{{FACTOR_STANDARD_EXTRACT_URL}}` — `NtlandBedrockStack` / `FactorStandardFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ⬜ 選用。基準表不常變，只有要（重新）數位化時才打 |
| **耗時** | 數十秒（一次帶 PDF 的 Bedrock 呼叫；Lambda timeout 120s、memory 1024MB） |

### Request

body 二擇一：

| 形式 | 說明 |
|------|------|
| `{ "pdfBase64": "<base64>" }` | JSON 信封（推薦） |
| `<base64>` | 整個 body 就是 PDF 的 base64 字串（body 不以 `{` 開頭時走這條） |

```http
POST {{FACTOR_STANDARD_EXTRACT_URL}}
Content-Type: application/json

{ "pdfBase64": "JVBERi0xLjcKJc..." }
```

> base64 後的 PDF 通常數百 KB 到數 MB，走 HTTP body 即可；**用 CLI 測試時不要塞進命令列參數**
> （`argument list too long`），改從檔案讀。

### Response `200`

回傳的就是抽取結果本身（沒有外層信封）：

```typescript
type FactorStandardExtracted = {
  regionalFactors: FactorTree;    // 區域因素評價基準
  individualFactors: FactorTree;  // 個別因素評價基準
};

type FactorTree = {
  raw: string;                    // 中文標題，如 "區域因素"
  categories: Array<{
    key: string;                  // 英文分類鍵，如 "landUseRegulation"
    raw: string;                  // 中文分類名，如 "土地使用管制"
    items: Array<{
      key: string;                // 英文項目鍵，如 "insideOutsideUrbanPlan"
      raw: string;                // 中文項目名，如 "都市計畫內外"
      remarks?: string;           // 基準表上的說明
      grades: Array<{
        key: "superior" | "slightlySuperior" | "average" | "slightlyInferior" | "inferior";
        raw: string;              // "優" / "稍優" / "普通" / "稍劣" / "劣"
        value: number;            // 修正點數（≤ 0）
        criteria: { type: "enum" | "range" | …; raw: string; [k: string]: unknown };
      }>;
    }>;
  }>;
};
```

**範例回應**（節錄）

```json
{
  "regionalFactors": {
    "raw": "區域因素",
    "categories": [
      { "key": "landUseRegulation", "raw": "土地使用管制",
        "items": [
          { "key": "insideOutsideUrbanPlan", "raw": "都市計畫內外",
            "remarks": "以都市計畫內外來制定其優劣",
            "grades": [
              { "key": "superior", "raw": "優", "value": 0,
                "criteria": { "type": "enum", "raw": "都市計畫內", "value": "insideUrbanPlan" } },
              { "key": "inferior", "raw": "劣", "value": -20,
                "criteria": { "type": "enum", "raw": "都市計畫外", "value": "outsideUrbanPlan" } }
            ] }
        ] }
    ]
  },
  "individualFactors": { "raw": "個別因素", "categories": [ "…" ] }
}
```

> ⚠️ 目前 [C2](#c2--regional-factor-grading--區域因素評分表二) 與個別因素評分**使用內建（build 時 inline）的基準表**，
> 不吃這裡數位化的結果。C1/C1s 是為了「換一份基準表」預留的路徑，接線尚未完成。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"Missing request body: POST the base-standard PDF as base64."}` | 空 body |
| `400` | `{"error":"JSON body must contain a \"pdfBase64\" field."}` | JSON 信封缺欄位 |
| `502` | `{"error":"<Bedrock 錯誤訊息>"}` | 模型呼叫失敗 |

---

## C1s · factor-standard-store — 數位化結果存取

把 [C1](#c1--factor-standard-extract--評價基準明細表數位化) 的結果存起來（自動版本化），
之後可直接取用，不必重跑 Bedrock。原始 PDF 可一併上傳到 S3。

| | |
|--|--|
| **Endpoint** | `{{FACTOR_STANDARD_STORE_URL}}` — `NtlandBedrockStack` / `FactorStandardStoreFunctionUrl` |
| **Method** | `POST`（存）／`GET`（取、列） |
| **正式流程** | ⬜ 選用 |
| **耗時** | < 1 秒（Lambda timeout 30s） |

### POST · 存一筆

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `fileName` | string | ✅ | 檔名，**版本以此為單位**（同 fileName 再存一次 → version +1） |
| `extracted` | object | ✅ | C1 的抽取結果 |
| `label` | string | ⬜ | 自訂標籤，供列表過濾 |
| `pdfBase64` | string | ⬜ | 原始 PDF；會上傳到 `<S3_PREFIX>/<fileName>/v<version>.pdf` |
| `s3Key` | string | ⬜ | 已自行上傳過的 key（優先於 `pdfBase64`） |

```http
POST {{FACTOR_STANDARD_STORE_URL}}
Content-Type: application/json

{ "fileName": "評價基準明細表-金山.pdf", "extracted": { … }, "label": "金山" }
```

**回應 `200`**（`FactorStandardMeta`，不含 `extracted`）

```json
{ "id": 3, "fileName": "評價基準明細表-金山.pdf", "version": 1,
  "label": "金山", "s3Key": null, "createdAt": "2026-09-11T16:30:00.000Z" }
```

### GET · 取一筆 / 列清單

| 查詢 | 回應 |
|------|------|
| `?id=3` | `FactorStandardRecord`（含 `extracted`） |
| `?fileName=xxx.pdf` | 該檔**最新版本**的完整記錄 |
| `?fileName=xxx.pdf&version=2` | 指定版本的完整記錄 |
| `?fileName=xxx.pdf&list=1` | 該檔所有版本的 metadata 清單 |
| `?label=金山` / 無參數 | metadata 清單（依 fileName, version 排序，**不含 extracted**） |

```typescript
type FactorStandardMeta = {
  id: number; fileName: string; version: number;
  label: string | null; s3Key: string | null; createdAt: string;
};
type FactorStandardRecord = FactorStandardMeta & { extracted: FactorStandardExtracted };
```

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"fileName (non-empty string) is required."}` / `"extracted (the digitization result JSON) is required."` | POST 缺必填欄位 |
| `400` | `{"error":"id must be an integer."}` / `"version must be an integer."` | 查詢參數型別錯 |
| `404` | `{"error":"No factor_standard with id=…"}` / `"No factor_standard for fileName=… (latest)."` | 查無資料 |
| `405` | `{"error":"Method PUT not allowed."}` | 不支援的 method |
| `502` | `{"error":"factor-standard-store failed: <原因>"}` | 資料庫／S3 失敗 |

---

## C2 · regional-factor-grading — 區域因素評分（表二）

拿**一份**表一定稿去對評價基準明細表評分，回傳該宗地各區域因素項目的等級與修正點數。

| | |
|--|--|
| **Endpoint** | `{{REGIONAL_FACTOR_GRADING_URL}}` — `NtlandBedrockStack` / `RegionalFactorGradingFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ★ 正式（也是 [E0](#e0--produce-regional-factors--表二產製正式入口) 內部逐份呼叫的對象） |
| **耗時** | 一次 Bedrock，約 10–30 秒（Lambda timeout 120s） |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `meta` | `CaseMeta` | ✅ | 案件 meta（至少要有 `sectionId`） |
| `survey` | `SurveyField[]` | ✅ | **非空陣列**。區域因素是依勘查表評分，沒有它會直接回 400 |
| `benchmark` | `ComparisonCondition` | ✅ | 比準地宗地條件 |

```http
POST {{REGIONAL_FACTOR_GRADING_URL}}
Content-Type: application/json

{ "meta": { … }, "survey": [ /* 估價師定稿 */ ], "benchmark": { … } }
```

> **距離基準：`metersToCenter`。** 區域因素評的是整個地價區段的條件，基準點是**區段中心**。
> `survey[].items[]` 同時帶兩個距離時，prompt 明確要求模型只採 `metersToCenter`、忽略
> `metersToPoint`；`value` 字串 `"金山國小，距150M（距比準地210M）"` 也只採括號**前**的 150。
> 讓模型自己在兩個數字間挑，它會挑到表三的基準，整張表二就以錯的基準點評級而且看不出來。

### Response `200`

```typescript
type RegionalGradingResponse = {
  meta: CaseMeta;                  // 原樣回傳
  benchmark: ComparisonCondition;  // 原樣回傳
  regionalFactors: {
    raw: string;                   // "區域因素"
    categories: Array<{
      key: string; raw: string;
      items: Array<{
        key: string; raw: string;
        selectedGrade: {
          key: "superior" | "slightlySuperior" | "average" | "slightlyInferior" | "inferior";
          raw: string;             // "優" / "稍優" / …
          value: number;           // 修正點數（≤ 0）
          rate: number;            // 等級序（優 = 1）
        };
      }>;
    }>;
  };
  totalScore: number;              // 各項 selectedGrade.value 加總
};
```

**範例回應**（節錄）

```json
{
  "meta": { "sectionId": "P002-00", "…": "…" },
  "benchmark": { "…": "…" },
  "regionalFactors": {
    "raw": "區域因素",
    "categories": [
      { "key": "trafficAndTransport", "raw": "交通運輸",
        "items": [
          { "key": "proximityToBusStop", "raw": "站牌之接近程度或密集程度",
            "selectedGrade": { "key": "slightlySuperior", "raw": "稍優", "value": -2, "rate": 2 } }
        ] }
    ]
  },
  "totalScore": -11.5
}
```

> **只評有事實的項目**：survey 裡是空欄的項目不會出現在結果中。這是「表一定稿越完整、
> 表二項目越多」的原因（實測 5 項 → 28 項）。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"Request body must contain a \"meta\" object (勘查資料 meta)."}` | 缺 meta |
| `400` | `{"error":"Request body must contain a \"benchmark\" object (比準地宗地條件)."}` | 缺 benchmark |
| `400` | `{"error":"Request body must contain a non-empty \"survey\" array …"}` | survey 缺或為空 |
| `502` | `{"error":"<Bedrock 錯誤訊息>"}` | 模型呼叫失敗 |

---

## E0 · produce-regional-factors — 表二產製（正式入口）

收「比準地 + 最多 3 個比較標的」各自的表一定稿，內部逐份評分，合成前端要吃的
`RegionalFactorRow[]`（每列含比準地等級 + 各比較標的等級/點數差）。

| | |
|--|--|
| **Endpoint** | `{{PRODUCE_REGIONAL_FACTORS_URL}}` — `NtlandBedrockStack` / `ProduceRegionalFactorsFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ★ 正式 |
| **耗時** | (1+N) 次 Bedrock 並行；1 個比較標的實測約 20–40 秒（Lambda timeout 120s，單次評分 110s） |
| **內部呼叫** | `REGIONAL_FACTOR_GRADING_URL` × (1+N) |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `sectionId` | string | ✅ | 比準地區段編號 |
| `benchmark` | `Table1Final` | ✅ | 比準地的表一定稿 |
| `comparables` | `(Table1Final & { caseNo?: string })[]` | ⬜ | 比較標的，**最多 3 份**；省略或空陣列 = 只評比準地 |
| `caseCode` | string | ⬜ | 案號；缺則回傳 `sectionId` |
| `remarks` | `Partial<RegionalFactorRemarks>` | ⬜ | 備註欄；缺則回空字串 |

```typescript
type Table1Final = {
  meta: CaseMeta;
  survey: SurveyField[];          // 非空
  benchmark: ComparisonCondition;
};
```

> `caseNo` 省略時自動帶入索引（`"1"`、`"2"`、`"3"`）。

```http
POST {{PRODUCE_REGIONAL_FACTORS_URL}}
Content-Type: application/json

{
  "sectionId": "P002-00",
  "benchmark": { "meta": {…}, "survey": [ … ], "benchmark": {…} },
  "comparables": [
    { "caseNo": "1", "meta": {…}, "survey": [ … ], "benchmark": {…} }
  ]
}
```

### Response `200`

```typescript
type ProduceRegionalFactorsResponse = {
  regionalFactors: RegionalFactorRow[];   // 見「附錄 B」，實測 28 列
  regionalTotal: number;                  // 各列 compare[0] 點數差加總
  caseCode: string;
  comparisonCases: Array<{ caseNo: string; sectionId: string }>;
  regionalFactorRemarks: { subject: string; cases: string; overall: string };
  /** 只有在部分比較標的評分失敗時才出現 */
  failedComparables?: Array<{ caseNo: string; error: string }>;
};
```

**範例回應**（節錄）

```json
{
  "regionalFactors": [
    { "key": "urban_plan_r", "label": "都市計畫（內、外）", "group": "土地使用管制",
      "subject": { "grade": "優", "points": 0, "rank": 1 },
      "compare": [ { "sectionId": "P003-00", "sameSectionAsBenchmark": false,
                     "grade": "優", "rate": null, "points": 0, "rank": 1, "delta": 0 } ] }
  ],
  "regionalTotal": 0,
  "caseCode": "P002-00",
  "comparisonCases": [ { "caseNo": "1", "sectionId": "P003-00" } ],
  "regionalFactorRemarks": { "subject": "", "cases": "", "overall": "" }
}
```

行為要點：

- **`compare[].rate` 一律為 `null`** ——「修正率 %」由前端依 `points` / `delta` 計算後填回。
- **逐份容錯**：比較標的評分失敗 → 該筆被略過，並在 `failedComparables` 說明原因（仍回 200）；
  **比準地評分失敗 → 502**（沒有基準無從合成）。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"Missing sectionId (比準地區段編號)。"}` | 缺 sectionId |
| `400` | `{"error":"Missing/invalid benchmark: 需 { meta, survey (非空陣列), benchmark } (比準地表1 定稿)。"}` | benchmark 形狀不符 |
| `400` | `{"error":"comparables 最多 3 份 (收到 N)。"}` / `"comparables[i] 需 { caseNo, meta, survey (非空), benchmark }。"` | 比較標的過多或形狀不符 |
| `405` | `{"error":"Method GET not allowed."}` | 非 POST |
| `500` | `{"error":"REGIONAL_FACTOR_GRADING_URL 未設定，無法呼叫評分上游。"}` | 部署環境變數缺漏 |
| `502` | `{"error":"比準地評分失敗，無從合成：<原因>"}` | 比準地評分失敗 |

---

## E-pre · land-transaction — 實價登錄交易查詢

查某個地段的歷史成交案例，供表三求「土地正常單價」與「交易日期」用。

| | |
|--|--|
| **Endpoint** | `{{LAND_TRANSACTION_URL}}` — `NtlandBedrockStack` / `LandTransactionFunctionUrl` |
| **Method** | `GET` |
| **正式流程** | ⬜ 選用。[E](#e--produce-comparison--表三產製正式入口) 內部會自動查；但**格式常對不上**（見下方警告），前端可先查好再覆寫 |
| **耗時** | < 1 秒（Lambda timeout 30s） |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `segment` | string | ✅ | **段小段名**，如 `金美段` |
| `district` | string | ⬜ | 行政區，如 `金山區`。同名段跨區時用來消歧義 |
| `kind` | `land` \| `landhouse` \| `all` | ⬜ | 預設 `landhouse`（土地 + 房地，排除純車位）；`land` 只要純土地；`all` 全部 |
| `from` / `to` | `YYYY-MM-DD` | ⬜ | 交易日期區間（含邊界） |
| `limit` | number | ⬜ | 預設 `50`，上限 `200` |

> ⚠️ **`segment` 是地段名，不是區段編號。** 實價登錄的段名是「金美段」，而表一/表三的
> `benchmark.sectionId` 是區段編號「P002-00」。實測 `segment=金美段` 查得到單價，
> `segment=P002-00` 回 **0 筆**。E 內部是拿 `benchmark.sectionId` 當 `segment` 去查的，
> 所以在格式對齊前，正常單價會是 `0`，需要前端先查好再用
> `comparisonSurveys[].normalPrice` 覆寫。

```http
GET {{LAND_TRANSACTION_URL}}?segment=金美段&district=金山區&kind=land&limit=1
```

### Response `200`

```typescript
type LandTransactionResponse = {
  district: string | null;
  segment: string;
  kind: "land" | "landhouse" | "all";
  count: number;
  landCount: number;       // 純土地案例數（排序在前）
  houseLandCount: number;  // 房地案例數（排序在後，需自行拆分）
  cases: TransactionCase[];
};

type TransactionCase = {
  id: string;
  district: string | null;
  segment: string | null;
  lid: string | null;              // 地號
  tradeDate: string | null;        // 交易日期（西元 YYYY-MM-DD）
  kind: string | null;             // "土地" / "房地(土地+建物)" / "房地(土地+建物)+車位"
  isLandOnly: boolean;             // true = 可直接當土地單價用
  landArea: number | null;         // 土地移轉總面積(㎡)
  buildingArea: number | null;     // 建物移轉總面積(㎡)
  totalPrice: number | null;       // 總價(元)
  unitPrice: number | null;        // 單價(元/㎡) — 純土地可直接當正常單價
  urbanUse: string | null;         // 都市土地使用分區
  nonUrbanUse: string | null;      // 非都市土地使用分區
  buildingType: string | null;     // 建物型態
  structure: string | null;        // 主要建材
  totalFloors: string | null;      // 總樓層數
  buildDate: string | null;        // 建築完成日期（西元）
  buildingAgeYears: number | null; // 交易時屋齡（純土地為 null）
  note: string | null;             // 備註
};
```

排序：**土地案例優先**，同類內依交易日期新到舊。

> 房地案例需由下游用「房地分配法」拆分（總價扣建物現值回推土地），本 API 只負責把
> 拆分所需欄位一併撈齊，不做計算。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"segment (段小段) is required."}` | 缺 segment |
| `400` | `{"error":"kind must be \"land\", \"landhouse\", or \"all\"."}` | kind 值不合法 |
| `400` | `{"error":"from must be YYYY-MM-DD."}` / `"limit must be a positive integer."` | 參數格式錯 |
| `405` | `{"error":"Method POST not allowed."}` | 非 GET |
| `502` | `{"error":"land-transaction failed: <原因>"}` | 資料庫失敗 |

---

## E · produce-comparison — 表三產製（正式入口）

組比較法調查估價表：對比準地與各比較標的做個別因素評分、帶入表二的區域因素修正率、
拉實價登錄取正常單價，最後依價格鏈算出試算價格。

| | |
|--|--|
| **Endpoint** | `{{PRODUCE_COMPARISON_URL}}` — `NtlandBedrockStack` / `ProduceComparisonFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ★ 正式 |
| **耗時** | (1+N) 次 Bedrock 並行，約 20–40 秒（Lambda timeout 120s） |
| **內部呼叫** | `INDIVIDUAL_FACTOR_GRADING_URL` × (1+N)、`LAND_TRANSACTION_URL` |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `sectionId` | string | ⬜ | 比準地區段編號（缺則空字串） |
| `benchmark` | `ComparisonCondition` | ✅ | 比準地宗地條件 |
| `benchmarkSurvey` | `SurveyField[]` | ⬜ | 比準地表一定稿；有帶評分證據較足 |
| `regionalFactors` | `RegionalFactorRow[]` | ⬜ | [E0](#e0--produce-regional-factors--表二產製正式入口) 的結果，用來算每個標的的區域因素調整率 |
| `regionalTotal` | number | ⬜ | E0 的總修正率，預設 `0` |
| `meta` | `CaseMeta` | ⬜ | 轉發給評分上游；缺則以 `{ sectionId }` 代 |
| `comparisonLocations` | `{ address, lat, lng }[]` | ⬜ | 比較標的定位（圖台用），最多 3 筆 |
| `comparisonSurveys` | `ComparisonSurveyInput[]` | ⬜ | 各比較標的自己的表一 + 市場面覆寫，**最多 3 筆**。這才是決定有幾個比較標的的欄位 |

```typescript
type ComparisonSurveyInput = {
  benchmark: ComparisonCondition;  // 必填：該標的的宗地條件
  survey?: SurveyField[];          // 該標的的表一定稿
  address?: string; lat?: number; lng?: number;
  normalPrice?: number;            // 覆寫正常單價（不帶就用內部查到的段值）
  tradeDate?: string;              // 覆寫交易日期
  weight?: number;                 // 權重，預設 100
};
```

```http
POST {{PRODUCE_COMPARISON_URL}}
Content-Type: application/json

{
  "sectionId": "P002-00",
  "benchmark": { … }, "benchmarkSurvey": [ … ],
  "regionalFactors": [ … ], "regionalTotal": 0, "meta": { … },
  "comparisonLocations": [ { "address": "新北市金山區中山路二段", "lat": 25.2225, "lng": 121.6362 } ],
  "comparisonSurveys": [
    { "address": "新北市金山區中山路二段", "survey": [ … ], "benchmark": { … },
      "normalPrice": 49310, "tradeDate": "2025-03-14" }
  ]
}
```

### Response `200`

```typescript
type ProduceComparisonResponse = {
  comparison: FactorRow[];        // 19 項宗地條件的修正率（見附錄 B）
  comparisonForm: ComparisonForm; // 表三官方版式的完整內容（見附錄 B）
  computed: {
    dateAdj: number;         // 日期調整率（目前固定 0%）
    regionalTotal: number;   // 區域因素總修正率（來自 request）
    individualTotal: number; // 個別因素總修正率
    trialPrice: number;      // 試算價格
  };
};
```

**範例回應**（節錄）

```json
{
  "comparison": [
    { "key": "area", "label": "7面積(M²)", "group": "宗地條件", "rate": 0,
      "reference": { "dataSource": "個別因素評分（cli 個別因素鏈）",
                     "derivation": "修正率 = 比準地等級點數 − 比較標的等級點數（delta）" } }
  ],
  "comparisonForm": {
    "appraisalBaseDate": "…", "caseCode": "P002-00", "benchmarkParcelNo": "…",
    "benchmark": { … },
    "cases": [ { "caseNo": "1", "location": "新北市金山區中山路二段",
                 "normalPrice": 49310, "tradeDate": "2025-03-14",
                 "dateAdjRate": 0, "adjustedPrice": 49310, "regionalAdjRate": 0,
                 "rates": { "area": 0, "width": 0, "…": 0 },
                 "absRateSum": 6, "weight": "100%", "trialPrice": 49310 } ],
    "benchmarkComparedPrice": 49310, "caseRemark": "", "overallRemark": "", "fillDate": "…"
  },
  "computed": { "dateAdj": 0, "regionalTotal": 0, "individualTotal": 6, "trialPrice": 49310 }
}
```

行為要點：

- **正常單價來源**：內部用 `benchmark.sectionId` 當 `segment`、從 `benchmark.location` 抓「XX區」
  當 `district`，打 land-transaction 取該段**最近一筆土地案例**的 `unitPrice` / `tradeDate`，
  全案共用。查無 → `0`／空字串（**不會報錯**），此時試算價格也會是 0。
  用 `comparisonSurveys[].normalPrice` / `.tradeDate` 逐筆覆寫可繞過。
- `dateAdjRate` 預設 `0`（日期調整由前端決定後覆寫）。
- 每個標的的區域因素調整率 = `Σ regionalFactors[].compare[i].rate`，`null` 視為 `0`。
  由於 E0 回傳的 `rate` 一律是 `null`，**若前端沒先把修正率算好填回去，這裡就是 0**。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"benchmark (ComparisonCondition object) is required."}` | 缺 benchmark |
| `400` | `{"error":"comparisonSurveys supports at most 3 items."}` / `"each comparisonSurveys[] item requires a benchmark (ComparisonCondition)."` | 比較標的過多或形狀不符 |
| `400` | `{"error":"Request body is not valid JSON."}` | body 非 JSON 物件 |
| `405` | `{"error":"Method GET not allowed."}` | 非 POST |
| `502` | `{"error":"produce-comparison failed: individual-factor-grading HTTP 5xx"}` | 評分上游失敗（任一份失敗即整支失敗） |

---

## G · image-upload — 案件圖片上傳／列表

把要放進報告的圖片存到 S3（以 `caseId` 分資料夾），並可列出某案已上傳的圖片。

| | |
|--|--|
| **Endpoint** | `{{IMAGE_UPLOAD_URL}}` — `NtlandBedrockStack` / `ImageUploadFunctionUrl` |
| **Method** | `POST`（上傳）／`GET`（列表、下載） |
| **正式流程** | ★ 正式（有要放圖才需要） |
| **耗時** | < 1 秒（Lambda timeout 30s） |
| **儲存位置** | `s3://<ASSET_BUCKET>/<S3_PREFIX>/<caseId>/<fileName>`（預設 prefix `case-images`） |

### POST · 上傳一張

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `caseId` | string | ✅ | 案件 ID。**不可含 `/`、`\`、`..` 或以 `.` 開頭** |
| `fileName` | string | ✅ | 檔名，限制同上 |
| `dataBase64` | string | ✅ | 圖片內容的 base64 |
| `contentType` | string | ⬜ | 預設 `application/octet-stream`。放圖進 PDF 需為 `image/png` 或 `image/jpeg` |

```http
POST {{IMAGE_UPLOAD_URL}}
Content-Type: application/json

{ "caseId": "case_…", "fileName": "site-photo.png",
  "contentType": "image/png", "dataBase64": "iVBORw0KGgo…" }
```

**回應 `200`**：`{ "ok": true, "s3Key": "case-images/case_…/site-photo.png" }`

### GET · 列出某案圖片

```http
GET {{IMAGE_UPLOAD_URL}}?caseId=case_…
```

```typescript
type ListImagesResponse = {
  caseId: string;
  images: Array<{
    s3Key: string;
    fileName: string;
    size?: number;
    lastModified?: string;  // ISO 8601
    contentType?: string;   // 依副檔名推導（ListObjectsV2 拿不到）；認不出就沒這欄
    url?: string;           // 指回本支的下載路由（見下）；直接 GET 就拿得到圖
  }>;
};
```

> `url` 是用 Function URL 自己的 domain 組出來的，形如
> `{{IMAGE_UPLOAD_URL}}?caseId=…&fileName=…`。bucket 是私有的（CloudFront OAC），
> 所以圖片一律由這支代為讀出，不發簽名 URL、也不經 CloudFront。

### GET · 下載單張

給 `fileName` 就從列表切換成下載，直接回二進位圖片內容——
[export-report](#hx--export-report--報告匯出正式入口) 靠這條把圖併進報告 PDF。

```http
GET {{IMAGE_UPLOAD_URL}}?caseId=case_…&fileName=site-photo.png
```

**回應 `200`**：圖片本身。`content-type` 取上傳時存的值；上傳沒指定（`application/octet-stream`）
時改用副檔名推導。`caseId`／`fileName` 走與上傳相同的路徑檢查，讀不到 `<prefix>/<caseId>/` 以外的東西。

> 單次回應上限 6 MB（Function URL 限制，base64 會膨脹約 33%），實際約 4.5 MB 的圖為上限。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"caseId (non-empty string) is required."}` | 缺 caseId／fileName |
| `400` | `{"error":"fileName contains an illegal path segment."}` | 檔名含路徑字元（防止讀寫到別的前綴） |
| `400` | `{"error":"dataBase64 (base64 image content) is required."}` | 缺圖片內容 |
| `404` | `{"error":"No image at case-images/<caseId>/<fileName>."}` | 下載的圖不存在 |
| `405` | `{"error":"Method DELETE not allowed."}` | 不支援的 method |
| `502` | `{"error":"image-upload failed: <原因>"}` | S3 失敗或 `ASSET_BUCKET` 未設定 |

---

## H1 · fill-district-survey — 表一 PDF

把表一內容畫進官方版式的 PDF 範本。純 pdf-lib，不碰 Bedrock／DB。

| | |
|--|--|
| **Endpoint** | `{{FILL_DISTRICT_SURVEY_URL}}` — `NtlandBedrockStack` / `FillDistrictSurveyFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ⬜ 選用。正式由 [Hx](#hx--export-report--報告匯出正式入口) 內部呼叫 |
| **耗時** | < 1 秒（Lambda timeout 30s） |
| **回應型別** | `application/pdf` |

### Request

body 就是**表一的 content tree**（也接受 `{ content: {…} }` 包一層）。

> ⚠️ **這裡吃的不是前端的 `SurveyField[]`。** content tree 是按分類巢狀、每格
> `{ raw, value: { type, … } }` 的結構。轉換由後端 mapper
> [`shared/db/mappers/survey.ts`](infra/lambda/shared/db/mappers/survey.ts) 的
> `surveyToContentTree(survey, meta?, benchmark?)` 負責——前端統一送 `SurveyField[]`，
> 走 [Hx](#hx--export-report--報告匯出正式入口) 會自動轉；單獨打這支則要自己先轉好。
>
> ⚠️ **只有這支沒有自動轉換**：[H2](#h2--fill-regional-analysis--表二-pdf) / [H3](#h3--fill-individual-analysis--表三-pdf)
> 已能自行辨識並 reshape 上游 produce-\* 的輸出，H1 還沒有。直接餵 `SurveyField[]`
> 會**回 200 但畫出空白 PDF**（不是報錯）。

空 body（或 `{}`）→ 回**空白範本**（可用來驗證這支活著）。

```http
POST {{FILL_DISTRICT_SURVEY_URL}}
Content-Type: application/json

{ "landUseRegulation": { … }, "trafficAndTransport": { … }, "…": { … } }
```

### Response `200`

`Content-Type: application/pdf`，body 即 PDF 檔（Function URL 以 base64 傳輸，
`curl` / `fetch` 收到的已是解碼後的 PDF 位元組，**不需自己再 base64 解碼**）。

實測大小：空白範本 ~123KB；有填值 ~375KB。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"Invalid JSON body: <原因>"}` | body 不是合法 JSON |
| `500` | `{"error":"<原因>"}` | 繪製失敗 |

---

## H2 · fill-regional-analysis — 表二 PDF

依用地類別選範本，把表二（區域因素分析明細表）內容畫進官方版式。

| | |
|--|--|
| **Endpoint** | `{{FILL_REGIONAL_ANALYSIS_URL}}` — `NtlandBedrockStack` / `FillRegionalAnalysisFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ⬜ 選用。正式由 [Hx](#hx--export-report--報告匯出正式入口) 內部呼叫 |
| **耗時** | < 1 秒（Lambda timeout 30s） |
| **回應型別** | `application/pdf` |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `purpose` | `agricultural` \| `commercial` \| `industrial` \| `other` \| `residential` | ✅ | 用地類別，決定用哪份範本（5 份都內嵌在 bundle 裡）。亦可用 `?purpose=` |
| `content` | object | ⬜ | 表二內容；缺則出空白範本。接受 content tree 或 **[E0](#e0--produce-regional-factors--表二產製正式入口) 的原始輸出**，見下 |

也接受把 content 攤平在頂層：`{ purpose, ...content }`。

```http
POST {{FILL_REGIONAL_ANALYSIS_URL}}
Content-Type: application/json

{ "purpose": "residential", "content": { "regionalFactors": [ … ], "caseCode": "P002-00" } }
```

> 每份範本的版面不同，同一份 content 在不同 `purpose` 下可能有部分項目對不到座標
> （log 會出現 `no coordinates for item "…"`，該格略過不畫，不會報錯）。

**content 接受兩種形狀（後端自動判別）**

| 形狀 | 處理 |
|------|------|
| content tree（有 `categories`）：`{ categories: [{ categoryRaw, items: [{ itemRaw, base, comparables }] }], … }` | 原樣送進 fillEngine |
| [E0](#e0--produce-regional-factors--表二產製正式入口) 的輸出（有 `regionalFactors`）：`{ regionalFactors, regionalTotal, caseCode, … }` | 自動以 `regionalRowsToAnalysisContent(rows, caseCode)` 轉成 content tree |

fillEngine 靠**中文的 `itemRaw` / `categoryRaw`** 對版面座標，所以 content tree 是它唯一認得的形狀；
轉換 mapper 是 [`shared/db/mappers/grading.ts`](infra/lambda/shared/db/mappers/grading.ts)，
與 [Hx](#hx--export-report--報告匯出正式入口) 在管線上游跑的是同一支。

> 這個自動轉換是 2026-09 補的。在那之前直接餵 `{ regionalFactors, … }` 會**回 200 但畫出空白 PDF**
> （每個 `categories` 查找都是 undefined，靜默畫不出東西）。現在跳過 Hx 直接打這支也填得出來。
> 認不得的形狀一律原樣通過 —— 仍會畫出空白 PDF 而不是報錯。

`purpose` 依表一的 `zone_type` / `meta.landUseType` 決定。

### Response `200`

`application/pdf`。實測：空白 ~123KB；填 28 項 ~142KB。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"purpose (one of agricultural, commercial, industrial, other, residential) is required (in body or ?purpose=), got none."}` | 缺 purpose 或值不合法 |
| `400` | `{"error":"Invalid JSON body: <原因>"}` | body 不是合法 JSON |
| `500` | `{"error":"<原因>"}` | 繪製失敗 |

---

## H3 · fill-individual-analysis — 表三 PDF

把表三（比較法調查估價表／個別因素）內容畫進官方版式。

| | |
|--|--|
| **Endpoint** | `{{FILL_INDIVIDUAL_ANALYSIS_URL}}` — `NtlandBedrockStack` / `FillIndividualAnalysisFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ⬜ 選用。正式由 [Hx](#hx--export-report--報告匯出正式入口) 內部呼叫 |
| **耗時** | < 1 秒（Lambda timeout 30s） |
| **回應型別** | `application/pdf` |

### Request

body 是表三內容（也接受 `{ content: {…} }`）；空 body → 空白範本。**三種形狀都收，後端自動判別**：

| 形狀 | 處理 |
|------|------|
| content tree（有 `categories`） | 原樣送進 fillEngine |
| [E](#e--produce-comparison--表三產製正式入口) 的整包輸出：`{ comparison, comparisonForm, computed }` | 取出 `comparisonForm` 後轉成 content tree |
| 裸 `ComparisonForm`（有 `benchmark` + `cases[]`） | 直接轉成 content tree |

content tree 靠 `categoryKey::itemKey`（英文鍵）對座標，涵蓋 19 項宗地條件 + 差異率；轉換由
[`shared/db/mappers/grading.ts`](infra/lambda/shared/db/mappers/grading.ts) 的
`comparisonFormToContentTree(form)` 負責，與 [Hx](#hx--export-report--報告匯出正式入口)
在管線上游跑的是同一支。

> 這個自動轉換是 2026-09 補的（見 [`normalizeContent.ts`](infra/lambda/fill-individual-analysis/normalizeContent.ts)）。
> 在那之前直接餵 `comparisonForm` 會**回 200 但畫出空白 PDF**。認不得的形狀仍原樣通過，
> 結果一樣是空白 PDF 而不是報錯。

### Response `200`

`application/pdf`。實測：空白 ~188KB；有填值 ~217KB。

### 錯誤

同 [H1](#h1--fill-district-survey--表一-pdf)：`400`（JSON 不合法）／`500`（繪製失敗）。

---

## H4 · fill-report — PDF 合併器

把多份已經是 PDF 的段落依序合併成一份。純 `copyPages`，**不重畫版式、不需字型**，
每份來源的頁面尺寸／方向原樣保留，多頁來源會整份帶入。

| | |
|--|--|
| **Endpoint** | `{{FILL_REPORT_URL}}` — `NtlandBedrockStack` / `FillReportFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ⬜ 選用。正式由 [Hx](#hx--export-report--報告匯出正式入口) 內部呼叫 |
| **耗時** | 數秒（Lambda timeout 60s） |
| **回應型別** | `application/pdf` |

### Request

```typescript
type FillReportRequest = {
  files: Array<{ name?: string; pdfBase64: string }>;  // 依陣列順序合併
};
```

相容形式：裸陣列 `[{ pdfBase64 }, …]`，或單筆 `{ pdfBase64 }`。
`pdfBase64` 可帶 `data:application/pdf;base64,` 前綴（瀏覽器 FileReader 常見）。

```http
POST {{FILL_REPORT_URL}}
Content-Type: application/json

{ "files": [
    { "name": "table1-survey",     "pdfBase64": "JVBERi0…" },
    { "name": "table2-regional",   "pdfBase64": "JVBERi0…" },
    { "name": "table3-comparison", "pdfBase64": "JVBERi0…" }
] }
```

### Response `200`

`application/pdf`，`content-disposition: inline; filename="report-merged.pdf"`。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"No PDF files to merge. Expected { files: [{ pdfBase64 }] }."}` | 沒有可用的檔案 |
| `400` | `{"error":"Invalid JSON body: <原因>"}` | body 不是合法 JSON |
| `405` | `{"error":"Method GET not allowed."}` | 非 POST |
| `500` | `{"error":"Failed to load source PDF \"table2-regional\": <原因>"}` | 某份來源不是合法 PDF |

---

## Hx · export-report — 報告匯出（正式入口）

**PDF 匯出的實際入口**：內部自動打三支填表 lambda、併入前端附的地圖、取回案件圖片，
最後在本支用 pdf-lib 合成單一 PDF（不再經 fill-report：所有段落塞同一個請求會超過 6 MB）。

| | |
|--|--|
| **Endpoint** | `{{EXPORT_REPORT_URL}}` — `NtlandBedrockStack` / `ExportReportFunctionUrl` |
| **Method** | `POST` |
| **正式流程** | ★ 正式 |
| **耗時** | 數秒～數十秒（Lambda timeout 120s） |
| **內部呼叫** | `FILL_DISTRICT_SURVEY_URL`、`FILL_REGIONAL_ANALYSIS_URL`、`FILL_INDIVIDUAL_ANALYSIS_URL`、`IMAGE_UPLOAD_URL`（只有走 `caseId` 時）、S3 `ASSET_BUCKET`（只讀 `case-images/*`） |
| **回應型別** | `application/pdf` |
| **大小上限** | 合併後 PDF 約 4.4 MB（Function URL 回應 6 MB，base64 膨脹 33%）；超過回 `413` |

### Request

| 參數 | 型別 | 必填 | 說明 |
|------|------|:----:|------|
| `surveys` | （表一定稿或 content tree）`[]` | ⬜ | **比準地 + 各比較標的的勘查表，依陣列順序各產一張併入**。每筆形狀同 `survey`，見下方「自動轉換」 |
| `survey` | 表一定稿或 content tree | ⬜ | 單張（向後相容，等同只有一筆的 `surveys`）。與 `surveys` 同時帶時**忽略** |
| `regional` | `{ purpose, content? }` | ⬜ | `purpose` 必填字串；`content` 見下方 |
| `comparison` | `ComparisonForm` 或 content tree | ⬜ | 見下方 |
| `maps` | `{ name?, pdfBase64 }[]` | ⬜ | 前端 Leaflet 產的地圖 PDF，直接併入 |
| `s3Keys` | string[] | ⬜ | **建議用法**。[image-upload](#g--image-upload--案件圖片上傳列表) 回的 `s3Key`，直接從 S3 讀、依陣列順序併入。有帶（即使是 `[]`）就**不看 `caseId`**。PNG／JPEG 各轉一頁、PDF 原樣併入（看檔頭判斷，不看副檔名）。任一張讀不到／格式不支援只略過那張，不影響其他段落 |
| `caseId` | string | ⬜ | 沒帶 `s3Keys` 時才用：向 image-upload 列出該案**全部**圖片併入（資料夾裡的舊圖也會進來） |

**表一／表二／表三／地圖四段都是可選的，但至少要有一段**，否則回 400。合併順序固定為：
表一（`surveys` 依序，可多張）→ 表二 → 表三 → 地圖 → 案件圖片。

> 被略過的圖片會寫進 CloudWatch log（`[export-report] 略過無法併入的圖片: [...]`，含 key 與原因），
> 回應 header `x-export-skipped-count` 帶略過張數。

> 一份估價案有 N+1 張勘查表（比準地 1 + 比較標的 ≤3），**都要進報告**，所以正式請用 `surveys`。
> 只帶單張 `survey` 時報告裡就只有那一張。

**自動轉換（前端直接送定稿即可）**

| 欄位 | 接受的形狀 | 內部處理 |
|------|-----------|---------|
| `surveys[]` / `survey` | `{ meta?, survey: SurveyField[], benchmark? }`、裸 `SurveyField[]`、已是 content tree | 前二者 → `surveyToContentTree`；已是 tree 原樣送（`surveys` 逐筆各轉一次、並行打填表） |
| `regional.content` | `RegionalFactorRow[]`、`{ regionalFactors, meta? }`、已是 comparison content tree | 前二者 → `regionalRowsToAnalysisContent`（`sectionId` 取自 `meta.sectionId`）；已是 tree 原樣送 |
| `comparison` | `ComparisonForm`（帶 `benchmark` + `cases[]`）、已是 content tree | 前者 → `comparisonFormToContentTree`；已是 tree 原樣送 |

> 轉換在這裡做完才送下游，所以 H2/H3 自己那層 reshape 對走 Hx 的請求不會再觸發（兩層做的是同一件事）。

```http
POST {{EXPORT_REPORT_URL}}
Content-Type: application/json

{
  "s3Keys": [ "case-images/demo-…/section-boundary-map.jpg", "case-images/demo-…/zoning-map.jpg" ],
  "surveys": [
    { "meta": { "sectionId": "樹德段1415", … }, "survey": [ /* 比準地 SurveyField[] */ ],   "benchmark": {…} },
    { "meta": { "sectionId": "樹德段284",  … }, "survey": [ /* 比較標的 SurveyField[] */ ], "benchmark": {…} }
  ],
  "regional":   { "purpose": "commercial",
                  "content": { "regionalFactors": [ /* RegionalFactorRow[] */ ], "meta": {…} } },
  "comparison": { /* ComparisonForm */ },
  "maps":       [ { "name": "location-map", "pdfBase64": "JVBERi0…" } ]
}
```

### Response `200`

`application/json`。**PDF 不在回應裡**——合併好的 PDF 已寫進 data bucket 的 `case-exports/`，
這裡回下載網址（走 AssetStack 的 CloudFront，CORS 全開，前端可直接 `fetch`）：

```json
{
  "url": "https://dxxxx.cloudfront.net/case-exports/demo-case-001/2026-09-13T08-00-00-000Z-<uuid>.pdf",
  "s3Key": "case-exports/demo-case-001/2026-09-13T08-00-00-000Z-<uuid>.pdf",
  "sizeBytes": 1104745,
  "pageCount": 6,
  "skippedCount": 0
}
```

> 為什麼不直接回 PDF：Function URL 回應上限 6 MB（base64 後 PDF 本體約 4.4 MB 就超過），
> 多張勘查表 + 地圖/照片很容易爆。網址帶 UUID、不會過期（hackathon 取捨，正式環境應改 presigned URL）。
> header `x-export-skipped-count` 同 `skippedCount`。

### 錯誤

| HTTP | body | 情境 |
|------|------|------|
| `400` | `{"error":"沒有任何可合併的段落。至少要提供 surveys(或 survey) / regional / comparison / maps 之一。"}` | 四段全缺（`surveys: []` 也算缺） |
| `400` | `{"error":"surveys, if present, must be an array."}` / `"surveys[0] must be an object (表一定稿或 content tree)。"` | `surveys` 不是陣列，或某筆不是物件 |
| `400` | `{"error":"regional, if present, requires a string \`purpose\`."}` | regional 缺 purpose |
| `400` | `{"error":"Request body is not valid JSON."}` / `"maps, if present, must be an array."` / `"s3Keys, if present, must be an array of strings."` | body 形狀不符 |
| `405` | `{"error":"Method GET not allowed."}` | 非 POST |
| `413` | `{"error":"合併後 PDF 5.6 MB,超過 Function URL 回應上限(約 4.4 MB)。請把圖片改存 JPEG 或減少張數。"}` | 合併結果太大（例如三張 html2canvas PNG 圖籍） |
| `500` | `{"error":"<ENV> 未設定：export-report 需要它才能組匯出。"}` | 部署環境變數缺漏 |
| `502` | `{"error":"export-report 上游失敗：fill-regional-analysis HTTP 5xx: …"}` | 任一上游填表失敗 |

---

# 附錄 A · 其他已部署的 API

這些不在表一→表三的主旅程上，但同屬本系統、已部署且可直接呼叫。

## individual-factor-grading — 個別因素評分

`POST {{INDIVIDUAL_FACTOR_GRADING_URL}}`（`IndividualFactorGradingFunctionUrl`）。
與 [C2](#c2--regional-factor-grading--區域因素評分表二) 對稱，差別在**評的是個別因素、
以 `benchmark` 為主要依據**，所以 `survey` 是選填。

- Request：`{ meta, benchmark, survey? }`
- Response：`{ meta, benchmark, individualFactors: { raw, categories[] }, totalScore }`
- 錯誤：`400`（缺 meta／benchmark）、`502`（Bedrock 失敗）
- 正式流程由 [E](#e--produce-comparison--表三產製正式入口) 內部呼叫，前端通常不直接打。

> **距離基準：`metersToPoint`。** 個別因素評的是這一筆宗地自己，基準點是**地點（比準地）**。
> `benchmark.*Distance` 本身已經是距比準地的值（[Bp](#bp--produce-survey--表一草稿產製正式入口)
> 挑的是離比準地最近的那筆設施），所以優先讀 `benchmark`；真要從 `survey` 取數字時，
> prompt 要求採 `items[].metersToPoint`、以及 `value` 括號**裡**的那個數字。

## land-value — 公告地價／公告土地現值

`GET {{LAND_VALUE_URL}}`（`LandValueFunctionUrl`）。

| 參數 | 必填 | 說明 |
|------|:----:|------|
| `segment` | ✅ | 段小段 |
| `lid` | ✅ | 地號 |
| `district` | ⬜ | 行政區（同名段消歧義） |

```typescript
type LandValueResponse = {
  district: string | null; segment: string; lid: string;
  latest:   { year: number; officialValue: number | null; officialPrice: number | null };
  previous: { year: number; officialValue: number | null; officialPrice: number | null } | null;
  valueGrowthPct: number | null;  // 公告現值漲幅%（小數 2 位）
  priceGrowthPct: number | null;  // 公告地價漲幅%
};
```

`previous` 是「往前找到的最近一個有資料年份」，不必剛好差一年；找不到任何年份回 `404`。

## land-locate — 地籍定位（段／地號 → 經緯度 + 宗地邊界）

> ## ⚠️ DEPRECATED — 已停用，新功能不要接
>
> **改用 [land-easymap](#land-easymap--地籍圖資便民系統即時查詢任何地號)。**
>
> 停用原因是覆蓋率：本支的幾何來自「新北市**公有土地**資料供應」KML，**私有地地號查不到**，
> 只能退回段中心點。估價實務上比較標的大多是私有地，退段中心點等於定位失敗。
> land-easymap 即時爬官方系統，**任何地號都查得到**，還一併回面積與公告值。
>
> | | land-locate（本支） | land-easymap（改用這支） |
> |---|---|---|
> | 涵蓋 | 僅公有地 | **任何地號，含私有地** |
> | 幾何 | 真實宗地 polygon | 只有定位點，無邊界 |
> | 面積 | `areaM2`（僅 parcel 精度） | `fields.areaM2` + 坪 |
> | 延遲 | 快（查自家 DB） | 慢（即時爬，冷啟動 8～10 秒） |
> | 相依 | 無 | 上游網站可用性與 HTML 版面 |
>
> **唯一還贏的是宗地 polygon 邊界**。如果前端地籍圖層真的需要畫多邊形而不是標點，
> 這支還活著、還可以打；但表一定位流程（輸入 行政區+段+地號 → 取經緯度與面積 →
> 存進 [case-store](#d--case-store--案件與三表定稿儲存) 的宗地身分欄）一律走 land-easymap。
>
> **原始碼不會刪**：`lambda/land-locate/` 的 `parcelId.ts` / `freeText.ts`（地號正規化、
> 段名正規化、`?q=` 自由字串解析）是純字串工具，**land-easymap 直接 import 它們**。
> 退場的是這個 HTTP 端點，不是那個資料夾。

`GET {{LAND_LOCATE_URL}}`（`LandLocateFunctionUrl`）。一支同時餵
[Bp](#bp--produce-survey--表一草稿產製正式入口) 的 `benchmarkLocation` 與前端地籍圖層。

三種路由擇一：

| 參數 | 必填 | 說明 |
|------|:----:|------|
| `district` + `section` | 擇一組 | 行政區 + 段名（含小段，連寫）。**段名跨區重複很常見**（`大同段` 就有板橋／汐止／中和／樹林 4 個），所以 `section` 一定要配 `district`；只給 `section` 回 `400` |
| `sectno` | 擇一組 | 段代碼（補零與否皆可，`106` = `0106`）。11 個代碼在對照表裡重複，命中多筆時回 `400` 附候選清單，可再加 `district` 補刀 |
| `q` | 擇一組 | 自由字串，如 `樹林區大同段31-1地號`。解析不出「段」回 `400` |
| `lid` | ⬜ | 地號。`31-1` / `31之1` / `0031-0001` / `３１之１` 都吃；**省略則只回段中心點** |
| `county` | ⬜ | 目前固定新北市 |

```typescript
type LandLocateResponse = {
  county: string; district: string;
  section: string | null;          // 5 個「對照表查無」的段為 null，只能用 sectno 查
  sectno: string;                  // 補零 4 碼
  lid: string | null;              // 正規化後（'31-1'）；未給 lid 為 null
  precision: "parcel" | "section";
  center: { lat: number; lng: number };
  bbox: [number, number, number, number];   // [minLng, minLat, maxLng, maxLat]
  boundary: GeoJSON;               // parcel：真實宗地邊界；section：該段 bbox polygon
  areaM2: number | null;           // section 時 null
  radiusHint: number;              // parcel：√(area/π)；section：bbox 對角線一半（公尺）
  source: string;                  // 'kml-public-land'
  note: string | null;             // 退回段中心點時說明原因
};
```

**三層 fallback（保證永遠有答案）**：

| 情況 | 回應 |
|------|------|
| 地號命中宗地 | `200` `precision:"parcel"` |
| 段有幾何，但地號不在公有地集合 | `200` `precision:"section"`，`note` 說明並提示同母號還有幾筆 |
| 段存在於代碼對照表、但本資料集無幾何 | `404` `{ error, sectionExists: true, district, sectno, section }` |
| 段不存在 | `404` `{ error, sectionExists: false }` |

> ⚠️ **覆蓋率**：資料來自「新北市**公有土地**資料供應」，不是完整地籍圖 —— 段層覆蓋
> 1,318 / 1,869 ≈ 70%，宗地層只含公有地。**私有地地號查不到是預期行為**，會落在
> `precision:"section"`。前端拿到 `section` 精度時應該畫 `radiusHint` 誤差圈，而不是精確標點。

## land-easymap — 地籍圖資便民系統即時查詢（任何地號）

`GET {{LAND_EASYMAP_URL}}`（`LandEasymapFunctionUrl`）。即時打內政部
**地籍圖資網路便民服務系統**（easymap.moi.gov.tw），回單筆地號的公告現值／公告地價／面積／
定位點／建號。與另外兩支的分工：

| API | 資料來源 | 涵蓋範圍 | 特長 |
|-----|----------|----------|------|
| ~~[land-locate](#land-locate--地籍定位段地號--經緯度--宗地邊界)~~ ⚠️ deprecated | 我們匯入的公有地 KML | **僅公有地**，私有地退段中心點 | 真實宗地 **polygon** 邊界（唯一還贏的地方） |
| [land-value](#land-value--公告地價公告土地現值) | 我們匯入的 `land_official_value` | 已匯入的年份（99～115） | **逐年比較 + 漲幅%**，離線可查 |
| **land-easymap** | 即時爬官方系統 | **任何地號（含私有地）** | 當年度公告值 + 面積 + 定位點 + 建號 |

代價是依賴上游可用性與 HTML 版面：定位或明細其中一段失敗時**不會整支 502**，而是回 `200`
並在 `note` 說明降級原因。

| 參數 | 必填 | 說明 |
|------|:----:|------|
| `district` | ✅ | 行政區，如 `金山區`（別名 `town`） |
| `section` | ✅ | 段名，如 `金美段`（別名 `segment`） |
| `lid` | ✅ | 地號。`489` / `31-1` / `31之1` / `０４８９` 都吃（別名 `parcel`、`landNo`） |
| `q` | 擇一 | 自由字串，如 `金山區金美段489地號`，可取代上面三個。解析不出「段」回 `400` |
| `county` | ⬜ | 預設 `新北市` |

```typescript
type LandEasymapResponse = {
  query:    { county: string; district: string; section: string; lid: string };
  resolved: { cityCode: string; townCode: string; office: string; sectno: string; landNo: string };
  center:   { lat: number; lng: number } | null;  // 宗地「定位點」，非界址點；locate 失敗為 null
  fields: {
    adminArea?: string;                  // '新北市 金山區'
    landOffice?: string;                 // '汐止地政事務所'
    section?: string;                    // '1027 金美段'
    sectionCode?: string;                // '1027'
    sectionNameParsed?: string;          // '金美段'
    parcelNo?: string;                   // '04890000'（上游原生 8 碼）
    parcelDisplay?: string;              // '489'
    areaM2?: number;  areaPing?: number;
    announcedValuePerM2?: number;        // 公告現值（元/㎡）
    announcedValueTotal?: number;        // ＝ 現值 × 面積
    announcedLandPricePerM2?: number;    // 公告地價（元/㎡）
    announcedLandPriceTotal?: number;    // ＝ 地價 × 面積
    referenceInfo?: string;              // 土地參考資訊
    [k: string]: string | number | undefined;  // 另有上游頁面的 meta_* 原始欄位
  };
  buildings: string[];                   // 該宗地上的建號（8 碼）
  source: string;                        // 'easymap.moi.gov.tw'
  fetchedAt: string;                     // ISO 8601
  priceYear: string;                     // '115'（民國）
  disclaimer: string;                    // 上游聲明：非即時，應以謄本為準
  note: string | null;                   // 降級說明（如只拿到明細、定位失敗）
};
```

**批次**：`POST {{LAND_EASYMAP_URL}}`，body `{ "parcels": [ { district, section, lid }, … ] }`
（也接受裸陣列）。回 `{ count, results }`，`results` 逐筆是上面的物件或 `{ query, error }`。
上游 token 是 session 級的**一次性**資源，所以後端一定逐筆序列查、每筆之間有間隔 —— 一次
**最多 5 筆**（超過回 `400`），需要更多請分批打。

| 狀態 | 意義 |
|------|------|
| `400` | 缺 `district` / `section` / `lid`，地號格式解析不出，`q` 解析不出段，或批次超過 5 筆 |
| `404` | NLSC 對照表查無該縣市／行政區／段（`查無地段 X`），或段對但**該地號在上游查無資料** |
| `502` | 上游連線／HTTP／逾時失敗（單次往返上限 8 秒，整筆會重試一次） |

> ⚠️ 這支會**即時打政府網站**，延遲比其他 API 高（冷啟動含 NLSC 對照表約 8～10 秒，
> 之後同容器有快取約 1～2 秒）。請不要拿它做大量掃描，前端也建議加 loading 與逾時保護。

## zoning-filter — 使用分區圖資

`GET {{ZONING_URL}}?lat=&lng=[&radius=]`（`ZoningFunctionUrl`）。
以 bbox 篩出座標附近的使用分區圖徵，回 GeoJSON。

- `radius`：公尺，預設 `1500`，上限 `5000`
- Response：`{ "type": "FeatureCollection", "features": [ … ] }`
- 錯誤：`400 {"error":"lat/lng query params required"}`、`502 {"error":"zoning data unavailable"}`

## wind-condition — 風況

`GET {{WIND_URL}}?lon=&lat=`（`WindFunctionUrl`）。呼叫 Open-Meteo Archive API，
回近一年的平均日最大風速與主風向。

```typescript
type WindConditionResponse = {
  lon: number; lat: number;
  period: { startDate: string; endDate: string };
  sampleDays: number;
  avgDailyMaxWindSpeedKmh: number;     // 小數 1 位
  dominantWindDirectionDeg: number;    // 小數 1 位
  dominantWindDirectionCompass: string; // 方位字串，如 "NE"
};
```

錯誤：`400`（座標缺／不合法）、`502`（上游 API 失敗）。

## maptiles-base / maptiles-detail — 地形圖磚

`GET {{BASE_TOPO_URL}}?lon=&lat=[&zoom=&radius=&pin=&emap=]`（`BaseTopoFunctionUrl`）
— NLSC B5000 1/5000 全國基本地形圖。
`GET {{DETAIL_TOPO_URL}}?…`（`DetailTopoFunctionUrl`）— NLSC TOPO01K 1/1000 新北市都市計畫地形圖。

| 參數 | 必填 | 說明 |
|------|:----:|------|
| `lon` / `lat` | ✅ | 中心點座標 |
| `zoom` | ⬜ | 整數 0–19，預設 15 |
| `radius` | ⬜ | 整數 0–4，預設 0。周邊圖磚圈數，`(2r+1)²` 張（`radius=4` = 81 張） |
| `pin` | ⬜ | 是否畫中心標記 |
| `emap` | ⬜ | 底圖模式 |

回應是 **PNG**（`image/png`）。錯誤：`400`（座標／zoom／radius 不合法）、`502`（上游圖磚服務失敗）。

---

# 附錄 B · 共用型別

以下型別在多支 API 間共用，單一事實來源為
[`infra/lambda/shared/db/types.ts`](infra/lambda/shared/db/types.ts)。

```typescript
/** WGS84 座標。注意欄名是 lng（不是 lon），順序 lat 在前。 */
type LatLng = { lat: number; lng: number };

/** 欄位的佐證資訊（表一欄位、表二評等、表三修正率都可能帶）。 */
type FieldReference = {
  dataSource: string;    // 數據來源，如 "AI 查詢｜周邊設施查詢 API｜半徑600m"
  measurement?: string;  // 量測方式，如 "直線距離"
  bracket?: string;      // 依據的基準表級距
  derivation?: string;   // 推導過程
  rawFact?: string;      // 原始事實
};

/** 案件層級 meta，貫穿三表。 */
type CaseMeta = {
  yearPeriod: string;      // 年期，如 "1140901"
  sectionId: string;       // 區段編號，如 "P002-00"
  district: string;        // 行政區
  landUseType: string;     // 用地別
  benchmarkParcel: string; // 比準地號
  surveyDate: string;      // 勘查日期（民國），如 "114年09月18日"
  range?: string;          // 區段範圍描述
  location?: LatLng;       // 地點（比準地）；SurveyField.items[].metersToPoint 量到這一點
  // 區段範圍多邊形：items[].metersToCenter 的基準點就是它的幾何重心。
  // 存下來兩個距離才可驗、可重算——少了它，表上的「距150M」就只是一個無從解釋的數字。
  sectionPolygon?: LatLng[];
};
```

## 表一 · SurveyField

```typescript
type SurveyField = {
  key: string;    // 欄位識別碼，如 "zone_type"
  label: string;  // 中文欄位名
  group: string;  // 分類，如 "土地使用管制"
  value: string;  // 當前值
  source: "ai" | "manual" | "edited" | "empty" | "confirmed";
  origin?: string;        // 來源簡述
  reference?: FieldReference;
  aiSuggestion?: string;
  confidence?: "high" | "low";
  warning?: string;       // AI 自檢提示
  options?: string[];     // 下拉選項
  // 多筆設施完整清單，依 metersToCenter 由近到遠
  items?: Array<{
    name: string;
    metersToCenter: number; // 到區段中心 —— 表二（表5 區域因素）grading 用
    metersToPoint?: number; // 到地點（比準地）—— 表三（表4 個別因素）grading 用
  }>;
};
```

`source` 語意：`ai` = AI 查得、`empty` = 查無需人工、`edited` / `manual` = 人工填寫、
`confirmed` = 人工確認過 AI 值。

**兩個距離**：`metersToCenter` 基準點是區段多邊形（`meta.sectionPolygon`）的幾何重心，
`metersToPoint` 基準點是地點（`meta.location`）。區域因素評整個區段、個別因素評這一筆宗地，
基準點本來就不是同一個。沒帶區段多邊形時（圓心＝地點）兩者相同，只輸出前者——
`metersToPoint` 缺值代表「沒有第二個基準點」，**不是 0**。
`value` 則以純附加格式同時寫兩個：`"金山國小，距150M（距比準地210M）"`。

**欄位分類（`group`）與欄位數**：土地使用管制 6、交通運輸 12、自然條件 7、土地改良 2、
公共建設 9、特殊設施 9、環境污染 5、工商活動 6、其他影響因素 1、房屋建築現況 2、
土地利用現況 1 —— 共 60 欄，[Bp](#bp--produce-survey--表一草稿產製正式入口) 一律回完整目錄
（目錄本身在 [`produce-survey/mapToSurvey.ts`](infra/lambda/produce-survey/mapToSurvey.ts)，
key／label／group／順序與前端 [`surveyFixtures.ts`](frontend/src/mock/surveyFixtures.ts) 逐欄一致）。

> `other_factors`（其他影響因素）自成一個 group，8 類 draft 都沒有對應的產出，所以與
> `building_density` / `building_type` / `land_use_status` 一樣**恆為 `source: "empty"`**，由估價師填。
>
> `department_store` / `financial_institution` / `entertainment` / `exhibition_hotel` 屬
> **工商活動**（表單右下角與顧客通行量／店鋪毗連狀態同一欄框），不是特殊設施——
> 特殊設施只有電業氣體燃料／殯葬／廢棄物處理。draft 側（`draftFieldMap.ts`）與存檔 mapper
> （`shared/db/mappers/survey.ts`）本來就把這 4 個歸在 `commercialActivity`。

## 表三比準地條件 · ComparisonCondition

```typescript
type ComparisonCondition = {
  location: string;  // 座落，如 "新北市金山區金美段489地號"
  area: string; width: string; depth: string; shape: string; frontage: string;
  terrain: string; roadType: string; roadName: string; roadWidth: string;
  schoolName: string; schoolDistance: string;
  marketName: string; marketDistance: string;
  parkName: string; parkDistance: string;
  stationName: string; stationDistance: string;
  districtName: string; districtDistance: string;
  disamenityName: string; disamenityDistance: string;
  parking: string; zoning: string;
  coverageRatio: string; plotRatio: string; buildRestriction: string;
  sectionId: string;
};
```

> 全部是 **string**（含面積、距離、比率），直接對應表單格子的顯示文字。

## 表二 · RegionalFactorRow

```typescript
type RegionalFactorRow = {
  key: string; label: string; group: string;
  subject: {                    // 比準地
    grade: string;              // "優" / "稍優" / "普通" / "稍劣" / "劣"
    points?: number;            // 修正點數（≤ 0）
    rank?: number;              // 等級序（優 = 1）
    reference?: FieldReference; warning?: string; edited?: boolean;
  };
  compare: Array<{              // 各比較標的（順序 = comparisonCases）
    sectionId: string;
    sameSectionAsBenchmark: boolean;
    grade: string;
    rate: number | null;        // 修正率% — 後端一律回 null，由前端計算
    points?: number;            // 修正點數
    rank?: number;              // 等級序
    delta?: number;             // 與比準地的點數差（base.points − 本筆 points）
    reference?: FieldReference; warning?: string; edited?: boolean;
  }>;
  custom?: boolean;
};

type RegionalFactorRemarks = { subject: string; cases: string; overall: string };
```

## 表三 · FactorRow / ComparisonForm

```typescript
/** 單一宗地條件的修正率（表三共 19 項）。 */
type FactorRow = {
  key: string; label: string; group: string;
  rate: number;               // 修正率%
  reference?: FieldReference; edited?: boolean; warning?: string;
};

/** 表三官方版式的完整內容。 */
type ComparisonForm = {
  appraisalBaseDate: string;
  caseCode: string;
  benchmarkParcelNo: string;
  benchmark: ComparisonCondition;
  cases: ComparisonFormCase[];
  benchmarkComparedPrice: number;
  caseRemark: string;
  overallRemark: string;
  fillDate: string;
};

type ComparisonFormCase = ComparisonCondition & {
  latLng?: LatLng;
  caseNo: string;
  normalPrice: number;      // 土地正常單價（元/㎡）
  tradeDate: string;
  dateAdjRate: number;      // 日期調整率%
  adjustedPrice: number;    // 日期調整後價格
  regionalAdjRate: number;  // 區域因素調整率%
  rates: ComparisonCaseRates;  // 19 項個別因素修正率
  absRateSum: number;       // 修正率絕對值加總
  priceSimilarity: string;
  weight: string;           // 權重，如 "100%"
  trialPrice: number;       // 該標的推得的試算價格
};

/** 19 項個別因素修正率。 */
type ComparisonCaseRates = {
  area: number; width: number; depth: number; shape: number; frontage: number;
  terrain: number; roadType: number; roadWidth: number;
  school: number; market: number; park: number; station: number; district: number;
  disamenity: number; parking: number; zoning: number;
  coverageRatio: number; plotRatio: number; buildRestriction: number;
};

/** 試算結果摘要。 */
type ComputedSummary = {
  dateAdj: number;          // 日期調整率%
  regionalTotal: number;    // 區域因素總修正率%
  individualTotal: number;  // 個別因素總修正率%
  trialPrice: number;       // 試算價格
};
```

## 案件與定稿 · case-store

[D](#d--case-store--案件與三表定稿儲存) 讀寫的型別。

```typescript
/** 案件狀態。由三表定稿寫入連動，不可 PATCH。 */
type CaseStatus = "draft" | "survey_done" | "regional_done" | "comparison_done";

/** 案件清單列。`status` 在 DB 是寬鬆的 string，列舉僅供呼叫端參考。 */
type CaseSummary = {
  caseId: string;
  sectionId: string;
  status: string;
  meta: CaseMeta | null;
  createdAt: string;   // ISO 8601
  updatedAt: string;
};

/**
 * 宗地身分 —— 這份表一勘查的是哪一筆地。全選填；舊資料與定位失敗的標的會整組缺。
 * 定位一筆宗地要 district + section + parcelNo 三個一起（地號在同一行政區內不唯一）。
 */
type SurveyParcelIdentity = {
  district?: string;  // '金山區'
  section?: string;   // 段名含小段，'金美段'
  sectno?: string;    // 段代碼，'1027'
  parcelNo?: string;  // 地號原樣，'489' / '31-1'
  lat?: number; lng?: number;
  areaM2?: number;    // 上游權威面積；與 benchmark.area（估價師可改的顯示值）不是同一個東西
};

/** 表一定稿 —— 宗地與比較標的同一份格式，差別只在存進哪個路由。 */
type SurveyFinal = SurveyParcelIdentity & {
  survey: SurveyField[];
  benchmark: ComparisonCondition;
};

/** GET ?form=comparison-survey 的元素：表一定稿 + 它在本案的比較標的序號。 */
type ComparisonSurveyFinal = SurveyFinal & {
  targetIndex: number;  // 0-based；對齊表二/表三的 caseNo = targetIndex + 1
};

/** 表二定稿。 */
type RegionalFactorsFinal = {
  regionalFactors: RegionalFactorRow[];
  regionalTotal: number;
  remarks: RegionalFactorRemarks;
};

/** 表三定稿。 */
type ComparisonFinal = {
  comparison: FactorRow[];
  comparisonForm: ComparisonForm;
  computed: ComputedSummary;
};

/** GET ?caseId= 的完整 bundle —— 三個 *Final 只有存過才會出現。 */
type CaseBundle = CaseSummary & {
  surveyFinal?: SurveyFinal;
  regionalFactorsFinal?: RegionalFactorsFinal;
  comparisonFinal?: ComparisonFinal;
};
```

> `SurveyParcelIdentity` 那組欄位對齊前端定位流程：`district` + `section` + 地號
> → [land-easymap](#land-easymap--地籍圖資便民系統即時查詢任何地號) 取 `center.lat/lng`、
> `fields.areaM2`、`resolved.sectno` → 存表一時一起帶上。拿歷史表一當新案的比較標的時，
> `lat`/`lng` 可直接餵進 [E](#e--produce-comparison--表三產製正式入口) 的
> `comparisonSurveys[].lat/lng`。
