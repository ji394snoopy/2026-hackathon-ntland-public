# 地價查估系統 - 後端 API 串接文檔

## 概述

本系統採用三階段表單產製流程，各階段依序調用後端 API 進行表單計算與資料同步。以下為所有需要串接的 API 端點。

---

## 1. ① 表3 勘查表產製 API

**端點**: `POST /api/produce/survey`

**功能**: 依區段編號 + 比準地座標，查詢周邊設施資料並產製表3（地價區段勘查表）

### 請求參數 (Request)

```typescript
type ProduceSurveyRequest = {
  sectionId: string; // 區段編號，如 "P002-00"
  benchmarkLocation?: { lat: number; lng: number }; // 地點＝比準地座標（可選）
  // 區段範圍多邊形（使用者在地圖上圈選的區段經緯度陣列，至少 3 點；閉合與否皆可）
  sectionPolygon?: Array<{ lat: number; lng: number }>;
  // 周邊設施的查詢範圍，原樣轉給 §2 周邊設施查詢 API（不帶則整批用基準半徑）
  facilities?: {
    radius?: number; // 基準半徑（公尺），預設 600
    // 逐類覆寫基準半徑，見 §2「逐類半徑」；字串形式為 "<類別>:<半徑>;…"
    categories?: Array<{ category: string; radius: number }> | string;
  };
};
```

| 參數                   | 型別                              | 必填 | 說明                                                                                                   |
| ---------------------- | --------------------------------- | :--: | ------------------------------------------------------------------------------------------------------ |
| `sectionId`            | string                            |  ✅  | 區段編號，如 `"P002-00"`。亦可用 `?sectionId=`                                                         |
| `benchmarkLocation`    | `{ lat, lng }`                    |  ⬜  | **地點**（比準地）座標。設施的 `metersToPoint` 量到這一點。缺這個又沒帶 `sectionPolygon` 就查不到周邊設施，設施類欄位全部降級為需人工。亦可用 `?lat=&lng=` |
| `sectionPolygon`       | `{ lat, lng }[]`                  |  ⬜  | **區段範圍多邊形**。帶了它，設施查詢的圓心改成此多邊形的幾何重心，設施因此同時回兩個距離（見下方「兩個距離」）。僅 body 支援（ring 動輒上百點，不走 query string） |
| `facilities.radius`    | number                            |  ⬜  | 周邊設施的基準半徑（公尺），預設 `600`。亦可用 `?facilityRadius=`                                      |
| `facilities.categories` | `{category, radius}[]` \| string  |  ⬜  | 逐類覆寫半徑，原樣轉給 §2 的 `cats=`；物件陣列或 `"<類別>:<半徑>;…"` 字串皆可。亦可用 `?cats=`         |

#### 兩個距離：`metersToCenter` ／ `metersToPoint`

前端的呼叫方式是 **polygon + point + range 一起帶**，後端據此：

```
input  polygon（區段範圍）+ point（地點／比準地）+ range（逐類半徑）
  ↓    圓心取 polygon 的幾何重心，以 range 逐類查設施（不是取 polygon 範圍內的設施）
  ↓    每筆設施量兩個距離
out    metersToCenter → 到區段中心     metersToPoint → 到 point
```

| 距離 | 基準點 | 誰用 | 為什麼 |
| ---- | ------ | ---- | ------ |
| `metersToCenter` | 區段多邊形的幾何重心 | **表二（表5 區域因素）grading** | 區域因素評的是整個地價區段的條件 |
| `metersToPoint` | 地點（比準地） | **表三（表4 個別因素）grading** | 個別因素評的是這一筆宗地自己 |

> ⚠️ **「用區段取中心」不是「只取區段範圍內的設施」。** 勘查標準講的是逐類半徑（站牌 800m、交流道 4000m）；區段邊界內有幾個設施是地籍事實，不是勘查範圍。
>
> 沒帶 `sectionPolygon` 時（圓心＝比準地）兩個距離相同，後端只寫 `metersToCenter`、不輸出 `metersToPoint` —— 同一個數字不抄兩次。`metersToPoint` 缺值代表「沒有第二個基準點」，**不是 0**。
>
> `sectionPolygon` 與 `benchmarkLocation` 都會原樣存進 `meta`（→ `case_survey.meta`），兩個距離事後才追溯得回去。

> ⚠️ 座標欄名注意：這裡是 `{ lat, lng }`（緯度在前、欄名 `lng`），與 §2 周邊設施查詢 API 的 `lon`/`lat` 不同。
>
> **半徑標準由呼叫端帶，後端不內建任何一套。** 站牌 800m、交流道 4000m 這類級距屬業務規則，會隨勘查標準調整；寫死在 Lambda 等於每次改標準都要重新部署。前端的標準表在 [frontend/src/lib/facilityRadiusStandards.ts](frontend/src/lib/facilityRadiusStandards.ts)（區域因素／個別因素各一套），對照表見 §2 的「目前採用的半徑標準」。不帶 `facilities.categories` 時所有類別一律用基準半徑。
>
> `facilities.categories` 的值不在本支驗證（合法類別只有周邊設施查詢 API 知道），類別名打錯會被上游擋成 `400`，本支會記 log 並降級成「查無設施」，不會整支失敗。

### 回應格式 (Response)

```typescript
type ProduceSurveyResponse = {
  meta: {
    yearPeriod: string; // 年期
    sectionId: string; // 區段編號
    district: string; // 行政區
    landUseType: string; // 用地別（根據使用分區自動推導）
    benchmarkParcel: string; // 比準地號
    surveyDate: string; // 勘查日期
    range?: string; // 區段範圍描述（例：「北側至金包里街...」）
    location?: { lat: number; lng: number }; // 地點（比準地）；metersToPoint 量到這一點
    // 請求帶的區段範圍多邊形，原樣回拋：metersToCenter 的基準點就是它的幾何重心。
    // 存進 case_survey.meta，兩個距離事後才可驗、可重算。
    sectionPolygon?: Array<{ lat: number; lng: number }>;
  };
  survey: SurveyField[]; // 表3 勘查表欄位陣列（AI 已填 + 需人工並存）
  benchmark: ComparisonCondition; // 表4 比準地宗地條件基準值
};

type SurveyField = {
  key: string; // 欄位識別碼，如 "zone_type"
  label: string; // 中文欄位名，如 "使用分區(使用地類別)"
  group: string; // 分類，如 "土地使用管制"
  value: string; // 當前值
  source: "ai" | "manual" | "edited" | "empty" | "confirmed"; // 資料來源標記
  origin?: string; // 來源簡述
  reference?: FieldReference; // 完整對照/佐證資訊
  aiSuggestion?: string; // AI 建議值
  confidence?: "high" | "low"; // 信心度
  warning?: string; // AI 自檢提示
  options?: string[]; // 下拉選項清單
  items?: Array<{
    // 多筆設施完整清單，依 metersToCenter 由近到遠
    name: string;
    metersToCenter: number; // 到區段中心 —— 表二（表5 區域因素）grading 用
    metersToPoint?: number; // 到地點（比準地）—— 表三（表4 個別因素）grading 用
  }>;
};

type FieldReference = {
  dataSource: string; // 數據來源，如 "AI 查詢｜周邊設施查詢 API"
  measurement?: string; // 量測方式，如 "直線距離"
  bracket?: string; // 依據的基準表級距
  derivation?: string; // 推導結果
  rawFact?: string; // 原始事實
};

type ComparisonCondition = {
  location: string; // 座落，如 "新北市金山區金美段489地號"
  area: string; // 面積(M²)
  width: string; // 寬度(M)
  depth: string; // 深度(M)
  shape: string; // 形狀
  frontage: string; // 臨街情形
  terrain: string; // 地勢
  roadType: string; // 道路種類
  roadName: string; // 面前道路名稱
  roadWidth: string; // 面前道路寬度(M)
  schoolName: string; // 接近學校名稱
  schoolDistance: string; // 接近學校距離(M)
  marketName: string; // 市場名稱
  marketDistance: string; // 市場距離(M)
  parkName: string; // 公園名稱
  parkDistance: string; // 公園距離(M)
  stationName: string; // 站點名稱
  stationDistance: string; // 站點距離(M)
  districtName: string; // 商圈名稱
  districtDistance: string; // 商圈距離(M)
  disamenityName: string; // 嫌惡設施名稱
  disamenityDistance: string; // 嫌惡設施距離(M)
  parking: string; // 停車情況
  zoning: string; // 使用分區或編定用地
  coverageRatio: string; // 建蔽率
  plotRatio: string; // 容積率
  buildRestriction: string; // 建築限制
  sectionId: string; // 地價區段
};
```

### `survey` 欄位完整清單（後端須逐一產生的所有 key）

`survey: SurveyField[]` 必須包含以下**全部 60 個欄位**（key 為唯一識別碼，順序不拘，但每個 key 都要有，缺一個前端表1就會漏印一列）。目前只有下表標「✅ AI 可查」的 6 個 key 有對應的資料來源（周邊設施查詢 API），其餘一律回傳空值，交由估價師人工填寫——**不可臆測或編造任何欄位值**（含 `urban_plan`／`zone_type`／`coverage_ratio`／`plot_ratio` 等看起來像是可查詢地籍/都市計畫資料的欄位，若後端尚未真的接上對應資料源，也必須留空，不能抄範例表單或用區段內其他地號的舊資料頂替）。

**兩種欄位值的產生方式（`source`/`origin`/`reference` 寫法）：**

- **查得到資料（`source: "ai"`）**：`value` 為描述性文字（多筆時用「；」串接每筆 `名稱，距XXXm`，如 `"金山國小，距150M；金美國小，距420M"`）；`origin` 格式為 `"AI 查詢｜{資料源名稱}｜共X筆，最近XXXm"`；`reference` 四欄都要填（`dataSource`/`measurement`/`derivation`/`rawFact`），供前端「對照」ⓘ 展開稽核。
  - 帶了 `sectionPolygon`（區段中心 ≠ 地點）時，每筆後面**附掛**第二個距離：`"金山國小，距150M（距比準地210M）；金美國小，距420M（距比準地380M）"`。括號前永遠是「距區段中心」，括號裡才是「距比準地」。
  - 這個格式刻意是**純附加**的：基準形 `名稱，距NNNM` 原封不動，所以既有「抓第一個 `距NNNM`」的解析（表1 列印、表3↔表4 連動、表5 級距查表）行為完全不變，只有需要第二個距離的人才去讀括號。
  - 兩點不同時 `origin` 與 `reference` 也會同時報兩個距離：`origin: "AI 查詢｜周邊設施查詢 API｜共2筆，最近距區段中心80m、距比準地520m"`、`measurement: "直線距離（距區段中心／距比準地）"`。
- **查無資料或此欄位尚無資料源（`source: "empty"`）**：`value: ""`、`origin: "AI 查無資料，需人工現場確認"`（或說明沒有對應資料源）、`reference` 留 `undefined`，**不要**填任何看似合理的預設值。

| 分類 group   | key                            | label                                        | value 格式建議                      | options（下拉選項）                                                                                                                        | AI 可查     |
| ------------ | ------------------------------ | -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 土地使用管制 | `urban_plan`                   | 都市計畫(內外)                               | 單選文字                            | 都市計畫內／都市計畫外                                                                                                                     | —           |
| 土地使用管制 | `zone_type`                    | 使用分區(使用地類別)                         | 單選文字                            | 第一種住宅區／第二種住宅區／第三種住宅區／第一種商業區／第二種商業區／第一種工業區／第二種工業區／工業區／農業區／保護區／特定專用區／其他 | —           |
| 土地使用管制 | `coverage_ratio`               | 建蔽率                                       | 百分比字串，如 `"70%"`              | —                                                                                                                                          | —           |
| 土地使用管制 | `plot_ratio`                   | 容積率                                       | 百分比字串，如 `"240%"`             | —                                                                                                                                          | —           |
| 土地使用管制 | `no_build_ban`                 | 有無禁止建築                                 | `"有"／"無"`                        | —                                                                                                                                          | —           |
| 土地使用管制 | `build_restriction`            | 有無限制建築（整體開發、面積限制、高度限制） | `"有"／"無"`（有則附說明）          | —                                                                                                                                          | —           |
| 交通運輸     | `main_road`                    | 主要道路                                     | 名稱＋寬度，如 `"中山路，寬度18M"`  | —                                                                                                                                          | —           |
| 交通運輸     | `road_avg_width`               | 區段內道路平均寬度                           | 數字＋單位，如 `"12M"`              | —                                                                                                                                          | —           |
| 交通運輸     | `road_development`             | 區段內道路規劃及闢建程度                     | 描述文字，如 `"已完全開發"`         | —                                                                                                                                          | —           |
| 交通運輸     | `hsr_station`                  | 大型車站－高鐵站                             | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 交通運輸     | `train_station`                | 大型車站－火車站                             | 同上                                | —                                                                                                                                          | —           |
| 交通運輸     | `mrt_station`                  | 大型車站－捷運站                             | 同上                                | —                                                                                                                                          | —           |
| 交通運輸     | `bus_terminal`                 | 大型車站－客運站                             | 同上                                | —                                                                                                                                          | —           |
| 交通運輸     | `bus_stop`                     | 站牌                                         | 名稱＋距離（多筆用「；」）          | —                                                                                                                                          | ✅ 公車站   |
| 交通運輸     | `interchange`                  | 交流道距離                                   | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 交通運輸     | `approach_settlement`          | 接近聚落程度                                 | 描述文字                            | —                                                                                                                                          | —           |
| 交通運輸     | `approach_distribution_center` | 接近運銷中心程度                             | 描述文字                            | —                                                                                                                                          | —           |
| 交通運輸     | `approach_market`              | 接近消費市場程度                             | 描述文字                            | —                                                                                                                                          | —           |
| 自然條件     | `drainage`                     | 保（排）水之良否                             | 描述文字，如 `"有排水系統不易淹水"` | —                                                                                                                                          | —           |
| 自然條件     | `terrain`                      | 地勢                                         | 描述文字，如 `"該區地勢平坦"`       | —                                                                                                                                          | —           |
| 自然條件     | `sunlight`                     | 日照                                         | 描述文字                            | —                                                                                                                                          | —           |
| 自然條件     | `view`                         | 景觀                                         | 描述文字                            | —                                                                                                                                          | —           |
| 自然條件     | `slope`                        | 傾斜度                                       | 描述文字                            | —                                                                                                                                          | —           |
| 自然條件     | `wind`                         | 風勢                                         | 描述文字                            | —                                                                                                                                          | —           |
| 自然條件     | `soil`                         | 土質                                         | 描述文字                            | —                                                                                                                                          | —           |
| 土地改良     | `site_improvement`             | 建築基地改良                                 | 可複選文字（逗號串接）              | 整平或填挖基地／開挖水溝／水土保持／鋪築道路／埋設管道／修築駁嵌／其他                                                                     | —           |
| 土地改良     | `farmland_improvement`         | 農地改良                                     | 可複選文字                          | 耕地整理／水土保持／土壤改良／修築農路／灌溉／排水／防風／防砂／堤防／其他                                                                 | —           |
| 公共建設     | `school`                       | 接近學校之程度（國小/國中/高中/大專院校）    | 名稱＋距離（多筆用「；」）          | —                                                                                                                                          | ✅ 文教設施 |
| 公共建設     | `market`                       | 市場                                         | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 公共建設     | `park`                         | 公園廣場徒步區                               | 名稱＋距離（多筆用「；」）          | —                                                                                                                                          | ✅ 公園     |
| 公共建設     | `tourism_facility`             | 觀光遊憩設施                                 | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 公共建設     | `parking`                      | 停車場地                                     | 名稱＋距離（多筆用「；」）          | —                                                                                                                                          | ✅ 停車場   |
| 公共建設     | `service_facility`             | 接近服務性設施的程度                         | 描述文字                            | —                                                                                                                                          | —           |
| 公共建設     | `power_resource`               | 電力資源                                     | 描述文字                            | —                                                                                                                                          | —           |
| 公共建設     | `industrial_water`             | 產業用水及設施                               | 描述文字                            | —                                                                                                                                          | —           |
| 公共建設     | `sewage_facility`              | 污廢水及廢棄物處理設施                       | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `cemetery`                     | 殯葬－墓地                                   | 名稱＋距離（多筆用「；」）          | —                                                                                                                                          | ✅ 殯葬設施 |
| 特殊設施     | `columbarium`                  | 殯葬－納骨塔                                 | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `crematorium`                  | 殯葬－火葬場                                 | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `funeral_home`                 | 殯葬－殯儀館                                 | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `substation`                   | 電業－變電所或高壓鐵塔                       | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `gas_tank`                     | 氣體燃料－瓦斯槽或儲油槽                     | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `sewage_plant`                 | 廢棄物處理－污水處理場                       | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `landfill`                     | 廢棄物處理－垃圾場或掩埋場                   | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 特殊設施     | `incinerator`                  | 廢棄物處理－焚化爐                           | 名稱＋區段內外＋距離                | —                                                                                                                                          | —           |
| 環境污染     | `water_pollution`              | 水污染                                       | 名稱＋區段內外＋距離（無則 `"無"`） | —                                                                                                                                          | —           |
| 環境污染     | `noise_pollution`              | 噪音污染                                     | 同上                                | —                                                                                                                                          | —           |
| 環境污染     | `air_pollution`                | 廢氣污染                                     | 同上                                | —                                                                                                                                          | —           |
| 環境污染     | `waste_pollution`              | 廢棄物污染                                   | 同上                                | —                                                                                                                                          | —           |
| 環境污染     | `other_pollution`              | 其他污染                                     | 同上                                | —                                                                                                                                          | —           |
| 工商活動     | `department_store`             | 百貨公司                                     | 名稱＋數量＋距離                    | —                                                                                                                                          | —           |
| 工商活動     | `financial_institution`        | 金融機構                                     | 名稱＋距離（多筆用「；」）          | —                                                                                                                                          | ✅ 金融機構 |
| 工商活動     | `entertainment`                | 娛樂設施                                     | 名稱＋數量＋距離                    | —                                                                                                                                          | —           |
| 工商活動     | `exhibition_hotel`             | 大型展示中心或觀光飯店                       | 名稱＋數量＋距離                    | —                                                                                                                                          | —           |
| 工商活動     | `customer_flow`                | 顧客之通行量                                 | 描述文字，如 `"顧客通行量多"`       | —                                                                                                                                          | —           |
| 工商活動     | `shop_adjacency`               | 店鋪之毗連狀態                               | 描述文字，如 `"90%以上作為店鋪"`    | —                                                                                                                                          | —           |
| 其他影響因素 | `other_factors`                | 其他影響因素                                 | 描述文字（官方範例此欄留白）        | —                                                                                                                                          | —           |
| 房屋建築現況 | `building_density`             | 建築密度                                     | 百分比字串，如 `"95%"`              | —                                                                                                                                          | —           |
| 房屋建築現況 | `building_type`                | 建築型態                                     | 描述文字，如 `"連棟透天厝、公寓"`   | —                                                                                                                                          | —           |
| 土地利用現況 | `land_use_status`              | 土地利用現況                                 | 單選文字                            | 商業用／住宅用／工業用／住商混合／住工混合／農作用／漁牧用／空地／公共設施／其他                                                           | —           |

> 完整的空值版本（key/label/group/options 骨架，value 全空）可參考前端目前的 mock：[frontend/src/mock/surveyFixtures.ts](frontend/src/mock/surveyFixtures.ts)。`bus_terminal` 的 label 是區段中立的「大型車站－客運站」；實際站名只會出現在 `value` 裡（由查得的設施決定），label 不帶任何區段的站名。

### Mock 範例（Request / Response）

以「金山老街 P002-00」為例，直接沿用官方範例勘查表（表1 地價區段勘查表，新北市金山區）上實際填寫的內容，逐欄轉成 `value`：

**Request**

```json
POST /api/produce/survey
{
  "sectionId": "P002-00",
  "benchmarkLocation": { "lat": 25.2219, "lng": 121.63575 },
  "facilities": {
    "radius": 600,
    "categories": [
      { "category": "metro", "radius": 2000 },
      { "category": "hsr", "radius": 2000 },
      { "category": "bus_stop", "radius": 800 },
      { "category": "motorway_junction", "radius": 4000 },
      { "category": "education", "radius": 1000 },
      { "category": "market", "radius": 1000 },
      { "category": "park", "radius": 1000 },
      { "category": "parking", "radius": 1000 },
      { "category": "special", "radius": 2000 }
    ]
  }
}
```

> `facilities` 省略時等同「所有類別都用 600m」——設施類欄位仍會填，只是嫌惡設施、交流道這種本來就該查遠一點的類別會查不到。完整的區域因素標準見 [frontend/src/lib/facilityRadiusStandards.ts](frontend/src/lib/facilityRadiusStandards.ts) 的 `REGIONAL_FACILITY_RADII`（上面 JSON 是它攤平後的樣子，此處節錄）。

**Response**

```json
{
  "meta": {
    "yearPeriod": "1140901",
    "sectionId": "P002-00",
    "district": "新北市金山區",
    "landUseType": "商業用地",
    "benchmarkParcel": "金美段489地號",
    "surveyDate": "114年09月18日",
    "range": "北側至金包里街以北臨路第一筆宗地，南側至中山路以南第一筆宗地，西側至中正路，東側至福德街之第二種商業區土地劃為P002-00區段。",
    "location": {
      "lat": 25.2219,
      "lng": 121.63575
    }
  },
  "survey": [
    {
      "key": "urban_plan",
      "label": "都市計畫(內外)",
      "group": "土地使用管制",
      "value": "都市計畫內",
      "source": "manual",
      "options": ["都市計畫內", "都市計畫外"]
    },
    {
      "key": "zone_type",
      "label": "使用分區(使用地類別)",
      "group": "土地使用管制",
      "value": "第二種商業區",
      "source": "manual",
      "options": [
        "第一種住宅區",
        "第二種住宅區",
        "第三種住宅區",
        "第一種商業區",
        "第二種商業區",
        "第一種工業區",
        "第二種工業區",
        "工業區",
        "農業區",
        "保護區",
        "特定專用區",
        "其他"
      ]
    },
    {
      "key": "coverage_ratio",
      "label": "建蔽率",
      "group": "土地使用管制",
      "value": "70%",
      "source": "manual"
    },
    {
      "key": "plot_ratio",
      "label": "容積率",
      "group": "土地使用管制",
      "value": "240%",
      "source": "manual"
    },
    {
      "key": "no_build_ban",
      "label": "有無禁止建築",
      "group": "土地使用管制",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "build_restriction",
      "label": "有無限制建築（整體開發、面積限制、高度限制）",
      "group": "土地使用管制",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "main_road",
      "label": "主要道路",
      "group": "交通運輸",
      "value": "中山路，寬度18M",
      "source": "manual"
    },
    {
      "key": "road_avg_width",
      "label": "區段內道路平均寬度",
      "group": "交通運輸",
      "value": "12M",
      "source": "manual"
    },
    {
      "key": "road_development",
      "label": "區段內道路規劃及闢建程度",
      "group": "交通運輸",
      "value": "已完全開發",
      "source": "manual"
    },
    {
      "key": "hsr_station",
      "label": "大型車站－高鐵站",
      "group": "交通運輸",
      "value": "無高鐵站",
      "source": "manual"
    },
    {
      "key": "train_station",
      "label": "大型車站－火車站",
      "group": "交通運輸",
      "value": "無火車站",
      "source": "manual"
    },
    {
      "key": "mrt_station",
      "label": "大型車站－捷運站",
      "group": "交通運輸",
      "value": "無捷運站",
      "source": "manual"
    },
    {
      "key": "bus_terminal",
      "label": "大型車站－客運站",
      "group": "交通運輸",
      "value": "國光客運金山站，本區段外距300M",
      "source": "ai",
      "origin": "AI 查詢｜周邊設施查詢 API｜最近300m",
      "items": [
        {
          "name": "國光客運金山站",
          "metersToCenter": 300
        }
      ]
    },
    {
      "key": "bus_stop",
      "label": "站牌",
      "group": "交通運輸",
      "value": "金山區公所站，本區段內，密集",
      "source": "ai",
      "origin": "AI 查詢｜周邊設施查詢 API｜最近0m",
      "items": [
        {
          "name": "金山區公所站",
          "metersToCenter": 0
        }
      ]
    },
    {
      "key": "interchange",
      "label": "交流道距離",
      "group": "交通運輸",
      "value": "無交流道",
      "source": "manual"
    },
    {
      "key": "approach_settlement",
      "label": "接近聚落程度",
      "group": "交通運輸",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "approach_distribution_center",
      "label": "接近運銷中心程度",
      "group": "交通運輸",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "approach_market",
      "label": "接近消費市場程度",
      "group": "交通運輸",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "drainage",
      "label": "保（排）水之良否",
      "group": "自然條件",
      "value": "有排水系統不易淹水",
      "source": "manual"
    },
    {
      "key": "terrain",
      "label": "地勢",
      "group": "自然條件",
      "value": "該區地勢平坦",
      "source": "manual"
    },
    {
      "key": "sunlight",
      "label": "日照",
      "group": "自然條件",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "view",
      "label": "景觀",
      "group": "自然條件",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "slope",
      "label": "傾斜度",
      "group": "自然條件",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "wind",
      "label": "風勢",
      "group": "自然條件",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "soil",
      "label": "土質",
      "group": "自然條件",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "site_improvement",
      "label": "建築基地改良",
      "group": "土地改良",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認",
      "options": [
        "整平或填挖基地",
        "開挖水溝",
        "水土保持",
        "鋪築道路",
        "埋設管道",
        "修築駁嵌",
        "其他"
      ]
    },
    {
      "key": "farmland_improvement",
      "label": "農地改良",
      "group": "土地改良",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認",
      "options": [
        "耕地整理",
        "水土保持",
        "土壤改良",
        "修築農路",
        "灌溉",
        "排水",
        "防風",
        "防砂",
        "堤防",
        "其他"
      ]
    },
    {
      "key": "school",
      "label": "接近學校之程度（國小/國中/高中/大專院校）",
      "group": "公共建設",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "market",
      "label": "市場",
      "group": "公共建設",
      "value": "金山區第一零售傳統市場，本區段內",
      "source": "manual"
    },
    {
      "key": "park",
      "label": "公園廣場徒步區",
      "group": "公共建設",
      "value": "中山溫泉里郡公園，本區段內",
      "source": "ai",
      "origin": "AI 查詢｜周邊設施查詢 API｜最近0m",
      "items": [
        {
          "name": "中山溫泉里郡公園",
          "metersToCenter": 0
        }
      ]
    },
    {
      "key": "tourism_facility",
      "label": "觀光遊憩設施",
      "group": "公共建設",
      "value": "金包里老街，本區段內",
      "source": "manual"
    },
    {
      "key": "parking",
      "label": "停車場地",
      "group": "公共建設",
      "value": "金包里老街停車場，距120M",
      "source": "ai",
      "origin": "AI 查詢｜周邊設施查詢 API｜最近120m",
      "items": [
        {
          "name": "金包里老街停車場",
          "metersToCenter": 120
        }
      ]
    },
    {
      "key": "service_facility",
      "label": "接近服務性設施的程度",
      "group": "公共建設",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "power_resource",
      "label": "電力資源",
      "group": "公共建設",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "industrial_water",
      "label": "產業用水及設施",
      "group": "公共建設",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "sewage_facility",
      "label": "污廢水及廢棄物處理設施",
      "group": "公共建設",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "cemetery",
      "label": "殯葬－墓地",
      "group": "特殊設施",
      "value": "金山第1公墓，距80M",
      "source": "ai",
      "origin": "AI 查詢｜周邊設施查詢 API｜最近80m",
      "items": [
        {
          "name": "金山第1公墓",
          "metersToCenter": 80
        }
      ]
    },
    {
      "key": "columbarium",
      "label": "殯葬－納骨塔",
      "group": "特殊設施",
      "value": "金山區公所福緣納骨堂，本區段內",
      "source": "manual"
    },
    {
      "key": "crematorium",
      "label": "殯葬－火葬場",
      "group": "特殊設施",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "funeral_home",
      "label": "殯葬－殯儀館",
      "group": "特殊設施",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "substation",
      "label": "電業－變電所或高壓鐵塔",
      "group": "特殊設施",
      "value": "金山變電所，距700M",
      "source": "manual"
    },
    {
      "key": "gas_tank",
      "label": "氣體燃料－瓦斯槽或儲油槽",
      "group": "特殊設施",
      "value": "中油金山站，距440M",
      "source": "manual"
    },
    {
      "key": "sewage_plant",
      "label": "廢棄物處理－污水處理場",
      "group": "特殊設施",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "landfill",
      "label": "廢棄物處理－垃圾場或掩埋場",
      "group": "特殊設施",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "incinerator",
      "label": "廢棄物處理－焚化爐",
      "group": "特殊設施",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "water_pollution",
      "label": "水污染",
      "group": "環境污染",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "noise_pollution",
      "label": "噪音污染",
      "group": "環境污染",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "air_pollution",
      "label": "廢氣污染",
      "group": "環境污染",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "waste_pollution",
      "label": "廢棄物污染",
      "group": "環境污染",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "other_pollution",
      "label": "其他污染",
      "group": "環境污染",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "department_store",
      "label": "百貨公司",
      "group": "工商活動",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "financial_institution",
      "label": "金融機構",
      "group": "工商活動",
      "value": "新北市金山地區農會，數量1，距210M",
      "source": "ai",
      "origin": "AI 查詢｜周邊設施查詢 API｜最近210m",
      "items": [
        {
          "name": "新北市金山地區農會",
          "metersToCenter": 210
        }
      ]
    },
    {
      "key": "entertainment",
      "label": "娛樂設施",
      "group": "工商活動",
      "value": "無",
      "source": "manual"
    },
    {
      "key": "exhibition_hotel",
      "label": "大型展示中心或觀光飯店",
      "group": "工商活動",
      "value": "新北北海溫泉洲際酒店，數量1，距850M",
      "source": "manual"
    },
    {
      "key": "customer_flow",
      "label": "顧客之通行量",
      "group": "工商活動",
      "value": "顧客通行量多",
      "source": "manual"
    },
    {
      "key": "shop_adjacency",
      "label": "店鋪之毗連狀態",
      "group": "工商活動",
      "value": "90%以上作為店鋪",
      "source": "manual"
    },
    {
      "key": "other_factors",
      "label": "其他影響因素",
      "group": "其他影響因素",
      "value": "",
      "source": "empty",
      "origin": "AI 查無資料，需人工現場確認"
    },
    {
      "key": "building_density",
      "label": "建築密度",
      "group": "房屋建築現況",
      "value": "95%",
      "source": "manual"
    },
    {
      "key": "building_type",
      "label": "建築型態",
      "group": "房屋建築現況",
      "value": "連棟透天厝、公寓",
      "source": "manual"
    },
    {
      "key": "land_use_status",
      "label": "土地利用現況",
      "group": "土地利用現況",
      "value": "住商混合",
      "source": "manual",
      "options": [
        "商業用",
        "住宅用",
        "工業用",
        "住商混合",
        "住工混合",
        "農作用",
        "漁牧用",
        "空地",
        "公共設施",
        "其他"
      ]
    }
  ],
  "benchmark": {
    "location": "新北市金山區金美段489地號",
    "area": "113.21",
    "width": "5",
    "depth": "23",
    "shape": "方形",
    "frontage": "單面臨街",
    "terrain": "平坦",
    "roadType": "主要道路",
    "roadName": "中山路",
    "roadWidth": "18",
    "schoolName": "金山國小",
    "schoolDistance": "150",
    "marketName": "金山區第一零售傳統市場",
    "marketDistance": "0",
    "parkName": "中山溫泉里郡公園",
    "parkDistance": "0",
    "stationName": "金山區公所站",
    "stationDistance": "0",
    "districtName": "老街商圈",
    "districtDistance": "0",
    "disamenityName": "金山第1公墓",
    "disamenityDistance": "80",
    "parking": "可路邊停車",
    "zoning": "第二種商業區",
    "coverageRatio": "70%",
    "plotRatio": "240%",
    "buildRestriction": "無",
    "sectionId": "P002-00"
  }
}
```

**重點提醒**：

- `value` 就是表1當初手寫/勾選的內容轉成的文字（如「金包里老街停車場，距120M」「金山區公所站，本區段內，密集」），格式不強求跟周邊設施查詢 API 的回傳格式一致，後端接上真資料源後可自行調整措辭，只要語意對應同一欄即可。
- `百貨公司`／`金融機構`／`娛樂設施`／`大型展示中心或觀光飯店`（`department_store`／`financial_institution`／`entertainment`／`exhibition_hotel`）這 4 個 key 的 `group` 是「工商活動」，不是「特殊設施」——原表單右下角這 4 項跟顧客通行量/店鋪毗連狀態同屬「工商活動」欄框，「特殊設施」欄框只有電業氣體燃料／殯葬／廢棄物處理，前端 mock（`frontend/src/mock/surveyFixtures.ts`）先前也誤把這 4 個歸到「特殊設施」，已一併修正。
- 新增 `other_factors`（其他影響因素，獨立一個 group）：表1在工商活動欄框下方留了一整列「其他影響因素」空白列，官方範例沒填，這裡固定回 `value: ""`、`source: "empty"`——之前的欄位清單漏掉這格，現在補上，`survey` 欄位總數是 60 個，不是 59 個。
- `source: "ai"` 標在 `bus_terminal`／`bus_stop`／`park`／`parking`／`financial_institution`／`cemetery` 這 6 個有對應周邊設施 kind 的欄位；`school` 雖然也在這 6 個可查欄位之列，但表1原始表單這格剛好是空的（國小/國中/高中/大專院校都沒勾選、沒填距離），所以維持 `source: "empty"`——**查無資料就照實留空，不要因為隔壁欄位有值就順手編一個學校名字補上去**。
- 其餘欄位這裡先標 `source: "manual"` 只是示意「這是既有勘查表資料、不是即時查詢結果」——**實際 `source` 怎麼標，後端應依自己實際的 AI/資料源支援程度自行決定**：例如若後端之後真的接上都市計畫/地籍查詢 API，`urban_plan`／`zone_type`／`coverage_ratio`／`plot_ratio` 就該標 `source: "ai"` 並比照 6 個可查欄位補 `origin`/`reference`，不必永遠釘死 `manual`。表單上寫「無」的（如高鐵站/火車站/捷運站/交流道/殯儀館/火葬場/各項環境污染/百貨公司/娛樂設施）就存文字 `"無"`，表單上完全空白沒填的（`接近聚落程度`／`接近運銷中心程度`／`接近消費市場程度`／`日照`／`景觀`／`傾斜度`／`風勢`／`土質`／`建築基地改良`／`農地改良`／`接近服務性設施的程度`／`電力資源`／`產業用水及設施`／`other_factors`）才是 `source: "empty"`、`value: ""`——「無」和「空白」在表單上是兩種不同意思，不要混為一談。
- `reference.dataSource` / `reference.derivation` 裡寫的半徑，要用**該類別實際查詢的半徑**（周邊設施查詢 API 回應的 `area.categoryRadii[該類]`，沒被覆寫的類別才是 `area.radiusMeters`）。嫌惡設施查 2000m 卻寫成「AI 於半徑600m內查得」會原樣印進勘查表，是不實敘述。
- `benchmark.parking`（停車方便性，如「可路邊停車」）跟 `survey.parking`（表3的「停車場地」名稱+距離，如「金包里老街停車場，距120M」）是兩個不同語意的欄位，不要搞混。`benchmark.schoolName`/`schoolDistance` 這裡補回既有基準值「金山國小／150M」——雖然表1這次掃描的範例剛好沒填 `school`，但 `benchmark`（表4比準地基準值）跟 `survey.school`（表3這一格）是各自獨立的資料，不應該因為表3某格空白就連帶清空表4已知的比準地資料。

### 調用時機

- 使用者在「產製任務」頁標記比準地座標後，點擊「開始查詢」

### 關聯 API

- 內部會呼叫 **周邊設施查詢 API** (`GET /api/facilities`)，`facilities.radius` / `facilities.categories`
  原樣轉成該支的 `radius` / `cats`；設施查詢失敗或沒帶座標時，設施類欄位降級為 `source: "empty"`
  （需人工），其餘欄位照常產出

---

## 2. 周邊設施查詢 API

**端點**: `GET /api/facilities?lon={longitude}&lat={latitude}&radius={meters}&cats={類別:半徑;…}`
（另支援 polygon 模式，見下方「請求參數」；GET 用 query string、POST 用同結構 JSON body）

**功能**: 依座標半徑（或多邊形）查詢周邊設施與門牌，回傳與查詢中心（或多邊形形心）的距離
（用於表3和表4的距離對照）。另可帶 `point` 取得**第二個距離**，一次查詢同時交代
「距區段中心」與「距比準地」兩個基準

**實作**: `infra/lambda/facilities/`，本機走 Docker PostGIS（`FACILITIES_DB_DRIVER=pg`），
雲端走 Aurora RDS Data API（`FACILITIES_DB_DRIVER=data-api`）。範例輸入/輸出見
[`tests/examples/README.md`](tests/examples/README.md)。

### 請求參數

三種輸入模式擇一，後端 `parseArea()` 統一處理：

| 模式                        | 參數                                                                                                             | 成員判定       | 距離基準（`metersToCenter`） |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------- |
| radius（1 點 + 半徑）       | `lon`、`lat`（必需）、`radius`（選填，公尺，預設 500，上限 20000）、`categories`／`cats`（選填，逐類覆寫，見下） | 中心起算的半徑 | 中心點                      |
| polygon（多邊形，包含判定） | `poly=lon,lat;lon,lat;...`（GET）或 `polygon`: GeoJSON Polygon／`[lon,lat][]`（POST body）                        | 多邊形內       | 多邊形 centroid             |
| **polygon + radius**        | 上面兩組一起帶（`categories` 在此可用）                                                                          | **中心起算的半徑** | **多邊形 centroid**     |

- **polygon + radius**：多邊形**只用來取中心**，成員判定走逐類半徑。這是表1 勘查表的流程——
  勘查標準講的是逐類半徑（站牌 800m、交流道 4000m），區段邊界內有幾個設施是地籍事實，不是勘查範圍。
- `categories`（逐類半徑）需要有 `radius`：只帶 polygon（包含判定）配 `categories` 一律 `400`，
  因為多邊形的邊界就是範圍，沒有「從中心再往外擴」這件事。加個 `radius` 就進上面第三種模式。
- 座標另接受 `center`（POST 用 `[lon, lat]` 陣列、GET 用 `"lon,lat"` 字串）與 `center_lon`/`center_lat` 兩種寫法。

#### `point`（第二量測點）

三種模式都可以再帶一個 `point`：**只多回一個距離，完全不影響查得到哪些設施**。

| 寫法 | 範例 |
| ---- | ---- |
| POST 陣列 | `"point": [121.63575, 25.2219]` |
| GET／POST 字串 | `point=121.63575,25.2219` |
| 分開兩欄 | `pointLon=121.63575&pointLat=25.2219` |

每筆設施（以及 `byCategory[].nearest`、`doorplate.nearest`）因此多一個 `metersToPoint`；
沒帶 `point` 就**不輸出這個欄位**（缺值＝沒有第二個基準點，不是 0）。
回傳的 `area` 會回拋 `point`，並在中心由多邊形推導時標 `centerFrom: "polygon"`。

> 排序與「最近」一律仍以 `metersToCenter` 為準（那是這次查詢的範圍自己的順序）；要「離 point 最近」的那筆，由呼叫端自己挑。

### 逐類半徑（`categories` / `cats`）

只做**覆寫**：列到的類別用自己的半徑，沒列到的一律吃基準 `radius`。可放大也可縮小——嫌惡設施拉到 2000~3000m 才問得出「最近的在哪」，公車站維持 800m 才不會回一堆用不到的站牌。

```jsonc
// POST：物件陣列
{
  "center": [121.63575, 25.2219],
  "radius": 600,
  "categories": [
    { "category": "特殊設施", "radius": 3000 },
    { "category": "公車站", "radius": 800 },
  ],
}
```

```http
GET /api/facilities?lon=121.63575&lat=25.2219&radius=600&cats=special:3000;公車站:800
```

`category` 四種寫法都通，群組會展開成底下所有類別：

| 寫法          | 例                                                                          |
| ------------- | --------------------------------------------------------------------------- |
| 群組中文名    | `特殊設施`（＝底下 7 類嫌惡設施全部）                                       |
| 群組英文別名  | `transport` / `public_facility` / `infrastructure` / `special` / `commerce` |
| `category` 鍵 | `park`、`cemetery`、`medical`                                               |
| 車站英文別名  | `metro`（捷運站）／`hsr`（高鐵站）／`bus_stop`（公車站）                    |
| 中文 `kind`   | `公園`、`殯葬設施`、`公車站`                                                |

**目前採用的半徑標準**（區域因素由 §1 表3產製帶入，個別因素由表4那條路徑帶入；權威來源是 [frontend/src/lib/facilityRadiusStandards.ts](frontend/src/lib/facilityRadiusStandards.ts)）

| 項目                 | 區域因素 | 個別因素 | `category`                                         |
| -------------------- | :------: | :------: | -------------------------------------------------- |
| 大型車站             |   2000   |   2000   | `metro` / `hsr`                                    |
| 站牌／車站           |   800    |   2000   | `bus_stop`                                         |
| 交流道               |   4000   |    —     | `motorway_junction`                                |
| 學校                 |   1000   |   2000   | `education`                                        |
| 市場                 |   1000   |   2000   | `market`                                           |
| 公園、廣場           |   1000   |   2000   | `park`                                             |
| 觀光                 |   2000   |    —     | `tourism`                                          |
| 停車場               |   1000   |    —     | `parking`                                          |
| 服務性設施／商圈     |   2000   |   2000   | `medical`、`commerce`                              |
| 電器設施、燃料設施   |   2000   |   2000   | `substation`、`power_tower`、`gas_storage`、`fuel` |
| 殯葬                 |   2000   |   2000   | `cemetery`、`crematorium`                          |
| 廢棄物處理設施       |   2000   |   2000   | `waste`                                            |
| 環境污染             |   2000   |    —     | `wastewater`                                       |
| 嫌惡設施（整群）     |    —     |   2000   | `special`                                          |
| 基準半徑（其餘類別） |   600    |   600    | —                                                  |

> - 群組與單項重疊時取**較大**的半徑（呼叫端既然在某處要求了那個範圍，靜默縮小才是更意外的結果）。
> - `其他` 沒有固定成員，不能指定半徑，指定會回 `400`。
> - 門牌 `doorplate` **不受逐類覆寫影響**，一律用基準 `radius`（它是座標→地址的對照，不是設施圖層）。
> - 多邊形**包含判定**模式不支援 `categories`（邊界就是範圍，沒有「從中心放大」的語意），同時給會回 `400`；改帶 `polygon + radius` 就可以用（多邊形只取中心）。

### 回應格式

```typescript
type NearbyFacilitiesResponse = {
  area: {
    kind: "radius" | "polygon"; // polygon + radius 解析成 "radius"（多邊形只用來取中心）
    center: { lon: number; lat: number }; // radius 模式為查詢中心；polygon 模式為多邊形 centroid
    centerFrom?: "polygon"; // center 由多邊形的幾何重心推導而來（呼叫端帶了 polygon + radius）
    point?: { lon: number; lat: number }; // 呼叫端帶的第二量測點，原樣回拋
    radiusMeters?: number; // 基準半徑，未被 categoryRadii 覆寫的類別用它（只有 radius 模式才有）
    maxRadiusMeters?: number; // 本次實際查到的最遠半徑＝max(radiusMeters, ...categoryRadii)（只有 radius 模式才有）
    categoryRadii?: Record<string, number>; // 逐類實際套用的半徑，只列有覆寫的（只有 radius 模式才有）
    // categoryRadii 的 key 是展開後的最小單位：`category` 鍵（park/cemetery…）或車站的中文 kind
    // （捷運站/高鐵站/公車站，這三張表沒有 category）。要寫佐證文字時：
    //   area.categoryRadii?.[item.category ?? item.kind] ?? area.radiusMeters
  };
  facilities: FacilityItem[]; // 扁平清單，依距離排序，給地圖疊點用
  byCategory: Record<string, FacilityCategorySummary>; // 六大類 rollup，給報告 UI 用
  doorplate: {
    count: number; // 範圍內門牌總數（不逐筆回傳，約 2M 筆量級）
    nearest: DoorplateItem[]; // 最近 5 筆
  };
};

type FacilityItem = {
  kind: string; // 中文類別標籤，如 "文教設施"／"金融機構"／"捷運站"
  category?: string; // 穩定分類鍵（OSM/NLSC 來源才有），如 "education"／"bank"／"cemetery"；
  // 站點資料（捷運/高鐵/公車站）無 category
  name: string | null;
  lon: number;
  lat: number;
  metersToCenter: number; // 到 area.center（查詢中心／多邊形 centroid）的距離
  metersToPoint?: number; // 到 area.point 的距離；呼叫端沒帶 point 時不輸出（缺值 ≠ 0）
};

type FacilityCategorySummary = {
  count: number;
  // 「最近」一律以 metersToCenter 為準，與 items 的排序一致
  nearest: {
    kind: string;
    name: string | null;
    metersToCenter: number;
    metersToPoint?: number;
  } | null;
  items: FacilityItem[]; // 該大類全部，已依 metersToCenter 排序
};

type DoorplateItem = {
  address: string;
  lon: number;
  lat: number;
  metersToCenter: number;
  metersToPoint?: number; // 同上：只在呼叫端帶了 point 時才有
};
```

### 資料來源（`facilities` 為三個來源合流）

| 來源                          | 內容                                                              | 查法                                                                         |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PostGIS 站點表                | 捷運站／高鐵站／公車站                                            | 空間查詢，無 `category`                                                      |
| PostGIS `pois` 表（OSM 快照） | 公園／市場／停車場／百貨／金融／飯店／變電所／電塔／焚化／污廢水… | 空間查詢，帶 `category`                                                      |
| NLSC 環域 API（即時）         | 殯葬／火葬場／加油站／醫療／文教                                  | 即時呼叫，帶 `category`；單類 8 秒 timeout，失敗會被吞掉回空，不影響其他來源 |

> NLSC 這幾類同樣吃 `radius` / `categories`：**說 300m 就是 300m，不再有內建下限**（舊版對這幾類有 800~1000m 的隱藏下限，`radius=600` 也會回 900m 外的設施）。要更大範圍請顯式覆寫，如 `cats=medical:1000;education:800`。

### 六大類 ↔ category 對應（`byCategory` 的 key）

| 大類     | 內含 category / kind                                                             | 群組別名          | 表3/表4 關聯欄位                         |
| -------- | -------------------------------------------------------------------------------- | ----------------- | ---------------------------------------- |
| 交通     | 捷運站／高鐵站／公車站（無 category）、`motorway_junction`、`settlement`         | `transport`       | stationName/Distance                     |
| 公共設施 | `market` `park` `education` `medical`                                            | `public_facility` | schoolName/Distance、marketName/Distance |
| 公共建設 | `tourism` `parking` `wastewater`                                                 | `infrastructure`  | —                                        |
| 特殊設施 | `substation` `power_tower` `gas_storage` `waste` `cemetery` `crematorium` `fuel` | `special`         | disamenityName/Distance                  |
| 工商活動 | `department_store` `bank` `entertainment` `hotel`                                | `commerce`        | —                                        |
| 其他     | 未對應到上面的（不會靜默消失）                                                   | —（不可指定半徑） | —                                        |

`category` → 中文 `kind` 對照：`market` 市場、`park` 公園、`education` 文教設施、`medical` 醫療設施、`tourism` 觀光設施、`parking` 停車場、`wastewater` 污廢水處理設施、`substation` 變電所、`power_tower` 高壓電塔、`gas_storage` 儲氣/儲油槽、`waste` 垃圾/焚化設施、`cemetery` 殯葬設施、`crematorium` 火葬場、`fuel` 加油站、`department_store` 百貨公司、`bank` 金融機構、`entertainment` 娛樂設施、`hotel` 觀光飯店、`motorway_junction` 交流道、`settlement` 聚落。

### 調用時機

- 表3產製 API 內部調用（查詢比準地周邊設施）
- 表4產製 API（針對各比較標的座標查詢設施）

### 備註

- 實際回傳的設施數量由搜尋半徑（或多邊形）內的資料庫記錄與 NLSC 即時查詢結果決定
- 若某類別無設施，`byCategory` 該項 `count` 為 0、`items` 為空陣列
- 部署後 Function URL 已開 CORS，前端可直接打，不需要額外後端代理
- **關掉 NLSC**（離線 demo、或不想打外部 API）：設環境變數 `FACILITIES_INCLUDE_NLSC=off`，
  只回 PostGIS 兩個來源

錯誤回傳一律是 `{ "error": "..." }`：

| HTTP  | body                                                                                          | 情境                                    |
| ----- | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| `400` | `Provide either a polygon (polygon/poly) or a center + radius (center/lon+lat, radius).`      | 兩種範圍都沒給                          |
| `400` | `radius must be a positive number of meters.` ／ `radius must be <= 20000 meters.`            | 半徑非正數或超過上限                    |
| `400` | `categories["xxx"].radius must be a positive number of meters.`                               | 逐類半徑非正數或超過上限                |
| `400` | `Unknown category: "xxx". Valid values: …`                                                    | 類別名稱打錯（含指定 `其他`）           |
| `400` | `categories entry "xxx" must be "<category>:<radius>".`                                       | `cats=` 字串格式不對（少冒號）          |
| `400` | `categories[] (per-category radius) is only supported with a center + radius, not a polygon.` | 多邊形模式帶了 `categories`             |
| `400` | `Coordinate out of range: [x, y].`                                                            | 經緯度超出 ±180 / ±90（常見於經緯寫反） |
| `400` | `A polygon needs at least 3 points.`                                                          | 多邊形點數不足                          |
| `502` | DB 查詢失敗                                                                                   | —                                       |

---

## 3. ② 表5 區域因素分析明細表產製 API

**端點**: `POST /api/produce/regional-factors`

**功能**: 拿表3使用者確認後的勘查資料 + 基準明細表，內部查表判等級、算修正率、算總修正數

### 請求參數

```typescript
// ⚠️ v2 合併鏈：收「比準地整份表1 + N 份比較標的表1」。評分核心一次只評一筆地，要有比較欄
// 就得對 1+N 份各評一次再合成，故 request 從「單份」改為「比準地一份 + comparables[] 陣列」。
// 詳細說明見文末「契約變更（2026-09，斷點接線後）」節。
type ProduceRegionalFactorsRequest = {
  sectionId: string; // 比準地區段編號
  benchmark: Table1Final; // 比準地的「表1 定稿」整份（含 meta/survey/benchmark，見下）
  comparables?: ComparableTable1Final[]; // 比較標的 0~3 份；每份是一份表1 定稿 + caseNo
  caseCode?: string; // 案號（選填）
  remarks?: RegionalFactorRemarks; // 備註（選填）
};

// 一筆地的「表1 定稿」：產表1（POST /api/produce/survey）回的 meta + 使用者確認後的 survey + benchmark。
type Table1Final = {
  meta: Record<string, unknown>; // 該筆地的 meta
  survey: SurveyField[]; // 該筆地的表1 勘查表（非空陣列）
  benchmark: ComparisonCondition; // 該筆地的宗地條件
};

// 比較標的：一份表1 定稿 + 案號（caseNo 省略時後端用陣列序號 "1".."3"）。
type ComparableTable1Final = Table1Final & { caseNo?: string };
```

> ⚠️ **舊版相容性**：本端點 request 的舊形狀（單份 `{ sectionId, survey, benchmark }` + `comparisonSurveys`
>
> - `benchmarkTablePdf`）**已淘汰**，後端實作以上方新形狀為準。頂層 `benchmark` 現在是「比準地整份表1
>   定稿」（含 meta/survey/benchmark），**不是**單一 `ComparisonCondition`。評價基準表 `factor-standard`
>   已 inline 進評分鏈，不再由 request 帶 PDF。

### 回應格式

```typescript
type ProduceRegionalFactorsResponse = {
  regionalFactors: RegionalFactorRow[]; // 表5 區域因素分析明細表（8大類因素 + 28個固定項目，見 lib/regionalFactorGroups.ts；第8類「其他影響因素」官方範本無固定細項，一律由使用者自建）
  regionalTotal: number; // 總修正率（百分比）
  caseCode: string; // 案號
  comparisonCases: Array<{
    // 比較標的身分資訊（1~3筆）
    caseNo: string; // 案號，如 "1"、"2"
    sectionId: string; // 所在區段編號
  }>;
  regionalFactorRemarks: RegionalFactorRemarks;
};

type RegionalFactorRemarks = {
  // 表5備註欄（下表說明各欄位用途）
  subject: string; // 比準地備註
  cases: string; // 各比較標的備註
  overall: string; // 全案備註
};

| 備註對象 | 字段 | 說明 |
|---------|------|------|
| 比準地 | `subject` | 比準地選取理由及條件說明 |
| 各比較標的 | `cases` | 各比較標的身分及跨區段調整理由（如適用） |
| 全案 | `overall` | 全案其他重要說明或補充 |

type RegionalFactorRow = {
  key: string; // 因素識別碼，如 "transportation"
  label: string; // 中文標籤，如 "交通運輸"
  group: string; // 分類，如 "交通運輸"
  subject: RegionalFactorSubject; // 比準地：等級、對照、警告
  compare: RegionalFactorCompare[]; // 比較標的1~3：等級、修正率、對照、警告
  custom?: boolean; // 是否為用戶自建項目（「其他影響因素」）
};

type RegionalFactorSubject = {
  grade: string; // 優劣等級，如 "優"、"普通"、"劣"
  reference?: FieldReference; // 對照/佐證
  warning?: string; // 警告提示
  edited?: boolean; // 是否已手動編輯
};

type RegionalFactorCompare = {
  sectionId: string; // 該比較標的所在區段
  sameSectionAsBenchmark: boolean; // 是否與比準地同區段
  grade: string; // 等級
  rate: number | null; // 修正率（null 表示需人工複核）
  reference?: FieldReference; // 對照/佐證
  warning?: string; // 警告提示
  edited?: boolean; // 是否已手動編輯
};
```

### 調用時機

- 使用者確認表3後，點擊「確認」進入表5編輯頁

### 計算邏輯

- 比準地等級：按表3事實查 `benchmarkTablePdf`（評價基準明細表）判定
- 比較標的等級：
  - 同區段→鏡射比準地等級，修正率 = 0
  - 跨區段→按該區段既有查詢結果初始等級，查表算修正率
- 總修正率 = 各比較標的第1筆的修正率加總

### Mock 範例（Request / Response）

延續①的「金山老街 P002-00」案例（承接①確認後的 `survey`/`benchmark`，內容同前一節）。比較樣本1與比準地同屬 `P002-00` 區段（同官方範本 表5-2，案號 `1140901-99-001`），所以**這個範例裡每一列的 `compare[0].rate` 一律是 `0`（同區段、區域因素相同，不修正），`regionalTotal` 也因此是 `0`**——這不代表所有比較標的都不修正，只是這個特定案例剛好比較樣本1同區段；跨區段的比較標的才會真的查表算出非零修正率。

`survey`/`benchmark` 內容因為跟①完全相同，這裡用 `"...同①的 Response.survey"` 佔位表示，實際串接時請帶完整陣列，不要真的傳這個字串：

**Request**

```json
POST /api/produce/regional-factors
{
  "sectionId": "P002-00",
  "survey": "...同①的 Response.survey（60 筆完整陣列，此處省略重複貼出）",
  "benchmark": "...同①的 Response.benchmark",
  "benchmarkTablePdf": "<base64 字串，主辦當天提供的評價基準明細表 PDF，此處省略完整內容>"
}
```

**Response**

```json
{
  "regionalFactors": [
    {
      "key": "urban_plan_r",
      "label": "都市計畫（內、外）",
      "group": "土地使用管制",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "zone_type_r",
      "label": "使用分區（使用地類別）",
      "group": "土地使用管制",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "coverage_ratio_r",
      "label": "建蔽率",
      "group": "土地使用管制",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "plot_ratio_r",
      "label": "容積率",
      "group": "土地使用管制",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "no_build_ban_r",
      "label": "有無禁止建築",
      "group": "土地使用管制",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "build_restriction_r",
      "label": "有無限制建築（整體開發、面積限制、高度限制……等）",
      "group": "土地使用管制",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "road_r",
      "label": "主要道路寬度",
      "group": "交通運輸",
      "subject": {
        "grade": "普通",
        "reference": {
          "dataSource": "區域因素基準表｜交通運輸",
          "bracket": "劣<8m｜普通8-15m｜優>15m",
          "derivation": "12m 落在「普通」級",
          "rawFact": "勘查表-區段內道路平均寬度：12M"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "普通",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "road_avg_width_r",
      "label": "區段內道路平均寬度",
      "group": "交通運輸",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "station_access_r",
      "label": "接近大型車站之程度",
      "group": "交通運輸",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "bus_r",
      "label": "站牌之接近程度或密集程度",
      "group": "交通運輸",
      "subject": {
        "grade": "優",
        "reference": {
          "dataSource": "區域因素基準表｜交通運輸",
          "bracket": "優<200m｜普通200-500m｜劣>500m",
          "derivation": "0m（本區段內）落在「優」級",
          "rawFact": "勘查表-站牌：金山區公所站，本區段內"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "優",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "interchange_r",
      "label": "交流道之有無及接近交流道之程度",
      "group": "交通運輸",
      "subject": {
        "grade": "",
        "warning": "需人工複核：表3數值「無交流道」無法判讀",
        "reference": {
          "dataSource": "區域因素基準表",
          "derivation": "無法自動判定（表3數值「無交流道」無法判讀），請人工填寫等級"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "road_plan_r",
      "label": "區段內道路規劃及闢建程度",
      "group": "交通運輸",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "drain_r",
      "label": "排水之良否",
      "group": "自然條件",
      "subject": {
        "grade": "優",
        "reference": {
          "dataSource": "區域因素基準表｜自然條件",
          "bracket": "優：不易淹水｜普通：偶有積水｜劣：容易淹水",
          "derivation": "「有排水系統不易淹水」對應「優」級",
          "rawFact": "勘查表-保（排）水之良否：有排水系統不易淹水"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "優",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "terrain_r",
      "label": "地勢",
      "group": "自然條件",
      "subject": {
        "grade": "優",
        "reference": {
          "dataSource": "區域因素基準表｜自然條件",
          "bracket": "優：平坦｜普通：緩坡｜劣：陡坡",
          "derivation": "「該區地勢平坦」對應「優」級",
          "rawFact": "勘查表-地勢：該區地勢平坦"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "優",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "market_r",
      "label": "接近市場之程度（傳統市場、超級市場、超大型購物中心）",
      "group": "公共建設",
      "subject": {
        "grade": "",
        "warning": "需人工複核：表3數值「金山區第一零售傳統市場，本區段內」無法判讀",
        "reference": {
          "dataSource": "區域因素基準表",
          "derivation": "無法自動判定（表3數值「金山區第一零售傳統市場，本區段內」無法判讀），請人工填寫等級"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "park_r",
      "label": "接近公園（里鄰公園、一般公園）、廣場、徒步區之程度",
      "group": "公共建設",
      "subject": {
        "grade": "優",
        "reference": {
          "dataSource": "區域因素基準表｜公共建設",
          "bracket": "優<200m｜普通200-600m｜劣>600m",
          "derivation": "0m（本區段內）落在「優」級",
          "rawFact": "勘查表-公園廣場徒步區：中山溫泉里郡公園，本區段內"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "優",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "recreation_access_r",
      "label": "接近觀光遊憩設施之程度",
      "group": "公共建設",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "parking_r",
      "label": "停車場地之便利程度",
      "group": "公共建設",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "power_r",
      "label": "電業設施及公用氣體燃料設施之有無及接近程度",
      "group": "特殊設施",
      "subject": {
        "grade": "劣",
        "edited": true,
        "reference": {
          "dataSource": "區域因素基準表｜特殊設施",
          "bracket": "無0%｜輕微-2%｜明顯-5%｜嚴重-10%",
          "derivation": "人工現場勘查認定電業設施影響「輕微」，對應「劣」等級（基準表無對應表3查詢欄位，全由人工判定）"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "劣",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "cemetery_r",
      "label": "殯葬設施之有無及接近程度",
      "group": "特殊設施",
      "subject": {
        "grade": "劣",
        "reference": {
          "dataSource": "區域因素基準表｜特殊設施",
          "bracket": "優≥500m｜稍優300-500m｜普通100-300m｜劣<100m",
          "derivation": "80m 落在「劣」級",
          "rawFact": "勘查表-殯葬設施：金山第1公墓，距80M"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "劣",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "waste_facility_r",
      "label": "廢棄物處理設施之有無及接近程度",
      "group": "特殊設施",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "air_r",
      "label": "水污染、噪音污染、廢氣污染、廢棄物污染等之有無及接近程度",
      "group": "環境污染",
      "subject": {
        "grade": "優",
        "reference": {
          "dataSource": "區域因素基準表｜環境污染",
          "bracket": "優：無｜普通：輕微｜劣：明顯以上",
          "derivation": "「無」對應「優」級",
          "rawFact": "勘查表-廢氣污染：無"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "優",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "dept_store_r",
      "label": "百貨公司之有無、數量、接近程度",
      "group": "工商活動",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "financial_r",
      "label": "金融機構之有無、數量、接近程度",
      "group": "工商活動",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "entertainment_r",
      "label": "娛樂設施之有無、數量、接近程度",
      "group": "工商活動",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "exhibition_hotel_r",
      "label": "大型展示中心或觀光飯店之有無、數量、接近程度",
      "group": "工商活動",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    },
    {
      "key": "customer_flow_r",
      "label": "顧客通行量之多寡",
      "group": "工商活動",
      "subject": {
        "grade": "優",
        "reference": {
          "dataSource": "區域因素基準表｜工商活動",
          "bracket": "優｜普通｜劣",
          "derivation": "「顧客通行量多」對應「優」級",
          "rawFact": "勘查表-顧客之通行量：顧客通行量多"
        }
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "優",
          "rate": 0,
          "reference": {
            "dataSource": "區域因素基準表",
            "derivation": "與比準地同一地價區段，區域因素相同，修正率 0.00%",
            "rawFact": "比較標的地價區段：P002-00（與比準地 P002-00 相同）"
          }
        }
      ]
    },
    {
      "key": "shop_frontage_r",
      "label": "店舖之毗連狀態",
      "group": "工商活動",
      "subject": {
        "grade": "",
        "warning": "AI 無資料，需人工現場判斷"
      },
      "compare": [
        {
          "sectionId": "P002-00",
          "sameSectionAsBenchmark": true,
          "grade": "",
          "rate": null,
          "warning": "需人工複核：比準地等級尚未判定"
        }
      ]
    }
  ],
  "regionalTotal": 0,
  "caseCode": "1140901-99-001",
  "comparisonCases": [
    {
      "caseNo": "1",
      "sectionId": "P002-00"
    }
  ],
  "regionalFactorRemarks": {
    "subject": "",
    "cases": "比較標的1與比準地同屬 P002-00 區段，區域因素相同，修正率一律 0.00%。",
    "overall": ""
  }
}
```

**重點提醒**：

- `regionalFactors` 固定 28 筆（見 `lib/regionalFactorGroups.ts`），這裡只有 **10 筆**（`road_r`／`bus_r`／`park_r`／`cemetery_r`／`drain_r`／`terrain_r`／`air_r`／`customer_flow_r` 這 8 個，加上 `interchange_r`／`market_r` 雖然有查表依據但這個案例的表3事實查不到有效數字）是後端可以真的依基準表（`benchmarkTablePdf`）自動查表算出來的；`power_r` 目前沒有對應的表3欄位可比對，維持人工判定（`edited: true`）；**其餘 17 筆（都市計畫/使用分區/建蔽率/容積率/接近大型車站/區段內道路規劃/接近觀光遊憩/停車場地之便利程度/廢棄物處理設施/百貨公司/娛樂設施/店舖毗連狀態…）目前沒有查表依據，一律 `grade: ""` + `warning: "AI 無資料，需人工現場判斷"`，交給估價師人工判定**——不要照抄官方範本紙本上估價師已經填好的「優/普通/劣」字面值當作 AI 算出來的結果，那些是人工判斷，不是查表判定。
- `interchange_r`：表3的 `interchange` 欄位這個案例是「無交流道」，沒有數字可供 `優<5km｜普通5-15km｜劣>15km` 這個級距查表，所以是「需人工複核」，不是套用舊版 mock 資料裡假設的「約18km」——那筆是另一個情境的殘留資料，跟這次金山老街的表3事實對不上，不要沿用。
- `market_r`：表3的 `market` 欄位值是「金山區第一零售傳統市場，本區段內」，因為 `market` 不在目前周邊設施查詢 API 有對應 kind 的 6 個欄位裡（沒有 `items`），文字裡也沒有可解析的距離數字，所以現況一樣是「需人工複核」，不是自動算出「優」。
- `compare[0].reference`／`warning` 的寫法比照 `computeCompareCell()` 現有邏輯：同區段且比準地已判定等級 → 給 `reference`（無 `warning`）；比準地也還沒判定出等級 → 給 `warning: "需人工複核：比準地等級尚未判定"`（無 `reference`）。
- `regionalFactorRemarks` 三欄預設空白（`subject`/`overall`），只有在有實際需要說明的情況才填字（如這裡 `cases` 說明同區段修正率為何全是 0），不要每次都塞制式文字撐版面。

---

## 4. ③ 表4 比較法調查估價表產製 API

**端點**: `POST /api/produce/comparison`

**功能**: 帶入表5總修正數 + 比較標的座標，算個別因素差異與試算價格

### 請求參數

```typescript
type ProduceComparisonRequest = {
  sectionId: string; // 區段編號
  regionalFactors: RegionalFactorRow[]; // 使用者確認(可能已編輯)後的表5
  regionalTotal: number; // 表5 總修正率
  benchmark: ComparisonCondition; // 承接①②，作為最終比準地條件
  benchmarkSurvey?: SurveyField[]; // v2：比準地的表3，供個別因素評分佐證（選填）
  comparisonLocations?: LocationInput[]; // 比較標的座標（最多3筆；圖台定位用）
  // v2 合併鏈新增：每個比較標的各自「自己的表3」（survey + benchmark）。後端對每份打
  // individual-factor-grading → buildFillReport 合成 comparison（delta = 修正率%），
  // 各項條件欄取自該標的自己的 benchmark。可選帶 tradeDate/normalPrice/weight 覆寫市場面。
  comparisonSurveys?: Array<{
    address?: string;
    lat?: number;
    lng?: number;
    survey?: SurveyField[];
    benchmark: ComparisonCondition;
    tradeDate?: string;
    normalPrice?: number;
    weight?: number;
  }>;
};

type LocationInput = {
  address: string; // 地址（寫入 comparisonForm.cases[i].location 座落欄位）
  lat: number; // 緯度
  lng: number; // 經度
};
```

### 回應格式

```typescript
type ProduceComparisonResponse = {
  comparison: FactorRow[]; // 表4 個別因素（簡化版，用於互動編輯）
  comparisonForm: ComparisonForm; // 表4 官方版式完整資料
  computed: {
    // 試算結果摘要
    dateAdj: number; // 日期調整率(%)
    regionalTotal: number; // 區域因素總修正率(%)
    individualTotal: number; // 個別因素 |修正率| 加總
    trialPrice: number; // 最終試算價格
    // 注意：詳細計算結果（如各 case 的 dateAdjRate、adjustedPrice 等）
    // 已包含在 comparisonForm.cases[] 內，以避免資料重複
  };
};

type FactorRow = {
  key: string; // 因素識別碼
  label: string; // 中文標籤
  group: string; // 分類
  rate: number; // 修正率(%)
  reference?: FieldReference; // 對照/佐證
  edited?: boolean; // 是否已編輯
  warning?: string; // 警告提示
};

type ComparisonForm = {
  appraisalBaseDate: string; // 估價基準日，如 "1140901"
  caseCode: string; // 案號
  benchmarkParcelNo: string; // 比準地號
  benchmark: ComparisonCondition; // 比準地完整宗地條件
  cases: Array<{
    latLng?: { lat: number; lng: number }; // 比較標的座標(WGS84)，來自使用者於地點標記頁標記之座標，供圖台定位使用
    caseNo: string; // 案號
    location: string; // 座落地址
    normalPrice: number; // 正常交易價格
    tradeDate: string; // 交易日期，如 "114.05.28"
    dateAdjRate: number; // 日期調整率(%)
    adjustedPrice: number; // 日期調整後價格
    regionalAdjRate: number; // 區域因素調整率(%)
    // ... 其他 19 個個別因素條件欄位
    area: string;
    width: string;
    depth: string;
    shape: string;
    frontage: string;
    terrain: string;
    roadType: string;
    roadName: string;
    roadWidth: string;
    schoolName: string;
    schoolDistance: string;
    marketName: string;
    marketDistance: string;
    parkName: string;
    parkDistance: string;
    stationName: string;
    stationDistance: string;
    districtName: string;
    districtDistance: string;
    disamenityName: string;
    disamenityDistance: string;
    parking: string;
    zoning: string;
    coverageRatio: string;
    plotRatio: string;
    buildRestriction: string;
    sectionId: string;
    rates: ComparisonCaseRates; // 個別因素修正率，鍵名須與下方 19 項完全一致（PrintableComparisonForm 逐鍵讀取，缺一不可）
    absRateSum: number; // |修正率|加總
    priceSimilarity: string;
    weight: string;
    trialPrice: number;
  }>;
  benchmarkComparedPrice: number; // 比準地最終估計價格
  benchmarkRemark: string; // 表4 比準地備註（選取理由及條件說明）
  caseRemark: string; // 表4 各比較標的備註
  overallRemark: string; // 表4 全案備註
  fillDate: string; // 填報日期
};

type ComparisonCaseRates = {
  area: number;
  width: number;
  depth: number;
  shape: number;
  frontage: number;
  terrain: number;
  roadType: number;
  roadWidth: number;
  school: number;
  market: number;
  park: number;
  station: number;
  district: number;
  disamenity: number;
  parking: number;
  zoning: number;
  coverageRatio: number;
  plotRatio: number;
  buildRestriction: number;
};
```

### Mock 範例（Request / Response）

延續「金山老街 P002-00」案例，直接對應官方表4紙本（案號 `1140901-99-001`，比準地 金美段489地號 vs 比較標的1 溫泉段218地號）逐欄轉錄，跟現有 `frontend/src/mock/comparisonFixtures.ts` 的內容一致（這份 mock 本來就是照這張紙本表4建的，不是我另外編的）。

**Request**

```json
POST /api/produce/comparison
{
  "sectionId": "P002-00",
  "regionalFactors": "...同②的 Response.regionalFactors（28 筆完整陣列，此處省略重複貼出）",
  "regionalTotal": 0,
  "benchmark": {
    "location": "新北市金山區金美段489地號",
    "area": "113.21",
    "width": "5",
    "depth": "23",
    "shape": "方形",
    "frontage": "單面臨街",
    "terrain": "平坦",
    "roadType": "主要道路",
    "roadName": "中山路",
    "roadWidth": "18",
    "schoolName": "金山國小",
    "schoolDistance": "150",
    "marketName": "金山市場",
    "marketDistance": "30",
    "parkName": "中山溫泉公園",
    "parkDistance": "190",
    "stationName": "金山區公所站",
    "stationDistance": "80",
    "districtName": "老街商圈",
    "districtDistance": "0",
    "disamenityName": "金山第一公墓",
    "disamenityDistance": "260",
    "parking": "可路邊停車",
    "zoning": "第二種商業區",
    "coverageRatio": "70%",
    "plotRatio": "240%",
    "buildRestriction": "無",
    "sectionId": "P002-00"
  },
  "comparisonLocations": [
    {
      "address": "新北市金山區溫泉段218地號",
      "lat": 25.2231,
      "lng": 121.6389
    }
  ]
}
```

**Response**

```json
{
  "comparison": [
    {
      "key": "area",
      "label": "7面積(M²)",
      "group": "宗地條件",
      "rate": 0,
      "reference": {
        "dataSource": "地籍資料",
        "bracket": "面積差異<20%：不修正",
        "derivation": "比準地113.21㎡／比較標的1 111.85㎡，差異未達修正門檻",
        "rawFact": "比準地 113.21㎡ vs 比較標的1 111.85㎡"
      }
    },
    {
      "key": "width",
      "label": "8寬度(M)",
      "group": "宗地條件",
      "rate": 0,
      "reference": {
        "dataSource": "地籍資料",
        "bracket": "寬度差異<2M：不修正",
        "derivation": "比準地5M／比較標的1 7M，差異未達修正門檻",
        "rawFact": "比準地寬度 5M vs 比較標的1寬度 7M"
      }
    },
    {
      "key": "depth",
      "label": "9深度(M)",
      "group": "宗地條件",
      "rate": 1,
      "reference": {
        "dataSource": "個別因素基準表｜宗地條件",
        "bracket": "每縮減5M修正+1%",
        "derivation": "比準地23M／比較標的1 16M，深度縮減7M，修正率+1.00%",
        "rawFact": "比準地深度 23M vs 比較標的1深度 16M"
      }
    },
    {
      "key": "shape",
      "label": "10形狀",
      "group": "宗地條件",
      "rate": 0,
      "reference": {
        "dataSource": "地籍圖資",
        "bracket": "方形：不修正｜不規則：依比例修正",
        "derivation": "比準地、比較標的1均為方形，無需修正",
        "rawFact": "比準地：方形 vs 比較標的1：方形"
      }
    },
    {
      "key": "frontage",
      "label": "11臨街情形",
      "group": "宗地條件",
      "rate": 0,
      "reference": {
        "dataSource": "地籍圖資",
        "bracket": "單面臨街：不修正｜兩面以上臨街：依基準表加成",
        "derivation": "比準地、比較標的1均為單面臨街，無需修正",
        "rawFact": "比準地：單面臨街 vs 比較標的1：單面臨街"
      }
    },
    {
      "key": "terrain",
      "label": "12地勢",
      "group": "宗地條件",
      "rate": 0,
      "reference": {
        "dataSource": "地籍圖資",
        "bracket": "平坦：不修正｜坡地：依基準表修正",
        "derivation": "比準地、比較標的1均為平坦，無需修正",
        "rawFact": "比準地：平坦 vs 比較標的1：平坦"
      }
    },
    {
      "key": "roadType",
      "label": "13道路種類",
      "group": "道路條件",
      "rate": 2,
      "reference": {
        "dataSource": "個別因素基準表｜道路條件",
        "bracket": "主要道路優於次要道路：修正+2%",
        "derivation": "比準地臨主要道路、比較標的1臨次要道路，修正率+2.00%",
        "rawFact": "比準地：中山路(主要道路) vs 比較標的1：金包里街(次要道路)"
      }
    },
    {
      "key": "roadWidth",
      "label": "14面前道路寬度",
      "group": "道路條件",
      "rate": 5,
      "reference": {
        "dataSource": "個別因素基準表｜道路寬度",
        "bracket": "每縮減4M修正+2%，上限+5%",
        "derivation": "比準地18M／比較標的1 6M，寬度縮減12M，修正率+5.00%（已達上限）",
        "rawFact": "比準地面前道路 中山路18M vs 比較標的1面前道路 金包里街6M"
      },
      "warning": "差異率達基準表上限5%，請確認"
    },
    {
      "key": "school",
      "label": "15接近學校之程度",
      "group": "接近條件",
      "rate": 0,
      "reference": {
        "dataSource": "個別因素基準表｜接近條件",
        "bracket": "優<200M｜普通200-600M｜劣>600M",
        "derivation": "150M／100M均落在「優」級，無需修正",
        "rawFact": "比準地→金山國小150M vs 比較標的1→金山國小100M"
      }
    },
    {
      "key": "market",
      "label": "16接近市場之程度",
      "group": "接近條件",
      "rate": 0,
      "reference": {
        "dataSource": "個別因素基準表｜接近條件",
        "bracket": "優<100M｜普通100-400M｜劣>400M",
        "derivation": "30M／92M均落在「優」級，無需修正",
        "rawFact": "比準地→金山市場30M vs 比較標的1→金山市場92M"
      }
    },
    {
      "key": "park",
      "label": "17接近公園、廣場之程度",
      "group": "接近條件",
      "rate": 0,
      "reference": {
        "dataSource": "個別因素基準表｜接近條件",
        "bracket": "優<300M｜普通300-600M｜劣>600M",
        "derivation": "190M／200M均落在「優」級，無需修正",
        "rawFact": "比準地→中山溫泉公園190M vs 比較標的1→中山溫泉公園200M"
      }
    },
    {
      "key": "station",
      "label": "18接近車站之程度",
      "group": "接近條件",
      "rate": 0,
      "reference": {
        "dataSource": "個別因素基準表｜接近條件",
        "bracket": "優<200M｜普通200-500M｜劣>500M",
        "derivation": "80M／190M均落在「優」級，無需修正",
        "rawFact": "比準地→金山區公所站80M vs 比較標的1→金山區公所站190M"
      }
    },
    {
      "key": "district",
      "label": "19接近商圈之程度",
      "group": "接近條件",
      "rate": 0,
      "reference": {
        "dataSource": "個別因素基準表｜接近條件",
        "bracket": "優<100M｜普通100-300M｜劣>300M",
        "derivation": "比準地、比較標的1均位於老街商圈內(0M)，無需修正",
        "rawFact": "比準地→老街商圈0M vs 比較標的1→老街商圈0M"
      }
    },
    {
      "key": "disamenity",
      "label": "20嫌惡設施(類型)",
      "group": "周邊環境條件",
      "rate": 3,
      "reference": {
        "dataSource": "個別因素基準表｜嫌惡設施",
        "bracket": "優≥300M｜稍優100-300M｜劣<100M",
        "derivation": "比準地260M落「稍優」、比較標的1 80M落「劣」，修正率+3.00%",
        "rawFact": "比準地→金山第一公墓260M vs 比較標的1→金山第一公墓80M"
      }
    },
    {
      "key": "parking",
      "label": "21停車方便性",
      "group": "周邊環境條件",
      "rate": 2,
      "reference": {
        "dataSource": "個別因素基準表｜周邊環境條件",
        "bracket": "可路邊停車優於不可路邊停車：修正+2%",
        "derivation": "比準地可路邊停車、比較標的1不可路邊停車，修正率+2.00%",
        "rawFact": "比準地：可路邊停車 vs 比較標的1：不可路邊停車"
      }
    },
    {
      "key": "zoning",
      "label": "22使用分區或編定用地",
      "group": "行政條件",
      "rate": 0,
      "reference": {
        "dataSource": "都市計畫圖資",
        "bracket": "分區相同：不修正",
        "derivation": "比準地、比較標的1均為第二種商業區，無需修正",
        "rawFact": "比準地：第二種商業區 vs 比較標的1：第二種商業區"
      }
    },
    {
      "key": "coverageRatio",
      "label": "23建蔽率(%)",
      "group": "行政條件",
      "rate": 0,
      "reference": {
        "dataSource": "都市計畫圖資",
        "bracket": "建蔽率相同：不修正",
        "derivation": "比準地、比較標的1均為70%，無需修正",
        "rawFact": "比準地：70% vs 比較標的1：70%"
      }
    },
    {
      "key": "plotRatio",
      "label": "24容積率(%)",
      "group": "行政條件",
      "rate": 0,
      "reference": {
        "dataSource": "都市計畫圖資",
        "bracket": "容積率相同：不修正",
        "derivation": "比準地、比較標的1均為240%，無需修正",
        "rawFact": "比準地：240% vs 比較標的1：240%"
      }
    },
    {
      "key": "buildRestriction",
      "label": "25有無禁限建",
      "group": "行政條件",
      "rate": 0,
      "reference": {
        "dataSource": "都市計畫圖資",
        "bracket": "均無禁限建：不修正",
        "derivation": "比準地、比較標的1均無禁限建，無需修正",
        "rawFact": "比準地：無 vs 比較標的1：無"
      }
    }
  ],
  "comparisonForm": {
    "appraisalBaseDate": "1140901",
    "caseCode": "1140901-99-001",
    "benchmarkParcelNo": "-",
    "benchmark": {
      "location": "新北市金山區金美段489地號",
      "area": "113.21",
      "width": "5",
      "depth": "23",
      "shape": "方形",
      "frontage": "單面臨街",
      "terrain": "平坦",
      "roadType": "主要道路",
      "roadName": "中山路",
      "roadWidth": "18",
      "schoolName": "金山國小",
      "schoolDistance": "150",
      "marketName": "金山市場",
      "marketDistance": "30",
      "parkName": "中山溫泉公園",
      "parkDistance": "190",
      "stationName": "金山區公所站",
      "stationDistance": "80",
      "districtName": "老街商圈",
      "districtDistance": "0",
      "disamenityName": "金山第一公墓",
      "disamenityDistance": "260",
      "parking": "可路邊停車",
      "zoning": "第二種商業區",
      "coverageRatio": "70%",
      "plotRatio": "240%",
      "buildRestriction": "無",
      "sectionId": "P002-00"
    },
    "cases": [
      {
        "caseNo": "1",
        "location": "新北市金山區溫泉段218地號",
        "latLng": {
          "lat": 25.2231,
          "lng": 121.6389
        },
        "normalPrice": 184763,
        "tradeDate": "114.05.28",
        "dateAdjRate": 2.0,
        "adjustedPrice": 188458,
        "regionalAdjRate": 0.0,
        "area": "111.85",
        "width": "7",
        "depth": "16",
        "shape": "方形",
        "frontage": "單面臨街",
        "terrain": "平坦",
        "roadType": "次要道路",
        "roadName": "金包里街",
        "roadWidth": "6",
        "schoolName": "金山國小",
        "schoolDistance": "100",
        "marketName": "金山市場",
        "marketDistance": "92",
        "parkName": "中山溫泉公園",
        "parkDistance": "200",
        "stationName": "金山區公所站",
        "stationDistance": "190",
        "districtName": "老街商圈",
        "districtDistance": "0",
        "disamenityName": "金山第一公墓",
        "disamenityDistance": "80",
        "parking": "不可路邊停車",
        "zoning": "第二種商業區",
        "coverageRatio": "70%",
        "plotRatio": "240%",
        "buildRestriction": "無",
        "sectionId": "P002-00",
        "rates": {
          "area": 0,
          "width": 0,
          "depth": 1,
          "shape": 0,
          "frontage": 0,
          "terrain": 0,
          "roadType": 2,
          "roadWidth": 5,
          "school": 0,
          "market": 0,
          "park": 0,
          "station": 0,
          "district": 0,
          "disamenity": 3,
          "parking": 2,
          "zoning": 0,
          "coverageRatio": 0,
          "plotRatio": 0,
          "buildRestriction": 0
        },
        "absRateSum": 13.0,
        "priceSimilarity": "普通",
        "weight": "100%",
        "trialPrice": 212958
      }
    ],
    "benchmarkComparedPrice": 212958,
    "benchmarkRemark": "本案比準地位新北市金山區中山路老街精華地段，於民國114年05月31日查詢，該街廓多作商業使用，周邊設施完善，係選定為標的之理由。",
    "caseRemark": "本案依第64期都市地價指數計算最近一年新北市金山區商業區地價指數年漲幅為6.18%(108.16%-101.98%)，推估本案價格日期當時地價指數為48,481元/㎡，比較標的1交易日期當時地價指數為47,513元/㎡，價格日期調整率約為2%〔(48,481/47,513)-1〕。",
    "overallRemark": "考量本次勘估標的所在區域之成交案例稀少，且多有特殊交易或價格遠低於市價行情之情形，故依土地徵收補償市價查估辦法第17條第3項規定，放寬案例蒐集期間至估價基準日前一年內，並依土地徵收補償市價查估辦法第19條第2項規定，擴大蒐集範圍至金山全區及第二種住宅區，惟仍無土地交易案例，且本案勘估標的位處新北市金山區商業效益最佳地區（中山路及金包里街，中正路至民生路段），該街廓90%以上作店舖使用，故其他地區較無可替代性，而第二種住宅區之店舖交易商業效益較差，與本案較無替代性，故本案僅挑選1筆案例作為本次比較標的。",
    "fillDate": "114 年 09 月 18 日"
  },
  "computed": {
    "dateAdj": 2.0,
    "regionalTotal": 0,
    "individualTotal": 13.0,
    "trialPrice": 212958
  }
}
```

**重點提醒**：

- `comparison` 固定 19 筆，key 對應 `ComparisonCaseRates` 的 19 個欄位（`area`/`width`/`depth`/…/`buildRestriction`），逐一比較比準地與比較標的1的原始條件值，`rate` 是這欄的差異修正率（%）。
- `rates` 加總 = `absRateSum` = `individualTotal`：這個案例 19 項裡只有 `depth`(+1)／`roadType`(+2)／`roadWidth`(+5)／`disamenity`(+3)／`parking`(+2) 五項有修正，其餘 14 項都是 0，加總剛好 13.00%——**跟前面表5階段的邏輯不同，這裡是表4自己的「個別因素基準表」查表結果（宗地/道路/接近/周邊環境/行政條件），不是表5的區域因素基準表，兩者是不同的基準表、不同的計算階段，不要混用**。
- `trialPrice`(212,958) 的算法：`adjustedPrice`(188,458，= `normalPrice` 184,763 × (1+`dateAdjRate` 2%)) × (1+`regionalAdjRate` 0%) × (1+`individualTotal` 13%) ≈ 212,958。`benchmarkComparedPrice` 因為目前只有這 1 筆比較標的、`weight` 100%，直接等於這筆的 `trialPrice`。
- `comparisonLocations`／`ComparisonCase.latLng` 是使用者在地圖上手動標記比較標的座標後才有的值，不是後端能反查出來的資料——這裡的座標僅示意，實際串接時由前端帶使用者實際標記的座標過來。
- **與①②範例的落差（請留意）**：這份 `benchmark` 的 `parkDistance`(190)／`stationDistance`(80)／`disamenityDistance`(260) 跟本文件①②章節示範用的 `benchmark`（分別是 0／0／80，源自表1「本區段內」勾選）對不上——這是因為①②的示範是我直接轉錄表1「本區段內/本區段外距」欄位（勘查表的粗略描述），而這裡是 `BENCHMARK_CONDITION_BASELINE`（`frontend/src/mock/surveyFixtures.ts`）已經對齊表4紙本的精確距離值。兩者理論上該來自同一次 `nearestOfKind(facilities, kind)` 查詢結果，不應該對同一個地標（中山溫泉公園／金山區公所站／金山第一公墓）給出兩種不同距離。這處落差目前還沒收斂，如果要我一併回頭修正①②章節（尤其 `cemetery_r` 的等級會從「劣」變成「普通」，因為260M落在「普通」級距而不是80M的「劣」），跟我說一聲。

---

## 5. 表單匯出 API

**端點**: `POST /api/export`

**功能**: 將編輯後的三表資料送後端產出下載檔

### 請求參數

```typescript
type ExportFormsRequest = {
  meta: {
    yearPeriod: string;
    sectionId: string;
    range: string;
    district: string;
    landUseType: string;
    benchmarkParcel: string;
    surveyDate: string;
    location?: { lat: number; lng: number };
  };
  survey: SurveyField[];
  regionalFactors: RegionalFactorRow[];
  regionalFactorRemarks: RegionalFactorRemarks;
  caseCode: string;
  comparisonCases: Array<{ caseNo: string; sectionId: string }>;
  comparison: FactorRow[];
  comparisonForm: ComparisonForm;
  computed: {
    dateAdj: number; // 日期調整率(%)
    regionalTotal: number; // 區域因素總修正率(%)
    individualTotal: number; // 個別因素 |修正率| 加總
    trialPrice: number; // 最終試算價格
  };
};
```

### 回應格式

```typescript
type ExportFormsResponse = {
  ok: boolean; // 是否成功
  url: string; // 下載檔案 URL（可為相對或絕對路徑）
};
```

### 調用時機

- 用戶在「輸出」頁點擊「下載」或「列印」按鈕時

### 預期輸出檔案格式

- 表3勘查表 - PDF
- 表4（比較法調查估價表）- PDF
- 表5（區域因素分析明細表）- PDF
- 地價區段圖 - PDF
- 使用分區圖 - PDF
- 區段略圖 - PDF

---

## API 調用流程圖

```
┌─ 產製任務頁 ─────────────┐
│  標記比準地/比較標地      │
│  座標 → 開始查詢          │
└──────────┬────────────────┘
           │
           ▼
┌─ ① 表3 勘查表產製 ───────┐
│  POST /api/produce/survey │
│  │                        │
│  ├─ 查周邊設施 API       │
│  │  (比準地座標)          │
│  │                        │
│  └─ 回傳 SurveyField[]   │
└──────────┬────────────────┘
           │
           ▼
┌─ ① 表3 勘查表編輯頁 ──────┐
│  使用者確認/編輯表3      │
│  ↓                       │
│  點擊「確認」            │
└──────────┬────────────────┘
           │
           ▼
┌─ ② 表5 區域因素分析 ─────┐
│  POST /api/produce/regional-factors
│  (已確認的表3資料)       │
│  ↓                       │
│  回傳 RegionalFactorRow[]│
└──────────┬────────────────┘
           │
           ▼
┌─ ② 表5 區域因素編輯頁 ────┐
│  使用者確認/編輯表5      │
│  ↓                       │
│  點擊「確認」            │
└──────────┬────────────────┘
           │
           ▼
┌─ ③ 表4 比較法估價表 ─────┐
│  POST /api/produce/comparison
│  (已確認的表5資料        │
│   + 比較標地座標)        │
│  │                       │
│  ├─ 查周邊設施 API      │
│  │  (各比較標的座標)     │
│  │                       │
│  └─ 回傳 ComparisonForm  │
└──────────┬────────────────┘
           │
           ▼
┌─ ③ 表4 比較法估價編輯頁 ──┐
│  使用者確認/編輯表4      │
│  ↓                       │
│  點擊「確認」            │
└──────────┬────────────────┘
           │
           ▼
┌─ 產製圖籍頁 ──────────────┐
│  查使用分區圖層 API       │
└──────────┬────────────────┘
           │
           ▼
┌─ 輸出頁 ──────────────────┐
│  POST /api/export         │
│  ↓                        │
│  生成 PDF 檔案            │
│  ↓                        │
│  下載                     │
└───────────────────────────┘
```

---

## 關鍵設計原則

### 1. 三階段遞進式產製

- **① 表3 勘查表**: 周邊設施查詢 + AI 自動填寫
- **② 表5 區域因素分析**: 表3 事實查表判等級
- **③ 表4 比較法估價**: 區域總修正 + 個別因素差異

### 2. 資料流向

- 各階段產製結果是上一階段「使用者已確認」資料的函數
- 使用者編輯不會觸發自動重算，只更新狀態標籤（"edited"）
- 防止三表各自漂移，保持勾稽一致

### 3. 佐證/對照機制

- 每項填寫值都帶 `FieldReference`（數據來源、基準級距、推導過程、原始事實）
- 支援可稽核的完整追溯

### 4. 錯誤處理

- 周邊設施查詢失敗 → 該項保留「需人工確認」狀態
- 地籍/分區圖查詢失敗 → 前端 Fallback 或保留空白
- 涵蓋不完整的邊界情況（如查無該項設施）

---

## 技術細節

### 地址座標轉換

- 統一使用 WGS84 (EPSG:4326) 座標系
- 經度、緯度順序：lon（經度）、lat（緯度）

### 日期格式

- 民國年月日：如 "1140901"（民國114年9月1日）
- 西元年月日：如 "114.05.28"（民國114年5月28日）
- 備註文字日期：如 "114 年 09 月 18 日"

### 價格計算

- 所有金額以元為單位
- 修正率以百分比表示（%），如 2.5 = 2.5%
- 試算價格 = 正常交易價格 × (1 + 日期調整 + 個別因素 + 區域因素)

---

## 現狀（截至 2026-09-09）

### 已實作、尚未部署

- 🟡 `GET /api/facilities` - 周邊設施查詢：程式碼已在 `infra/lambda/facilities/`（PostGIS +
  OSM POI + NLSC 即時 API），本機 Docker PostGIS 可跑，但雲端 `NtlandDatabaseStack` /
  `NtlandLambdaStack` 尚未 `cdk deploy`，資料也還沒灌，故目前無可用的 Function URL

### 待實現（後端）

- 🔲 `POST /api/produce/survey` - 表3 產製
- 🔲 `POST /api/produce/regional-factors` - 表5 產製
- 🔲 `POST /api/produce/comparison` - 表4 產製
- 🔲 `POST /api/export` - 表單匯出/PDF 生成

---

最後更新: 2026-09-09（周邊設施查詢 API 章節已對齊 `infra/lambda/facilities` 實作與 `tests/examples/README.md`）

---

## 契約變更（2026-09，斷點接線後）— ⚠️ 前端必讀

斷點接線（表2 orchestrator、表3 v2 合併鏈）改了兩支對外 API 的 **request 形狀**。後端已照下述實作
並部署；**前端若不配合調整，這兩支會串不起來**。以下為變更點的權威說明（正文對應章節的型別以此為準）。

### 變更 1｜表2 `POST /api/produce/regional-factors`：request 改收「比準地 + N 份比較標的表1」

**為什麼改**：評分核心（`regional-factor-grading`）一次只評一筆地（Base parcel only）。要產出「比準地 vs
各比較標的」的比較欄，後端得對 **1+N 份表1 定稿各評一次**再合成。因此 request 從「單份」改為「比準地
一份 + 比較標的陣列」。

**新 request（後端實際收的形狀）**：

```typescript
type ProduceRegionalFactorsRequest = {
  sectionId: string; // 比準地區段編號
  benchmark: Table1Final; // 比準地的「表1 定稿」（整份，見下）
  comparables?: ComparableTable1Final[]; // 比較標的，0~3 份；每份是一份表1 定稿 + caseNo
  caseCode?: string;
  remarks?: RegionalFactorRemarks;
};

type Table1Final = {
  meta: Record<string, unknown>; // 該筆地的 meta（產表1 回的 meta）
  survey: SurveyField[]; // 該筆地的表1 勘查表（非空陣列）
  benchmark: ComparisonCondition; // 該筆地的宗地條件
};

type ComparableTable1Final = Table1Final & { caseNo?: string }; // caseNo 省略時後端用陣列序號 "1".."3"
```

> ⚠️ **注意名稱**：頂層的 `benchmark` 是「**比準地整份表1 定稿**」（含 meta/survey/benchmark），
> **不是**單一 `ComparisonCondition`。這與舊版「`{ sectionId, survey, benchmark }` 單份」不同。
> 正文 §3 的舊 `ProduceRegionalFactorsRequest`（`survey` + `benchmark` 單份 + `comparisonSurveys`）
> **已過時**，以本節為準。

**response 不變**：仍回 `ProduceRegionalFactorsResponse`（`RegionalFactorRow[28]` + `regionalTotal` +
`caseCode` + `comparisonCases[]` + `regionalFactorRemarks`）。其中：

- `compare[]` 筆數 = 傳入的比較標的數（`comparables.length`）；`comparables` 為空時 `compare: []`。
- `compare[].rate` **一律 `null`**（修正率 % 由前端計算）；`subject`/`compare[]` 另帶 optional
  `points`（修正點數）/`rank`（等級序）/`delta`（點數差），供前端換算參考。
- `subject.reference` / `compare[].reference` 目前一律不帶（尚無證據來源）。
- 逐份容錯：某比較標的評分失敗 → 該筆不納入，response 另帶 `failedComparables: [{caseNo, error}]`；
  比準地評分失敗 → 502。

### 變更 2｜表3 `POST /api/produce/comparison`：新增 `comparisonSurveys[]`

**為什麼改**：表3 改用 cli 個別因素評分鏈（v2 合併），要對「比準地 + 各比較標的」各自評分，需要
每個比較標的**自己的表1**。原 request 只帶座標，評不了比較標的。

**request 新增欄位**（其餘沿用正文 §4）：

```typescript
type ProduceComparisonRequest = {
  sectionId: string;
  regionalFactors: RegionalFactorRow[]; // 已確認的表2
  regionalTotal: number;
  benchmark: ComparisonCondition; // 比準地條件
  benchmarkSurvey?: SurveyField[]; // v2：比準地表1，供評分佐證
  comparisonLocations?: LocationInput[]; // 座標（圖台定位；沿用）
  comparisonSurveys?: Array<{
    // v2 新增：每個比較標的自己的表1
    address?: string;
    lat?: number;
    lng?: number;
    survey?: SurveyField[];
    benchmark: ComparisonCondition; // 必填；缺 survey 時仍可用 benchmark 評分
    tradeDate?: string;
    normalPrice?: number;
    weight?: number; // 市場面覆寫（選填）
  }>;
};
```

> **v1 行為（前端要知道的降級）**：若不帶 `comparisonSurveys`，後端以「比較標的條件 = 比準地」跑，
> 個別因素 `delta` 多為 0（結構正確、數字不真）。**正常單價**由 `land-transaction` 取該段最近一筆
> 土地案例、查無回 0；**日期調整率**預設 0%（前端當日填更準）。故表3 現階段「能出、數值待調」。

### 對前端的一句話

- 表2：改送「比準地表1 + `comparables[]`（各比較標的的表1）」。
- 表3：多送「`comparisonSurveys[]`（各比較標的的表1）」。
- 兩支的表1 定稿，前端本來就會在畫面 1/2「每筆地各走一次產表1 + 確認」時累積到，直接沿用那批即可。

---

## 現狀（截至 2026-09-12）

四個 stack（Asset / Database / Lambda / **Bedrock**）**已全部 `cdk deploy` + DB 初始化**。以下對外
端點對應的 lambda 皆 🔵 **已部署**（尚未逐一端到端實測，故未升 🟢）：

- 🔵 `GET /api/facilities`、`POST /api/produce/survey`、`POST /api/produce/regional-factors`、
  `POST /api/produce/comparison`、`POST /api/export` —— 皆已部署。
- ⚠️ **殘留缺陷**（見 `docs/資料流與斷點.md` §4.4）：表3 數值佔位、使用者上傳圖片未併入匯出、
  端到端尚未實測、**本節上述 request 契約變更需前端配合**。

### 變更 3｜逐類查詢半徑（`categories`）—— 2026-09-12

周邊設施查詢改成「一個基準半徑 + 逐類覆寫」，涉及兩支對外 API：

- **§2 `GET /api/facilities`**：新增 `categories`（POST 陣列）／`cats`（GET 字串）；回應 `area` 新增
  `maxRadiusMeters`、`categoryRadii`。多邊形模式不支援，帶了回 `400`。
- **§1 `POST /api/produce/survey`**：新增 `facilities.radius`（預設 600）／`facilities.categories`，
  原樣轉給 §2。

**半徑標準不在後端**：級距是業務規則（站牌 800m、交流道 4000m），寫死在 Lambda 等於改標準就要
重新部署，所以由呼叫端帶，標準表放前端 [frontend/src/lib/facilityRadiusStandards.ts](frontend/src/lib/facilityRadiusStandards.ts)
（`REGIONAL_FACILITY_RADII` 給表3 區域因素、`INDIVIDUAL_FACILITY_RADII` 給表4 個別因素）。

連帶影響：NLSC 那幾類（殯葬／火葬場／加油站／醫療／文教）**移除了 800~1000m 的隱藏下限**，給多少查多少；
佐證文字要引用 `area.categoryRadii[該類]` 而不是基準 `radiusMeters`；分類表新增 `settlement`（聚落）
與 `crematorium`（火葬場）兩個 category。

> 其他不在本文件範圍的新端點（`case-store` 的 `PATCH`／單張定稿讀回／宗地身分欄
> `district`/`section`/`sectno`/`parcelNo`/`lat`/`lng`/`areaM2`、`land-easymap` 地籍即時查詢、
> `land-locate` 已 deprecated）見後端權威文件 [API_REFERENCE.md](API_REFERENCE.md)。

---

最後更新: 2026-09-12（補逐類查詢半徑 `categories`／`facilities.*` 參數；§1 §2 已對齊 `infra/lambda` 實作）
